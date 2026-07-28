import { Resolver } from "@/components/resolver"
import { Shortener } from "@/components/shortener"
import { hasToken } from "@/lib/github"
import { GitBranch } from "lucide-react"
import { Suspense } from "react"

const RULES = [
  { label: "exact", detail: "verc → verc" },
  { label: "prefix", detail: "maaz → maazghani" },
  { label: "substring", detail: "ail → ksailnet" },
  { label: "subsequence", detail: "cx → codex" },
]

export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-10 px-5 py-12 md:py-20">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-primary">
          <GitBranch className="size-4" aria-hidden="true" />
          git-hb
        </div>
        <h1 className="text-balance text-3xl leading-tight tracking-tight md:text-4xl">
          the shortest link to any <span className="text-primary">GitHub repo</span>
        </h1>
        <p className="max-w-xl text-pretty font-sans text-base leading-relaxed text-muted-foreground">
          Type the fewest characters that uniquely identify an owner and a repo. Hitting the path redirects
          straight to GitHub, so <code className="text-foreground">/maaz/ks</code> is a shareable link to{" "}
          <code className="text-foreground">github.com/maazghani/ksailnet</code>.
        </p>
      </header>

      <Suspense fallback={<div className="h-14 rounded-xl border border-border bg-card" />}>
        <Resolver />
      </Suspense>

      <Shortener />

      <section className="flex flex-col gap-4" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-sm uppercase tracking-wide text-muted-foreground">
          how matching works
        </h2>
        <ol className="flex flex-col gap-3 font-sans text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground">1. Owners first.</span> Candidates come from an exact login lookup,
            GitHub&apos;s user index, and a cached pool of the most-starred owners (GitHub&apos;s index can&apos;t
            return <code>openai</code> for <code>oai</code>, so that pool covers it).
          </li>
          <li>
            <span className="text-foreground">2. Shortest name wins.</span> Candidates are ordered by match quality,
            then strictly by name length — never by popularity — so the least-padded name is the answer.
          </li>
          <li>
            <span className="text-foreground">3. First owner with a repo hit takes it.</span> Owners are walked in
            that order; the first one holding a repo that matches the second segment resolves the link.
          </li>
          <li>
            <span className="text-foreground">4. Extra segments pass through.</span>{" "}
            <code>/maaz/ks/tree/main</code> lands on that branch, and <code>?preview=1</code> shows the resolution
            here instead of redirecting.
          </li>
        </ol>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RULES.map((rule) => (
            <li key={rule.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-xs text-primary">{rule.label}</p>
              <p className="truncate text-xs text-muted-foreground">{rule.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-6 font-sans text-xs text-muted-foreground">
        <p>Separators (-, _, .) are ignored, so nextjs matches next.js.</p>
        {!hasToken && (
          <p>
            Running unauthenticated against the GitHub API (10 searches/min). Add a{" "}
            <code className="text-foreground">GITHUB_TOKEN</code> environment variable to raise the limit.
          </p>
        )}
      </footer>
    </main>
  )
}
