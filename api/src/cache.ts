import { createHash } from 'crypto'
import { BuildConfig } from './types'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const CACHE_DIR = '.buildcache'

export function getCacheKey(config: BuildConfig): string {
  // Create stable hash from sorted config
  const sortedConfig = JSON.stringify(config, Object.keys(config).sort())
  return createHash('sha256').update(sortedConfig).digest('hex')
}

export function getCachePath(cacheKey: string): string {
  return join(CACHE_DIR, cacheKey)
}

export function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

export function isCached(cacheKey: string): boolean {
  const cachePath = getCachePath(cacheKey)
  if (!existsSync(cachePath)) {
    return false
  }
  // Check if any firmware files exist
  try {
    const files = readdirSync(cachePath)
    return files.some((file) => file.endsWith('.bin') || file.endsWith('.elf'))
  } catch {
    return false
  }
}
