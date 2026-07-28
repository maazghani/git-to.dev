export type Owner = {
  login: string
  avatar_url: string
  type?: string
}

export type Repo = {
  name: string
  full_name: string
  description: string | null
  stargazers_count: number
  language: string | null
  fork: boolean
  archived: boolean
  html_url: string
  owner: Owner
  pushed_at?: string
}

export class RateLimited extends Error {
  constructor(message = "GitHub API rate limit reached") {
    super(message)
    this.name = "RateLimited"
  }
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

function headers() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "git-hb-fuzzy-resolver",
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

/** In-process memo so a single resolution never asks GitHub the same thing twice. */
const memo = new Map<string, { at: number; value: unknown }>()
const MEMO_TTL = 1000 * 60 * 10

async function gh<T>(path: string, revalidate: number): Promise<T | null> {
  const key = path
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.value as T

  const res = await fetch(`https://api.github.com${path}`, {
    headers: headers(),
    next: { revalidate },
  })

  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining")
    if (remaining === "0") throw new RateLimited()
    return null
  }
  if (!res.ok) return null

  const value = (await res.json()) as T
  memo.set(key, { at: Date.now(), value })
  return value
}

export async function getOwner(login: string): Promise<Owner | null> {
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(login)) return null
  return gh<Owner>(`/users/${login}`, 86400)
}

export async function searchOwners(fragment: string, perPage = 100): Promise<Owner[]> {
  const q = encodeURIComponent(`${fragment} in:login`)
  const data = await gh<{ items: Owner[] }>(`/search/users?q=${q}&per_page=${perPage}`, 3600)
  return data?.items ?? []
}

/** Every repo an owner has, capped at 3 pages (300 repos), newest activity first. */
export async function listRepos(login: string): Promise<Repo[]> {
  const out: Repo[] = []
  for (let page = 1; page <= 3; page++) {
    const data = await gh<Repo[]>(`/users/${login}/repos?per_page=100&sort=pushed&page=${page}`, 3600)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 100) break
  }
  return out
}

/** Fallback when a repo is outside the first 300: let GitHub's index find it. */
export async function searchRepos(owner: string, fragment: string): Promise<Repo[]> {
  const q = encodeURIComponent(`${fragment} in:name user:${owner}`)
  const data = await gh<{ items: Repo[] }>(`/search/repositories?q=${q}&per_page=50`, 3600)
  return data?.items ?? []
}

/**
 * Owners of the most-starred repos on GitHub. GitHub's search index cannot do
 * subsequence matching (`oai` never returns `openai`), so this pool of
 * well-known owners is matched locally to cover those cases.
 */
export async function popularOwners(): Promise<string[]> {
  const logins = new Set<string>()
  for (let page = 1; page <= 3; page++) {
    const q = encodeURIComponent("stars:>12000")
    const data = await gh<{ items: Repo[] }>(
      `/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`,
      86400,
    )
    if (!data?.items?.length) break
    for (const r of data.items) logins.add(r.owner.login)
  }
  return [...logins]
}

export const hasToken = Boolean(token)
