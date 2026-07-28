"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SITE_HOST, SITE_URL } from "@/lib/site"
import { Check, Copy, Link2, Loader2, TriangleAlert } from "lucide-react"
import { useState } from "react"

type Result =
  | { status: "ok"; owner: string; repo: string; path: string; fullName: string }
  | { status: "miss"; reason: string }
  | { status: "idle" }

export function Shortener() {
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const repo = value.trim()
    if (!repo || loading) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`/api/shorten?repo=${encodeURIComponent(repo)}`)
      setResult((await res.json()) as Result)
    } catch {
      setResult({ status: "miss", reason: "Lookup failed" })
    } finally {
      setLoading(false)
    }
  }

  const shortUrl = result?.status === "ok" ? `${SITE_URL}/${result.path}` : ""

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" aria-labelledby="shorten-heading">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" aria-hidden="true" />
        <h2 id="shorten-heading" className="text-sm">
          shortest {SITE_HOST} link for a repo
        </h2>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) e.stopPropagation()
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Full repo, owner/name or github.com URL"
          placeholder="github.com/maazghani/ksailnet"
          className="h-11 flex-1 border-border bg-background font-mono text-sm"
        />
        <Button type="submit" className="h-11" disabled={loading || !value.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "shorten"}
        </Button>
      </form>

      {result?.status === "ok" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <code className="truncate text-sm text-foreground">
              {SITE_HOST}/{result.path}
            </code>
            <span className="truncate font-sans text-xs text-muted-foreground">resolves to {result.fullName}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(shortUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            <span className="sr-only">Copy short link</span>
          </Button>
        </div>
      )}

      {result?.status === "miss" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          {result.reason}
        </p>
      )}
    </section>
  )
}
