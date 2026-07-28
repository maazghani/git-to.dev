import { resolvePath } from "@/lib/resolve"
import { NextResponse } from "next/server"

const IGNORED = new Set(["favicon.ico", "robots.txt", "sitemap.xml", "manifest.json", "_next", "api", "icon.svg"])

export async function GET(request: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params
  const url = new URL(request.url)
  const home = new URL("/", url)

  const [ownerFragment, repoFragment, ...rest] = slug

  if (!ownerFragment || IGNORED.has(ownerFragment) || /\.(png|svg|ico|txt|xml|json|webmanifest)$/.test(ownerFragment)) {
    return NextResponse.redirect(home, 307)
  }

  const query = repoFragment ? `${ownerFragment}/${repoFragment}` : ownerFragment
  const resolution = await resolvePath(ownerFragment, repoFragment)

  // ?preview=1 shows the resolution on the homepage instead of jumping to GitHub
  const wantsPreview = url.searchParams.has("preview")

  if (resolution.status === "hit" || resolution.status === "owner") {
    if (wantsPreview) {
      home.searchParams.set("q", query)
      return NextResponse.redirect(home, 307)
    }
    const base = resolution.status === "hit" ? resolution.match.url : resolution.owner.url
    const suffix = rest.length ? `/${rest.join("/")}` : ""
    const target = new URL(`${base}${suffix}`)
    for (const [key, value] of url.searchParams) target.searchParams.set(key, value)
    return NextResponse.redirect(target.toString(), 302)
  }

  home.searchParams.set("q", query)
  home.searchParams.set("miss", resolution.status === "rate-limited" ? "rate-limited" : "1")
  return NextResponse.redirect(home, 307)
}
