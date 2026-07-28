import { compareScored, matchKind, score, type MatchKind, type Scored } from "@/lib/fuzzy"
import {
  getOwner,
  listRepos,
  popularOwners,
  RateLimited,
  searchOwners,
  searchRepos,
  searchReposForOwners,
  type Owner,
  type Repo,
} from "@/lib/github"

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

/** Owners whose repo list gets fetched per pass. Each costs one cheap REST call. */
const MAX_OWNERS_EXAMINED = 30
/** Extra owners pulled in purely for having short logins, whatever their match kind. */
const SHORTEST_OWNERS_KEPT = 10
const FETCH_CONCURRENCY = 8
/** Owners covered by the cheap batched-search pass, beyond the deep ones. */
const MAX_OWNERS_SEARCHED = 144
/** Logins per search query — GitHub caps the query string, so keep chunks small. */
const SEARCH_BATCH = 12
const SEARCH_CONCURRENCY = 6

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
 * Owners worth a full repo-list fetch. This is the only pass that can match a
 * repo fragment as a *subsequence* (`cx` -> `codex`), which GitHub's search
 * index cannot do, so it deliberately includes short and well-known logins even
 * when they rank below a wall of literal prefix matches.
 */
function selectDeepOwners(ranked: ScoredOwner[]): ScoredOwner[] {
  const picked = new Map<string, ScoredOwner>()
  const add = (c: ScoredOwner) => picked.set(c.owner.login.toLowerCase(), c)

  for (const c of ranked.slice(0, MAX_OWNERS_EXAMINED)) add(c)
  for (const c of [...ranked]
    .sort((a, b) => a.owner.login.length - b.owner.login.length || a.owner.login.localeCompare(b.owner.login))
    .slice(0, SHORTEST_OWNERS_KEPT))
    add(c)

  return [...picked.values()]
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
    // Forks and archived repos are not penalized — structure decides, stars only tie-break.
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
  const byLogin = new Map(owners.map((c) => [c.owner.login.toLowerCase(), c]))
  const pairs = new Map<string, { hit: RepoHit; rankSum: number; totalLength: number }>()

  const addPair = (cand: ScoredOwner, repo: Repo, s: Scored) => {
    const key = repo.full_name.toLowerCase()
    if (pairs.has(key)) return
    pairs.set(key, {
      hit: toHit(repo, cand.s.kind, s.kind),
      rankSum: cand.s.rank + s.rank,
      totalLength: cand.owner.login.length + repo.name.length,
    })
  }

  const deep = selectDeepOwners(owners).filter((c) => {
    const key = c.owner.login.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Pass 1 (deep): full repo lists for the strongest owners. Local scoring here
  // is what makes subsequence repo matches possible. Bounded-parallel so a
  // 30-owner scan costs one round trip, not thirty.
  for (let i = 0; i < deep.length; i += FETCH_CONCURRENCY) {
    const batch = deep.slice(i, i + FETCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (cand) => {
        let repos = await listRepos(cand.owner.login)
        let ranked = rankRepos(repoFragment, repos)
        // Only dig past the first 100 repos when the shallow page came up empty.
        if (!ranked.length && repos.length >= 100) {
          repos = await listRepos(cand.owner.login, 3)
          ranked = rankRepos(repoFragment, repos)
          if (!ranked.length && repos.length >= 300) {
            ranked = rankRepos(repoFragment, await searchRepos(cand.owner.login, repoFragment))
          }
        }
        return { cand, ranked }
      }),
    )
    for (const { cand, ranked } of results) {
      for (const r of ranked.slice(0, 3)) addPair(cand, r.repo, r.s)
    }
  }

  // Pass 2 (wide): every remaining owner, ~12 per search request. Catches the
  // owner that ranks 40th on login length but holds the tightest repo match —
  // `maazghani/ksailnet` for `maaz/ks` — without a fetch per owner.
  const rest = owners
    .filter((c) => !deep.some((d) => d.owner.login.toLowerCase() === c.owner.login.toLowerCase()))
    .slice(0, MAX_OWNERS_SEARCHED)

  for (let i = 0; i < rest.length; i += SEARCH_BATCH * SEARCH_CONCURRENCY) {
    const window = rest.slice(i, i + SEARCH_BATCH * SEARCH_CONCURRENCY)
    const chunks: ScoredOwner[][] = []
    for (let j = 0; j < window.length; j += SEARCH_BATCH) chunks.push(window.slice(j, j + SEARCH_BATCH))

    const found = await Promise.all(
      chunks.map((chunk) => searchReposForOwners(chunk.map((c) => c.owner.login), repoFragment)),
    )
    for (const repos of found.flat()) {
      const cand = byLogin.get(repos.owner.login.toLowerCase())
      const s = score(repoFragment, repos.name)
      if (cand && s) addPair(cand, repos, s)
    }
  }

  if (!pairs.size) return null

  // Ranking order, strictly: match tightness, then fewest total characters, then
  // stars purely to break exact ties. No popularity boost, no fork/archive penalty.
  const ordered = [...pairs.values()].sort((a, b) => {
    if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum
    if (a.totalLength !== b.totalLength) return a.totalLength - b.totalLength
    if (a.hit.stars !== b.hit.stars) return b.hit.stars - a.hit.stars
    return a.hit.fullName.localeCompare(b.hit.fullName)
  })

  return { match: ordered[0].hit, alternates: ordered.slice(1, 7).map((p) => p.hit) }
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
