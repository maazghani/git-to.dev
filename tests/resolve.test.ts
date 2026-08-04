import { beforeEach, describe, expect, it, vi } from "vitest"

// Prevent any real Redis calls during unit tests.
vi.mock("@/lib/cache", () => ({
  getCachedResolution: vi.fn().mockResolvedValue(null),
  setCachedResolution: vi.fn().mockResolvedValue(undefined),
  resolutionCacheKey: (q: string) => `resolution:${q.toLowerCase()}`,
}))

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
import { parseRepoInput, resolvePath, shortestPath } from "@/lib/resolve"

vi.mock("@/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github")>()
  return {
    ...actual,
    getOwner: vi.fn(),
    getRepo: vi.fn(),
    listRepos: vi.fn(),
    popularOwners: vi.fn(),
    searchOwners: vi.fn(),
    searchRepos: vi.fn(),
    searchReposForOwners: vi.fn(),
  }
})

const getOwnerMock = vi.mocked(getOwner)
const getRepoMock = vi.mocked(getRepo)
const listReposMock = vi.mocked(listRepos)
const popularOwnersMock = vi.mocked(popularOwners)
const searchOwnersMock = vi.mocked(searchOwners)
const searchReposMock = vi.mocked(searchRepos)
const searchReposForOwnersMock = vi.mocked(searchReposForOwners)

function makeOwner(login: string): Owner {
  return {
    login,
    avatar_url: `https://github.com/${login}.png`,
  }
}

function makeRepo(ownerLogin: string, name: string, stars = 0, overrides: Partial<Repo> = {}): Repo {
  return {
    name,
    full_name: `${ownerLogin}/${name}`,
    description: null,
    stargazers_count: stars,
    language: null,
    fork: false,
    archived: false,
    html_url: `https://github.com/${ownerLogin}/${name}`,
    owner: makeOwner(ownerLogin),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  getOwnerMock.mockResolvedValue(null)
  getRepoMock.mockResolvedValue(null)
  listReposMock.mockResolvedValue([])
  popularOwnersMock.mockResolvedValue([])
  searchOwnersMock.mockResolvedValue([])
  searchReposMock.mockResolvedValue([])
  searchReposForOwnersMock.mockResolvedValue([])
})

describe("parseRepoInput", () => {
  it.each([
    ["owner/repo", { owner: "owner", repo: "repo" }],
    [" /Owner/repo-name/ ", { owner: "Owner", repo: "repo-name" }],
    ["https://github.com/owner/repo.git", { owner: "owner", repo: "repo" }],
    ["http://www.github.com/owner/repo", { owner: "owner", repo: "repo" }],
    ["github.com/owner/repo/tree/main", { owner: "owner", repo: "repo" }],
  ] as const)("parses %s", (input, expected) => {
    expect(parseRepoInput(input)).toEqual(expected)
  })

  it.each(["", "owner", "owner_name/repo", "owner/repo name"])("rejects %s", (input) => {
    expect(parseRepoInput(input)).toBeNull()
  })
})

describe("resolvePath", () => {
  it("rejects invalid fragments without calling GitHub", async () => {
    await expect(resolvePath("bad owner")).resolves.toEqual({
      status: "miss",
      query: "bad owner",
      reason: "Invalid owner fragment",
    })
    await expect(resolvePath("owner", "bad/repo")).resolves.toEqual({
      status: "miss",
      query: "owner/bad/repo",
      reason: "Invalid repo fragment",
    })

    expect(getOwnerMock).not.toHaveBeenCalled()
    expect(searchOwnersMock).not.toHaveBeenCalled()
  })

  it("ranks owner matches by kind and returns alternates", async () => {
    getOwnerMock.mockResolvedValue(makeOwner("open"))
    searchOwnersMock.mockResolvedValue([makeOwner("openai"), makeOwner("theopen")])

    const result = await resolvePath("open")

    expect(result).toEqual({
      status: "owner",
      query: "open",
      owner: {
        login: "open",
        avatar: "https://github.com/open.png",
        url: "https://github.com/open",
        kind: "exact",
      },
      alternates: [
        {
          login: "openai",
          avatar: "https://github.com/openai.png",
          url: "https://github.com/openai",
          kind: "prefix",
        },
        {
          login: "theopen",
          avatar: "https://github.com/theopen.png",
          url: "https://github.com/theopen",
          kind: "substring",
        },
      ],
    })
    expect(popularOwnersMock).not.toHaveBeenCalled()
  })

  it("ranks owner/repo pairs by combined match quality before stars", async () => {
    getOwnerMock.mockResolvedValue(makeOwner("acme"))
    searchOwnersMock.mockResolvedValue([makeOwner("acme-labs")])
    listReposMock.mockImplementation(async (login) => {
      if (login === "acme") return [makeRepo("acme", "widget-kit", 1)]
      return [makeRepo("acme-labs", "widget", 100_000)]
    })

    const result = await resolvePath("acme", "widget")

    expect(result.status).toBe("hit")
    if (result.status !== "hit") throw new Error("Expected a repository hit")
    expect(result.match.fullName).toBe("acme/widget-kit")
    expect(result.alternates.map((hit) => hit.fullName)).toEqual(["acme-labs/widget"])
  })

  it("uses stars only to break otherwise equal repository matches", async () => {
    getOwnerMock.mockResolvedValue(makeOwner("acme"))
    searchOwnersMock.mockResolvedValue([])
    listReposMock.mockResolvedValue([
      makeRepo("acme", "abx", 2),
      makeRepo("acme", "aby", 10),
    ])

    const result = await resolvePath("acme", "ab")

    expect(result.status).toBe("hit")
    if (result.status !== "hit") throw new Error("Expected a repository hit")
    expect(result.match.fullName).toBe("acme/aby")
  })

  it("converts GitHub rate limits into a resolution result", async () => {
    getOwnerMock.mockRejectedValue(new RateLimited())

    await expect(resolvePath("openai")).resolves.toEqual({
      status: "rate-limited",
      query: "openai",
      reason: "GitHub API rate limit reached. Add a GITHUB_TOKEN environment variable to raise the limit.",
    })
  })

  it("resolves an exact repository without using GitHub search", async () => {
    getRepoMock.mockResolvedValue(makeRepo("openai", "codex", 100_000))

    const result = await resolvePath("openai", "codex")

    expect(result.status).toBe("hit")
    if (result.status !== "hit") throw new Error("Expected a repository hit")
    expect(result.match.fullName).toBe("openai/codex")
    expect(result.match.ownerKind).toBe("exact")
    expect(result.match.repoKind).toBe("exact")
    expect(searchOwnersMock).not.toHaveBeenCalled()
    expect(searchReposForOwnersMock).not.toHaveBeenCalled()
  })
})

describe("shortestPath", () => {
  beforeEach(() => {
    getRepoMock.mockImplementation(async (owner, repo) => makeRepo(owner, repo))
  })

  it("returns the first owner and repo prefixes that resolve to the target", async () => {
    searchOwnersMock.mockResolvedValue([makeOwner("acme")])
    listReposMock.mockResolvedValue([makeRepo("acme", "widget")])

    await expect(shortestPath("acme", "widget")).resolves.toEqual({
      status: "ok",
      owner: "a",
      repo: "w",
      path: "a/w",
      fullName: "acme/widget",
    })
  })

  it("does not spend wide-search quota on prefixes where the target already loses", async () => {
    const wideOwners = Array.from({ length: 50 }, (_, index) => makeOwner(`acandidate${index}`))
    searchOwnersMock.mockResolvedValue([makeOwner("aa"), makeOwner("acme"), ...wideOwners])
    listReposMock.mockImplementation(async (login) => {
      if (login === "aa") return [makeRepo("aa", "w")]
      if (login === "acme") return [makeRepo("acme", "widget")]
      return []
    })

    await expect(shortestPath("acme", "widget")).resolves.toMatchObject({
      status: "ok",
      path: "a/wi",
      fullName: "acme/widget",
    })

    expect(searchReposForOwnersMock).toHaveBeenCalled()
    expect(searchReposForOwnersMock.mock.calls.every(([, fragment]) => fragment === "wi")).toBe(true)
  })

  it("falls back to the exact path when pair matching reaches the search limit", async () => {
    const wideOwners = Array.from({ length: 50 }, (_, index) => makeOwner(`acandidate${index}`))
    searchOwnersMock.mockResolvedValue([makeOwner("acme"), ...wideOwners])
    listReposMock.mockImplementation(async (login) => (
      login === "acme" ? [makeRepo("acme", "widget")] : []
    ))
    searchReposForOwnersMock.mockRejectedValue(new RateLimited())

    await expect(shortestPath("acme", "widget")).resolves.toEqual({
      status: "ok",
      owner: "acme",
      repo: "widget",
      path: "acme/widget",
      fullName: "acme/widget",
      limited: true,
    })
  })

  it("rejects a repository that does not exist", async () => {
    getRepoMock.mockResolvedValue(null)

    await expect(shortestPath("acme", "missing")).resolves.toEqual({
      status: "miss",
      reason: "GitHub repository acme/missing was not found.",
    })
    expect(searchOwnersMock).not.toHaveBeenCalled()
  })
})
