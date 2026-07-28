"use client"

import { FuzzyText } from "@/components/fuzzy-text"
import { Button } from "@/components/ui/button"
import type { Resolution } from "@/lib/resolve"
import { SITE_HOST, SITE_URL } from "@/lib/site"
import { ArrowUpRight, Check, Copy, CornerDownLeft, Loader2, TriangleAlert } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

const EXAMPLES = ["maaz/ks", "oai/cx", "verc/next", "fb/react"]

function Stars({ count }: { count: number }) {
  const label = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
  return <span className="text-muted-foreground">{label} stars</span>
}

export function Resolver() {
  const params = useSearchParams()
  const initial = params.get("q") ?? ""
  const missed = params.get("miss")

  const [value, setValue] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Resolution | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 350)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    const query = debounced.replace(/^\/+/, "")
    if (!query) {
      setResult(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/resolve?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Resolution) => setResult(data))
      .catch((err) => {
        if (err?.name !== "AbortError") setResult({ status: "miss", query, reason: "Lookup failed" })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [debounced])

  const [ownerFrag = "", repoFrag = ""] = debounced.replace(/^\/+/, "").split("/")
  const shortLink = result && result.status === "hit" ? `${SITE_URL}/${debounced.replace(/^\/+/, "")}` : ""

  return (
    <section className="flex flex-col gap-4" aria-labelledby="resolve-heading">
      <h2 id="resolve-heading" className="sr-only">
        Resolve a fuzzy repo path
      </h2>

      <div className="flex h-14 items-center gap-2 rounded-xl border border-border bg-card px-4 shadow-sm focus-within:border-primary">
        <span className="shrink-0 text-sm text-muted-foreground select-none">{SITE_HOST}/</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === "Enter" && result?.status === "hit") window.open(result.match.url, "_blank")
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Fuzzy repo path, for example maaz/ks"
          placeholder="maaz/ks"
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-base text-foreground outline-none placeholder:text-muted-foreground/60 md:text-lg"
        />
        <span className="pointer-events-none flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              <CornerDownLeft className="size-3.5" aria-hidden="true" />
              open
            </>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setValue(ex)
              inputRef.current?.focus()
            }}
            className="rounded-md border border-border bg-secondary px-2 py-1 text-secondary-foreground transition-colors hover:border-primary hover:text-primary"
          >
            {ex}
          </button>
        ))}
      </div>

      {missed && !value && (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          {missed === "rate-limited"
            ? "GitHub rate limit reached — try again in a minute."
            : "That path did not resolve to a repo."}
        </p>
      )}

      {result?.status === "hit" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.match.avatar || "/placeholder.svg"}
                alt=""
                width={40}
                height={40}
                className="mt-0.5 size-10 rounded-lg border border-border"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-1 text-base">
                  <FuzzyText fragment={ownerFrag} text={result.match.owner} />
                  <span className="text-muted-foreground">/</span>
                  <FuzzyText fragment={repoFrag} text={result.match.repo} />
                </div>
                <p className="truncate text-xs text-primary">
                  {SITE_HOST}/{debounced.replace(/^\/+/, "")}
                </p>
                {result.match.description && (
                  <p className="truncate font-sans text-sm leading-relaxed text-muted-foreground">
                    {result.match.description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <Stars count={result.match.stars} />
                  {result.match.language && <span className="text-muted-foreground">{result.match.language}</span>}
                  <span className="text-primary/80">
                    {result.match.ownerKind} + {result.match.repoKind}
                  </span>
                  {result.match.archived && <span className="text-muted-foreground">archived</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(shortLink)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  aria-label="Copy short link"
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                </Button>
                <Button
                  size="sm"
                  render={<a href={result.match.url} target="_blank" rel="noreferrer noopener" />}
                >
                  open
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          {result.alternates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">also matched</p>
              <ul className="flex flex-col">
                {result.alternates.map((alt) => (
                  <li key={alt.fullName}>
                    <a
                      href={alt.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
                    >
                      <span className="truncate">
                        <FuzzyText fragment={ownerFrag} text={alt.owner} />
                        <span className="text-muted-foreground">/</span>
                        <FuzzyText fragment={repoFrag} text={alt.repo} />
                      </span>
                      <Stars count={alt.stars} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result?.status === "owner" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.owner.avatar || "/placeholder.svg"}
              alt=""
              width={40}
              height={40}
              className="size-10 rounded-lg border border-border"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <FuzzyText fragment={ownerFrag} text={result.owner.login} />
              <p className="font-sans text-xs text-muted-foreground">
                add a second segment to reach a repo, e.g. /{result.owner.login.slice(0, ownerFrag.length)}/re
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              render={<a href={result.owner.url} target="_blank" rel="noreferrer noopener" />}
            >
              profile
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {result && (result.status === "miss" || result.status === "rate-limited") && !loading && (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          {result.reason}
        </p>
      )}
    </section>
  )
}
