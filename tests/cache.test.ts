import { beforeEach, describe, expect, it, vi } from "vitest"

// `vi.mock` factories are hoisted to the top of the file before any variable
// declarations, so we cannot reference module-scope `const` from inside the
// factory. Instead, we keep state entirely inside the factory and expose it
// through a `__test__` export on the mock module so tests can inspect it.
vi.mock("@upstash/redis", () => {
  const store = new Map<string, unknown>()

  const getMock = vi.fn(async (key: string) => store.get(key) ?? null)
  const setMock = vi.fn(async (key: string, value: unknown, _opts?: unknown) => {
    store.set(key, value)
    return "OK"
  })

  class RedisMock {
    get = getMock
    set = setMock
  }

  return {
    Redis: RedisMock,
    // Exported so tests can reach the mocks without coupling to internals.
    __test__: { store, getMock, setMock },
  }
})

import * as upstashModule from "@upstash/redis"
import { getCachedResolution, resolutionCacheKey, setCachedResolution } from "@/lib/cache"

// Typed handle to the in-factory state.
const { store, getMock, setMock } = (upstashModule as unknown as {
  __test__: {
    store: Map<string, unknown>
    getMock: ReturnType<typeof vi.fn>
    setMock: ReturnType<typeof vi.fn>
  }
}).__test__

beforeEach(() => {
  store.clear()
  getMock.mockClear()
  setMock.mockClear()
  // Restore default implementations after any per-test overrides.
  getMock.mockImplementation(async (key: string) => store.get(key) ?? null)
  setMock.mockImplementation(async (key: string, value: unknown) => {
    store.set(key, value)
    return "OK"
  })
})

describe("resolutionCacheKey", () => {
  it("lowercases the query", () => {
    expect(resolutionCacheKey("OpenAI/Codex")).toBe("resolution:openai/codex")
  })

  it("prefixes with 'resolution:'", () => {
    expect(resolutionCacheKey("vercel/next.js")).toBe("resolution:vercel/next.js")
  })
})

describe("getCachedResolution", () => {
  it("returns null on a cache miss", async () => {
    const result = await getCachedResolution("nobody/nothing")
    expect(result).toBeNull()
  })

  it("returns the stored value on a cache hit", async () => {
    const stored = { status: "hit", query: "openai/codex" }
    store.set("resolution:openai/codex", stored)

    const result = await getCachedResolution("openai/codex")
    expect(result).toEqual(stored)
  })

  it("normalises the query key to lowercase", async () => {
    const stored = { status: "hit", query: "OpenAI/Codex" }
    store.set("resolution:openai/codex", stored)

    const result = await getCachedResolution("OpenAI/Codex")
    expect(result).toEqual(stored)
  })

  it("returns null and does not throw when Redis errors", async () => {
    getMock.mockRejectedValueOnce(new Error("connection refused"))

    await expect(getCachedResolution("openai/codex")).resolves.toBeNull()
  })
})

describe("setCachedResolution", () => {
  it("stores the value under the normalised key with a 7-day TTL", async () => {
    const value = { status: "hit", query: "vercel/next.js" }

    await setCachedResolution("vercel/next.js", value)

    expect(setMock).toHaveBeenCalledWith(
      "resolution:vercel/next.js",
      value,
      { ex: 604800 },
    )
  })

  it("passes the 7-day TTL (604800 seconds)", async () => {
    await setCachedResolution("a/b", { status: "hit" })

    const [, , opts] = setMock.mock.calls[0] as [string, unknown, { ex: number }]
    expect(opts.ex).toBe(604800)
  })

  it("does not throw when Redis errors", async () => {
    setMock.mockRejectedValueOnce(new Error("timeout"))

    await expect(setCachedResolution("a/b", { status: "hit" })).resolves.toBeUndefined()
  })
})
