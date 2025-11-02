import { BuildJob, BuildConfig } from './types'
import { getCacheKey, isCached, getCachePath, ensureCacheDir } from './cache'
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import Bottleneck from 'bottleneck'

const jobs = new Map<string, BuildJob>()
const MAX_CONCURRENT_BUILDS = 2

export class JobManager {
  private limiter: Bottleneck

  constructor() {
    this.limiter = new Bottleneck({
      maxConcurrent: MAX_CONCURRENT_BUILDS,
    })
  }

  async createJob(config: BuildConfig): Promise<BuildJob> {
    ensureCacheDir()

    const cacheKey = getCacheKey(config)
    const id = `build-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Check if already cached
    if (isCached(cacheKey)) {
      const cachedPath = getCachePath(cacheKey)
      const job: BuildJob = {
        id,
        config,
        status: 'completed',
        progress: ['Build found in cache'],
        cacheKey,
        outputPath: cachedPath,
        createdAt: Date.now(),
        completedAt: Date.now(),
      }
      jobs.set(id, job)
      return job
    }

    const job: BuildJob = {
      id,
      config,
      status: 'queued',
      progress: ['Job queued'],
      cacheKey,
      createdAt: Date.now(),
    }
    jobs.set(id, job)

    // Queue the build
    this.limiter.schedule(() => this.executeBuild(job))

    return job
  }

  private async executeBuild(job: BuildJob): Promise<void> {
    job.status = 'building'
    job.progress.push('Starting Docker build...')

    const buildDir = join('/tmp', `build-${job.id}`)
    const outputDir = join(buildDir, 'output')
    mkdirSync(outputDir, { recursive: true })

    // Write config file
    const configFile = join(buildDir, 'config.json')
    writeFileSync(configFile, JSON.stringify(job.config, null, 2))

    try {
      // Launch Docker container
      const dockerProcess = spawn('docker', [
        'run',
        '--rm',
        '-v',
        `${configFile}:/config.json`,
        '-v',
        `${outputDir}:/output`,
        '-e',
        'CONFIG_FILE=/config.json',
        '-e',
        'OUTPUT_DIR=/output',
        'meshtastic-builder:latest',
      ])

      let stdout = ''
      let stderr = ''

      dockerProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        const lines = text.split('\n').filter((l) => l.trim())
        lines.forEach((line) => {
          if (line.trim()) {
            job.progress.push(line)
          }
        })
      })

      dockerProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        const lines = text.split('\n').filter((l) => l.trim())
        lines.forEach((line) => {
          if (line.trim() && !line.includes('WARNING')) {
            job.progress.push(`[ERROR] ${line}`)
          }
        })
      })

      await new Promise<void>((resolve, reject) => {
        dockerProcess.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Build failed with code ${code}: ${stderr}`))
          }
        })

        dockerProcess.on('error', (err) => {
          reject(err)
        })
      })

      // Move build artifacts to cache
      const cachePath = getCachePath(job.cacheKey)
      mkdirSync(cachePath, { recursive: true })

      // Copy all files from output to cache
      if (existsSync(outputDir)) {
        const files = readdirSync(outputDir)
        for (const file of files) {
          const srcPath = join(outputDir, file)
          const destPath = join(cachePath, file)
          const stat = statSync(srcPath)
          if (stat.isFile()) {
            copyFileSync(srcPath, destPath)
          }
        }
      }

      job.status = 'completed'
      job.outputPath = cachePath
      job.completedAt = Date.now()
      job.progress.push('Build completed successfully')
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.completedAt = Date.now()
      job.progress.push(`Build failed: ${job.error}`)
    }
  }

  getJob(id: string): BuildJob | undefined {
    return jobs.get(id)
  }
}

export const jobManager = new JobManager()
