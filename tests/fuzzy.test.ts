import { describe, expect, it } from "vitest"

import { compareScored, matchKind, matchedIndices, score } from "@/lib/fuzzy"

describe("matchKind", () => {
  it.each([
    ["React", "react", "exact"],
    ["next", "next.js", "prefix"],
    ["sail", "ksailnet", "substring"],
    ["nextjs", "next.js", "exact"],
    ["nextj", "next.js", "prefix"],
    ["xtj", "next.js", "substring"],
    ["cx", "codex", "subsequence"],
  ] as const)("classifies %s against %s as %s", (fragment, target, expected) => {
    expect(matchKind(fragment, target)).toBe(expected)
  })

  it("returns null when the fragment is empty or cannot match", () => {
    expect(matchKind("", "codex")).toBeNull()
    expect(matchKind("xyz", "codex")).toBeNull()
  })
})

describe("score", () => {
  it("reports match rank and normalized extra characters", () => {
    expect(score("cx", "codex")).toEqual({
      kind: "subsequence",
      rank: 3,
      extra: 3,
      length: 5,
    })
  })

  it("keeps raw target length while ignoring separators for extra characters", () => {
    expect(score("nextjs", "next.js")).toEqual({
      kind: "exact",
      rank: 0,
      extra: 0,
      length: 7,
    })
  })

  it("returns null for a non-match", () => {
    expect(score("xyz", "codex")).toBeNull()
  })
})

describe("compareScored", () => {
  it("prioritizes match kind over target length", () => {
    const exact = score("alphabet", "alphabet")
    const prefix = score("a", "ab")

    expect(exact).not.toBeNull()
    expect(prefix).not.toBeNull()
    expect(
      compareScored(
        { s: exact!, name: "alphabet" },
        { s: prefix!, name: "ab" },
      ),
    ).toBeLessThan(0)
  })

  it("uses shorter target length and then alphabetical order as tie-breakers", () => {
    const short = score("a", "ab")
    const long = score("a", "alphabet")
    const beta = score("a", "beta")
    const zeta = score("a", "zeta")

    expect(short && long && beta && zeta).toBeTruthy()
    expect(
      compareScored(
        { s: short!, name: "ab" },
        { s: long!, name: "alphabet" },
      ),
    ).toBeLessThan(0)
    expect(
      compareScored(
        { s: beta!, name: "beta" },
        { s: zeta!, name: "zeta" },
      ),
    ).toBeLessThan(0)
  })
})

describe("matchedIndices", () => {
  it.each([
    ["nextjs", "Next.js", [0, 1, 2, 3, 5, 6]],
    ["cx", "codex", [0, 4]],
    ["c_x", "Co-dex", [0, 5]],
    ["oo", "book", [1, 2]],
  ] as const)("finds the characters for %s in %s", (fragment, target, expected) => {
    expect(matchedIndices(fragment, target)).toEqual(expected)
  })

  it("returns no indices for an empty or incomplete match", () => {
    expect(matchedIndices("", "codex")).toEqual([])
    expect(matchedIndices("cz", "codex")).toEqual([])
  })
})
