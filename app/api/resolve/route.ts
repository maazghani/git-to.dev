import { resolvePath } from "@/lib/resolve"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const raw = (searchParams.get("q") ?? "").trim().replace(/^\/+|\/+$/g, "")

  if (!raw) {
    return NextResponse.json({ status: "idle" })
  }

  const [ownerFragment, repoFragment] = raw.split("/")
  const resolution = await resolvePath(ownerFragment, repoFragment || undefined)

  return NextResponse.json(resolution, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" },
  })
}
