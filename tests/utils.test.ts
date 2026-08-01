import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils"

describe("cn", () => {
  it("combines conditional class names", () => {
    expect(cn("rounded", false && "hidden", { "font-bold": true })).toBe("rounded font-bold")
  })

  it("keeps the last conflicting Tailwind utility", () => {
    expect(cn("px-2 text-sm", "px-4 text-lg")).toBe("px-4 text-lg")
  })
})
