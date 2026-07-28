import { Resolver } from "@/components/resolver"
import { Shortener } from "@/components/shortener"
import { Button } from "@/components/ui/button"
import { hasToken } from "@/lib/github"
import { SITE_HOST } from "@/lib/site"
import { GitBranch } from "lucide-react"
import { Suspense } from "react"

const RULES = [
  { label: "exact", detail: "verc → verc" },
  { label: "prefix", detail: "maaz → maazghani" },
  { label: "substring", detail: "ail → ksailnet" },
  { label: "subsequence", detail: "cx → codex" },
]

const STEPS = [
  {
    title: "Owners first.",
    body: "Candidates come from an exact login lookup, GitHub's user index, and a cached pool of the most-starred owners.",
  },
  {
    title: "Whole pairs are scored.",
    body: "Both halves are matched together, so a weaker-looking owner still wins when it holds the tighter repo match.",
  },
  {
    title: "Tightest, then shortest.",
    body: "Match quality ranks first, then fewest total characters. Stars only break an exact tie.",
  },
  {
    title: "Extra segments pass through.",
    body: "/maaz/ks/tree/main lands on that branch, and ?preview=1 shows the resolution instead of redirecting.",
  },
]

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-5">
          <GitBranch className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="text-sm tracking-tight">{SITE_HOST}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              nativeButton={false}
              render={<a href="#how" />}
            >
              How it works
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              nativeButton={false}
              render={<a href="#shorten" />}
            >
              Shorten
            </Button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="flex flex-col items-center justify-center px-5 pt-20 pb-16 md:pt-28 md:pb-20">
          <h1 className="max-w-2xl text-center text-4xl font-semibold leading-[1.05] tracking-tighter text-balance md:text-6xl">
            The shortest link to
            <br />
            <span className="text-fade">any GitHub repo.</span>
          </h1>
          <p className="mt-6 text-center text-base text-muted-foreground">
            Fuzzy. Path-based. No account.
          </p>

          <div className="mt-10 w-full max-w-xl">
            <Suspense fallback={<div className="h-12 rounded-lg border border-border bg-card" />}>
              <Resolver />
            </Suspense>
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-5 pb-24">
          <section id="shorten" className="scroll-mt-20">
            <Shortener />
          </section>

          <section id="how" className="flex scroll-mt-20 flex-col gap-6" aria-labelledby="how-heading">
            <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
              How matching works
            </h2>
            <ol className="flex flex-col gap-5">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border font-mono text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <span className="text-foreground">{step.title}</span> {step.body}
                  </p>
                </li>
              ))}
            </ol>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {RULES.map((rule) => (
                <li key={rule.label} className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <p className="text-xs text-foreground">{rule.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{rule.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-5 py-8 text-xs text-muted-foreground">
          <p>
            Separators (-, _, .) are ignored, so <span className="font-mono">nextjs</span> matches{" "}
            <span className="font-mono">next.js</span>.
          </p>
          {!hasToken && (
            <p>
              Running unauthenticated against the GitHub API (10 searches/min). Add a{" "}
              <span className="font-mono text-foreground">GITHUB_TOKEN</span> to raise the limit.
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}
