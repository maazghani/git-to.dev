export type MatchKind = "exact" | "prefix" | "substring" | "subsequence"

export const KIND_RANK: Record<MatchKind, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
  subsequence: 3,
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s_.-]/g, "")

/** True if every char of `frag` appears in `target` in order. */
function isSubsequence(frag: string, target: string): boolean {
  let i = 0
  for (let j = 0; j < target.length && i < frag.length; j++) {
    if (target[j] === frag[i]) i++
  }
  return i === frag.length
}

/**
 * Classify how `fragment` matches `target`. Returns null when there is no match
 * at all. Matching is case-insensitive and ignores separators (-, _, ., space)
 * so `nextjs` matches `next.js` and `ksail` matches `k-sail`.
 */
export function matchKind(fragment: string, target: string): MatchKind | null {
  const f = fragment.toLowerCase()
  const t = target.toLowerCase()
  if (!f) return null
  if (f === t) return "exact"
  if (t.startsWith(f)) return "prefix"
  if (t.includes(f)) return "substring"

  const nf = normalize(fragment)
  const nt = normalize(target)
  if (nf === nt) return "exact"
  if (nt.startsWith(nf)) return "prefix"
  if (nt.includes(nf)) return "substring"
  if (isSubsequence(nf, nt)) return "subsequence"
  return null
}

export type Scored = {
  kind: MatchKind
  /** lower is better */
  rank: number
  /** characters in the target that the fragment did not spell out */
  extra: number
  length: number
}

export function score(fragment: string, target: string): Scored | null {
  const kind = matchKind(fragment, target)
  if (!kind) return null
  return {
    kind,
    rank: KIND_RANK[kind],
    extra: Math.max(0, normalize(target).length - normalize(fragment).length),
    length: target.length,
  }
}

/**
 * Strictly-shortest-name ordering: better match kind first, then the shortest
 * name (fewest extra characters), then alphabetical for a stable result.
 */
export function compareScored(a: { s: Scored; name: string }, b: { s: Scored; name: string }): number {
  if (a.s.rank !== b.s.rank) return a.s.rank - b.s.rank
  if (a.s.length !== b.s.length) return a.s.length - b.s.length
  return a.name.localeCompare(b.name)
}

/** Indices of `target` consumed by `fragment`, for highlighting. */
export function matchedIndices(fragment: string, target: string): number[] {
  const f = fragment.toLowerCase().replace(/[\s_.-]/g, "")
  const out: number[] = []
  let i = 0
  for (let j = 0; j < target.length && i < f.length; j++) {
    const ch = target[j].toLowerCase()
    if (/[\s_.-]/.test(ch)) continue
    if (ch === f[i]) {
      out.push(j)
      i++
    }
  }
  return i === f.length ? out : []
}
