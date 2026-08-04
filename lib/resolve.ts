import { compareScored, matchKind, score, type MatchKind, type Scored } from "@/lib/fuzzy"
import {
  getOwner,
  getRepo,
  listRepos,
  popularOwners,
  RateLimited,
  searchOwners,
  searchRepos,
  searchReposForOwners,
  type Owner,
  type Repo,
} from "@/lib/github"
import { getCachedResolution, setCachedResolution } from "@/lib/cache"

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

export type ShortestPathResult =
  | { status: "ok"; owner: string; repo: string; path: string; fullName: string; limited?: true }
  | { status: "miss"; reason: string }

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
type RankedPair = { hit: RepoHit; rankSum: number; totalLength: number }

type PairMatchOptions = {
  /** When shortening, stop as soon as this repository can no longer win. */
  expectedTarget?: string
  /** Repository search has a much smaller quota than ordinary REST requests. */
  allowRepoSearch?: boolean
}

function comparePairs(a: RankedPair, b: RankedPair): number {
  if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum
  if (a.totalLength !== b.totalLength) return a.totalLength - b.totalLength
  if (a.hit.stars !== b.hit.stars) return b.hit.stars - a.hit.stars
  return a.hit.fullName.localeCompare(b.hit.fullName)
}

function orderedPairs(pairs: Map<string, RankedPair>): RankedPair[] {
  return [...pairs.values()].sort(comparePairs)
}

function pairResult(pairs: Map<string, RankedPair>): { match: RepoHit; alternates: RepoHit[] } | null {
  const ordered = orderedPairs(pairs)
  if (!ordered.length) return null
  return { match: ordered[0].hit, alternates: ordered.slice(1, 7).map((pair) => pair.hit) }
}

/**
 * Whether an owner could beat the current best pair even with an exact,
 * shortest-possible repository match. This safely removes owners for which a
 * wide GitHub repository search cannot affect the result.
 */
function canPossiblyBeat(cand: ScoredOwner, repoFragment: string, best: RankedPair): boolean {
  const bestPossibleRank = cand.s.rank
  if (bestPossibleRank !== best.rankSum) return bestPossibleRank < best.rankSum

  const normalizedRepoLength = repoFragment.replace(/[._-]/g, "").length
  const bestPossibleLength = cand.owner.login.length + normalizedRepoLength
  return bestPossibleLength <= best.totalLength
}

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
  options: PairMatchOptions = {},
): Promise<{ match: RepoHit; alternates: RepoHit[] } | null> {
  const byLogin = new Map(owners.map((c) => [c.owner.login.toLowerCase(), c]))
  const pairs = new Map<string, RankedPair>()
  const expectedTarget = options.expectedTarget?.toLowerCase()
  const expectedOwner = expectedTarget?.split("/", 1)[0]
  const allowRepoSearch = options.allowRepoSearch ?? true

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
          if (allowRepoSearch && !ranked.length && repos.length >= 300) {
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

  // During shortening the target repository is known. If its owner was fully
  // examined and the target is absent or already loses, a wide search can only
  // add more competitors; it can never make the target become the winner.
  const targetOwnerWasDeep = Boolean(
    expectedOwner && deep.some((cand) => cand.owner.login.toLowerCase() === expectedOwner),
  )
  if (expectedTarget && targetOwnerWasDeep) {
    const targetPair = pairs.get(expectedTarget)
    const best = orderedPairs(pairs)[0]
    if (!targetPair || (best && comparePairs(best, targetPair) < 0)) return pairResult(pairs)
  }

  // Pass 2 (wide): every remaining owner, ~12 per search request. Catches the
  // owner that ranks 40th on login length but holds the tightest repo match —
  // `maazghani/ksailnet` for `maaz/ks` — without a fetch per owner.
  let rest = owners
    .filter((c) => !deep.some((d) => d.owner.login.toLowerCase() === c.owner.login.toLowerCase()))
    .slice(0, MAX_OWNERS_SEARCHED)

  const bestAfterDeep = orderedPairs(pairs)[0]
  if (bestAfterDeep) rest = rest.filter((cand) => canPossiblyBeat(cand, repoFragment, bestAfterDeep))

  // Search the target owner's chunk first. If it cannot produce the target,
  // or produces a target that already loses, no later chunk can rescue it.
  if (expectedOwner) {
    rest.sort((a, b) => {
      const aTarget = a.owner.login.toLowerCase() === expectedOwner ? 0 : 1
      const bTarget = b.owner.login.toLowerCase() === expectedOwner ? 0 : 1
      return aTarget - bTarget
    })
  }

  // A shortener request values quota conservation over fan-out. One chunk at a
  // time lets it stop immediately when a newly found competitor beats the
  // target; ordinary resolver requests retain their wider concurrency.
  const searchConcurrency = expectedTarget ? 1 : SEARCH_CONCURRENCY
  let targetOwnerWasSearched = targetOwnerWasDeep

  for (let i = 0; i < rest.length; i += SEARCH_BATCH * searchConcurrency) {
    const window = rest.slice(i, i + SEARCH_BATCH * searchConcurrency)
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

    if (expectedOwner && window.some((cand) => cand.owner.login.toLowerCase() === expectedOwner)) {
      targetOwnerWasSearched = true
    }
    if (expectedTarget && targetOwnerWasSearched) {
      const targetPair = pairs.get(expectedTarget)
      const best = orderedPairs(pairs)[0]
      if (!targetPair || (best && comparePairs(best, targetPair) < 0)) return pairResult(pairs)
    }
  }

  return pairResult(pairs)
}

export async function resolvePath(ownerFragment: string, repoFragment?: string): Promise<Resolution> {
  const query = repoFragment ? `${ownerFragment}/${repoFragment}` : ownerFragment
  if (!ownerFragment || !/^[a-zA-Z0-9._-]+$/.test(ownerFragment)) {
    return { status: "miss", query, reason: "Invalid owner fragment" }
  }
  if (repoFragment && !/^[a-zA-Z0-9._-]+$/.test(repoFragment)) {
    return { status: "miss", query, reason: "Invalid repo fragment" }
  }

  // Only cache two-segment "hit" resolutions — single-owner and error responses are intentionally excluded.
  if (repoFragment) {
    const cached = await getCachedResolution<Resolution>(query)
    if (cached) return cached
  }

  try {
    // An exact owner/repository pair is unbeatable. Resolve it from the core
    // REST quota and avoid the much tighter search quota entirely.
    if (repoFragment) {
      const exact = await getRepo(ownerFragment, repoFragment)
      if (exact) {
        const resolution: Resolution = {
          status: "hit",
          query,
          match: toHit(exact, "exact", "exact"),
          alternates: [],
        }
        await setCachedResolution(query, resolution)
        return resolution
      }
    }

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
    const resolution: Resolution = { status: "hit", query, match: result.match, alternates: result.alternates }
    await setCachedResolution(query, resolution)
    return resolution
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
): Promise<ShortestPathResult> {
  const target = `${ownerName}/${repoName}`.toLowerCase()
  let exactRepo: Repo | null = null

  try {
    exactRepo = await getRepo(ownerName, repoName)
    if (!exactRepo) return { status: "miss", reason: `GitHub repository ${ownerName}/${repoName} was not found.` }

    for (let oLen = 1; oLen <= Math.min(ownerName.length, 12); oLen++) {
      const ownerFrag = ownerName.slice(0, oLen)
      let ranked = await rankOwners(ownerFrag, false)
      if (!ranked.some((c) => c.owner.login.toLowerCase() === ownerName.toLowerCase())) {
        ranked = await rankOwners(ownerFrag, true)
      }
      if (!ranked.some((c) => c.owner.login.toLowerCase() === ownerName.toLowerCase())) continue

      for (let rLen = 1; rLen <= repoName.length; rLen++) {
        const repoFrag = repoName.slice(0, rLen)
        const result = await bestPairMatch(ranked, repoFrag, new Set(), {
          expectedTarget: target,
          allowRepoSearch: false,
        })
        if (result && result.match.fullName.toLowerCase() === target) {
          return { status: "ok", owner: ownerFrag, repo: repoFrag, path: `${ownerFrag}/${repoFrag}`, fullName: result.match.fullName }
        }
      }
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      if (exactRepo) {
        return {
          status: "ok",
          owner: exactRepo.owner.login,
          repo: exactRepo.name,
          path: exactRepo.full_name,
          fullName: exactRepo.full_name,
          limited: true,
        }
      }
      return { status: "miss", reason: "GitHub API rate limit reached. Try again in a minute." }
    }
    throw err
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
