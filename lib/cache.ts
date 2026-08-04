import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

/** 7 days in seconds */
const RESOLUTION_TTL = 60 * 60 * 24 * 7

export function resolutionCacheKey(query: string): string {
  return `resolution:${query.toLowerCase()}`
}

export async function getCachedResolution<T>(query: string): Promise<T | null> {
  try {
    return await redis.get<T>(resolutionCacheKey(query))
  } catch {
    // Cache errors must never break resolution
    return null
  }
}

export async function setCachedResolution<T>(query: string, value: T): Promise<void> {
  try {
    await redis.set(resolutionCacheKey(query), value, { ex: RESOLUTION_TTL })
  } catch {
    // Cache errors must never break resolution
  }
}
