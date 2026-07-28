import { matchedIndices } from "@/lib/fuzzy"

export function FuzzyText({ fragment, text }: { fragment: string; text: string }) {
  const hits = new Set(matchedIndices(fragment, text))
  return (
    <span>
      {text.split("").map((char, i) => (
        <span
          key={`${char}-${i}`}
          className={hits.has(i) ? "text-primary" : "text-muted-foreground"}
        >
          {char}
        </span>
      ))}
    </span>
  )
}
