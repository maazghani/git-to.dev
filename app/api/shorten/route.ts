import { parseRepoInput, shortestPath } from "@/lib/resolve"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const input = (searchParams.get("repo") ?? "").trim()

  if (!input) return NextResponse.json({ status: "idle" })

  const parsed = parseRepoInput(input)
  if (!parsed) {
    return NextResponse.json(
      { status: "miss", reason: "Enter a repo as owner/name or a github.com URL" },
      { status: 200 },
    )
  }

  const result = await shortestPath(parsed.owner, parsed.repo)
  return NextResponse.json(result)
}
