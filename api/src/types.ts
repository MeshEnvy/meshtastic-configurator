export interface BuildConfig {
  branch: string
  environment?: string
  buildFlags?: string[]
  features?: Record<string, unknown>
  [key: string]: unknown
}

export interface BuildJob {
  id: string
  config: BuildConfig
  status: 'queued' | 'building' | 'completed' | 'failed'
  progress: string[]
  cacheKey: string
  outputPath?: string
  error?: string
  createdAt: number
  completedAt?: number
}
