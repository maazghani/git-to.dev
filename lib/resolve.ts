import { compareScored, matchKind, score, type MatchKind, type Scored } from "@/lib/fuzzy"
import { getOwner, listRepos, popularOwners, RateLimited, searchOwners, searchRepos, type Owner, type Repo } from "@/lib/github"

export type RepoHit = {
  owner: string
  repo: string
  fullName: string
  description: string | null
  stars: number
  language: string | null
  archived: boolean
  fork: boolean
  url: string
  avatar: string
  ownerKind: MatchKind
  repoKind: MatchKind
}

export type Resolution =
  | { status: "hit"; query: string; match: RepoHit; alternates: RepoHit[] }
  | { status: "owner"; query: string; owner: { login: string; avatar: string; url: string; kind: MatchKind }; alternates: { login: string; avatar: string; url: string; kind: MatchKind }[] }
  | { status: "miss"; query: string; reason: string }
  | { status: "rate-limited"; query: string; reason: string }

const MAX_OWNERS_EXAMINED = 10
const SHORTEST_OWNERS_KEPT = 4

type ScoredOwner = { owner: Owner; s: Scored }

async function rankOwners(fragment: string, includePopular: boolean): Promise<ScoredOwner[]> {
  const pool = new Map<string, Owner>()

  const [exact, searched] = await Promise.all([getOwner(fragment), searchOwners(fragment)])
  if (exact) pool.set(exact.login.toLowerCase(), exact)
  for (const o of searched) pool.set(o.login.toLowerCase(), o)

  if (includePopular) {
    const popular = await popularOwners()
    for (const login of popular) {
      if (!pool.has(login.toLowerCase()) && matchKind(fragment, login)) {
        pool.set(login.toLowerCase(), { login, avatar_url: `https://github.com/${login}.png` })
      }
    }
  }

  const scored: ScoredOwner[] = []
  for (const owner of pool.values()) {
    const s = score(fragment, owner.login)
    if (s) scored.push({ owner, s })
  }
  scored.sort((a, b) => compareScored({ s: a.s, name: a.owner.login }, { s: b.s, name: b.owner.login }))
  return scored
}

/**
 * Which owners are worth fetching repos for. Ranked order is kind-first, so a
 * long list of `oai*` prefix owners could bury `openai` (a subsequence match)
 * past the examine cap — the shortest logins overall are always kept in play so
 * the least-padded pair still gets a chance to win.
 */
function selectCandidates(ranked: ScoredOwner[]): ScoredOwner[] {
  const head = ranked.slice(0, MAX_OWNERS_EXAMINED)
  const chosen = new Set(head.map((c) => c.owner.login.toLowerCase()))
  const shortest = [...ranked]
    .sort((a, b) => a.owner.login.length - b.owner.login.length || a.owner.login.localeCompare(b.owner.login))
    .filter((c) => !chosen.has(c.owner.login.toLowerCase()))
    .slice(0, SHORTEST_OWNERS_KEPT)
  return [...head, ...shortest]
}

function rankRepos(fragment: string, repos: Repo[]): { repo: Repo; s: Scored }[] {
  const scored: { repo: Repo; s: Scored }[] = []
  for (const repo of repos) {
    const s = score(fragment, repo.name)
    if (s) scored.push({ repo, s })
  }
  scored.sort((a, b) => {
    const base = compareScored({ s: a.s, name: a.repo.name }, { s: b.s, name: b.repo.name })
    if (base !== 0) return base
    if (a.repo.fork !== b.repo.fork) return a.repo.fork ? 1 : -1
    if (a.repo.archived !== b.repo.archived) return a.repo.archived ? 1 : -1
    return b.repo.stargazers_count - a.repo.stargazers_count
  })
  return scored
}

function toHit(repo: Repo, ownerKind: MatchKind, repoKind: MatchKind): RepoHit {
  return {
    owner: repo.owner.login,
    repo: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count ?? 0,
    language: repo.language,
    archived: Boolean(repo.archived),
    fork: Boolean(repo.fork),
    url: repo.html_url || `https://github.com/${repo.full_name}`,
    avatar: repo.owner.avatar_url || `https://github.com/${repo.owner.login}.png`,
    ownerKind,
    repoKind,
  }
}

/**
 * Score whole owner/repo pairs, not just owners: a candidate is better when both
 * halves match more tightly, and among equally tight matches the pair with the
 * fewest total characters (the least padding around the fragments) wins.
 */
async function bestPairMatch(
  owners: ScoredOwner[],
  repoFragment: string,
  seen: Set<string>,
): Promise<{ match: RepoHit; alternates: RepoHit[] } | null> {
  const pairs: { hit: RepoHit; rankSum: number; totalLength: number }[] = []

  for (const cand of selectCandidates(owners)) {
    const key = cand.owner.login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    let repos = await listRepos(cand.owner.login)
    let ranked = rankRepos(repoFragment, repos)
    if (!ranked.length && repos.length >= 300) {
      repos = await searchRepos(cand.owner.login, repoFragment)
      ranked = rankRepos(repoFragment, repos)
    }

    for (const r of ranked.slice(0, 3)) {
      pairs.push({
        hit: toHit(r.repo, cand.s.kind, r.s.kind),
        rankSum: cand.s.rank + r.s.rank,
        totalLength: cand.owner.login.length + r.repo.name.length,
      })
    }
  }

  if (!pairs.length) return null

  pairs.sort((a, b) => {
    if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum
    if (a.totalLength !== b.totalLength) return a.totalLength - b.totalLength
    if (a.hit.fork !== b.hit.fork) return a.hit.fork ? 1 : -1
    if (a.hit.archived !== b.hit.archived) return a.hit.archived ? 1 : -1
    return b.hit.stars - a.hit.stars
  })

  return { match: pairs[0].hit, alternates: pairs.slice(1, 7).map((p) => p.hit) }
}

export async function resolvePath(ownerFragment: string, repoFragment?: string): Promise<Resolution> {
  const query = repoFragment ? `${ownerFragment}/${repoFragment}` : ownerFragment
  if (!ownerFragment || !/^[a-zA-Z0-9._-]+$/.test(ownerFragment)) {
    return { status: "miss", query, reason: "Invalid owner fragment" }
  }
  if (repoFragment && !/^[a-zA-Z0-9._-]+$/.test(repoFragment)) {
    return { status: "miss", query, reason: "Invalid repo fragment" }
  }

  try {
    // Two-segment queries always consider the well-known-owner pool up front:
    // GitHub's index can't return `openai` for `oai`, and if that candidate only
    // showed up after every `oai*` owner failed, `oaix/musicbox` would win a
    // race `openai/codex` should win on total length.
    const ranked = await rankOwners(ownerFragment, Boolean(repoFragment))

    if (!repoFragment) {
      const pool = ranked.length ? ranked : await rankOwners(ownerFragment, true)
      if (!pool.length) return { status: "miss", query, reason: `No GitHub owner matches "${ownerFragment}"` }
      const [best, ...rest] = pool
      return {
        status: "owner",
        query,
        owner: {
          login: best.owner.login,
          avatar: best.owner.avatar_url,
          url: `https://github.com/${best.owner.login}`,
          kind: best.s.kind,
        },
        alternates: rest.slice(0, 6).map((o) => ({
          login: o.owner.login,
          avatar: o.owner.avatar_url,
          url: `https://github.com/${o.owner.login}`,
          kind: o.s.kind,
        })),
      }
    }

    const seen = new Set<string>()
    let result = await bestPairMatch(ranked, repoFragment, seen)

    if (!result) {
      // Nobody in the first batch of owners held a matching repo — walk the next batch.
      const rest = ranked.filter((c) => !seen.has(c.owner.login.toLowerCase()))
      if (rest.length) result = await bestPairMatch(rest, repoFragment, seen)
    }

    if (!result) {
      return { status: "miss", query, reason: `No repo matches "${query}"` }
    }
    return { status: "hit", query, match: result.match, alternates: result.alternates }
  } catch (err) {
    if (err instanceof RateLimited) {
      return {
        status: "rate-limited",
        query,
        reason: "GitHub API rate limit reached. Add a GITHUB_TOKEN environment variable to raise the limit.",
      }
    }
    throw err
  }
}

/**
 * Shortest unambiguous short link for a repo: the fewest leading characters of
 * the owner and repo names that still resolve back to this exact repo.
 */
export async function shortestPath(
  ownerName: string,
  repoName: string,
): Promise<{ status: "ok"; owner: string; repo: string; path: string; fullName: string } | { status: "miss"; reason: string }> {
  const target = `${ownerName}/${repoName}`.toLowerCase()

  for (let oLen = 1; oLen <= Math.min(ownerName.length, 12); oLen++) {
    const ownerFrag = ownerName.slice(0, oLen)
    let ranked: ScoredOwner[]
    try {
      ranked = await rankOwners(ownerFrag, false)
      if (!ranked.some((c) => c.owner.login.toLowerCase() === ownerName.toLowerCase())) {
        ranked = await rankOwners(ownerFrag, true)
      }
    } catch (err) {
      if (err instanceof RateLimited) return { status: "miss", reason: "GitHub API rate limit reached." }
      throw err
    }
    if (!ranked.some((c) => c.owner.login.toLowerCase() === ownerName.toLowerCase())) continue

    for (let rLen = 1; rLen <= repoName.length; rLen++) {
      const repoFrag = repoName.slice(0, rLen)
      const result = await bestPairMatch(ranked, repoFrag, new Set())
      if (result && result.match.fullName.toLowerCase() === target) {
        return { status: "ok", owner: ownerFrag, repo: repoFrag, path: `${ownerFrag}/${repoFrag}`, fullName: result.match.fullName }
      }
    }
  }

  return { status: "miss", reason: `Could not find a shorter unambiguous link than ${ownerName}/${repoName}` }
}

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "")
  const parts = cleaned.split("/").filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo] = parts
  if (!/^[a-zA-Z0-9-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) return null
  return { owner, repo }
}
