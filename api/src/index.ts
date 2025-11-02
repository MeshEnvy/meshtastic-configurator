import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jobManager } from './jobs'
import { BuildConfig } from './types'
import { readdirSync } from 'fs'
import { join } from 'path'
import { startFirmwarePuller } from './firmware-puller'
import {
  getBranches,
  getTags,
  getLatestTag,
  validateRef,
  getEnvironments,
} from './firmware-info'
import { CONFIG_OPTIONS } from './config-options'

const app = new Hono()

// CORS middleware
app.use('*', cors())

// Get branches endpoint
app.get('/firmware/branches', async (c) => {
  try {
    const branches = await getBranches()
    return c.json(branches)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Get tags endpoint
app.get('/firmware/tags', async (c) => {
  try {
    const tags = await getTags()
    return c.json(tags)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Get latest tag endpoint
app.get('/firmware/latest-tag', async (c) => {
  try {
    const latestTag = await getLatestTag()
    return c.json({ tag: latestTag })
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Validate ref endpoint
app.post('/firmware/validate', async (c) => {
  try {
    const body = await c.req.json()
    const ref = body.ref || body.branch

    if (!ref || typeof ref !== 'string') {
      return c.json({ error: 'Ref is required' }, 400)
    }

    const validation = await validateRef(ref)
    return c.json(validation)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Get environments endpoint
app.get('/firmware/environments', async (c) => {
  try {
    const environments = await getEnvironments()
    return c.json(environments)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Get configuration options endpoint
app.get('/config/options', async (c) => {
  try {
    return c.json(CONFIG_OPTIONS)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// Build request endpoint
app.post('/build', async (c) => {
  try {
    const config: BuildConfig = await c.req.json()

    if (!config.branch) {
      return c.json({ error: 'Branch is required' }, 400)
    }

    // Validate the ref before creating the job
    const validation = await validateRef(config.branch)
    if (!validation.valid) {
      return c.json(
        {
          error: validation.error || 'Invalid branch, tag, or commit',
        },
        400
      )
    }

    const job = await jobManager.createJob(config)
    return c.json(job)
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// SSE progress endpoint
app.get('/build/:id/progress', async (c) => {
  const jobId = c.req.param('id')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller: ReadableStreamDefaultController) {
      const interval = setInterval(() => {
        const job = jobManager.getJob(jobId)

        if (!job) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: 'Job not found' })}\n\n`
            )
          )
          controller.close()
          clearInterval(interval)
          return
        }

        const data = {
          status: job.status,
          progress: job.progress,
          outputPath: job.outputPath,
          error: job.error,
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

        if (job.status === 'completed' || job.status === 'failed') {
          controller.close()
          clearInterval(interval)
        }
      }, 500) // Poll every 500ms
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

// Job status endpoint
app.get('/build/:id', async (c) => {
  const jobId = c.req.param('id')
  const job = jobManager.getJob(jobId)

  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }

  return c.json(job)
})

// Download endpoint
app.get('/download/:cacheKey', async (c) => {
  const cacheKey = c.req.param('cacheKey')
  const cacheDir = `.buildcache/${cacheKey}`

  try {
    const files = readdirSync(cacheDir)
    const firmwareFile = files.find(
      (f: string) => f.endsWith('.bin') || f.endsWith('.elf')
    )

    if (firmwareFile) {
      const filePath = Bun.file(join(cacheDir, firmwareFile))
      if (await filePath.exists()) {
        return new Response(filePath, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${firmwareFile}"`,
          },
        })
      }
    }
  } catch (error) {
    // Fall through to 404
  }

  return c.json({ error: 'File not found' }, 404)
})

const PORT = (Bun.env.PORT ? parseInt(Bun.env.PORT) : undefined) || 3000

Bun.serve({
  port: PORT,
  fetch: app.fetch,
})

console.log(`Server running on http://localhost:${PORT}`)

// Start firmware puller to update repository every hour
startFirmwarePuller()
