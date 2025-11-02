import { jobManager } from './jobs'
import { BuildConfig } from './types'
import { readdirSync } from 'fs'
import { join } from 'path'

const PORT = (Bun.env.PORT ? parseInt(Bun.env.PORT) : undefined) || 3000

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url)

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Build request endpoint
    if (url.pathname === '/build' && req.method === 'POST') {
      try {
        const config: BuildConfig = await req.json()

        if (!config.branch) {
          return new Response(JSON.stringify({ error: 'Branch is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const job = await jobManager.createJob(config)

        return new Response(JSON.stringify(job), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
    }

    // SSE progress endpoint
    if (
      url.pathname.startsWith('/api/build/') &&
      url.pathname.endsWith('/progress')
    ) {
      const jobId = url.pathname.split('/')[3]

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

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            )

            if (job.status === 'completed' || job.status === 'failed') {
              controller.close()
              clearInterval(interval)
            }
          }, 500) // Poll every 500ms
        },
      })

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Job status endpoint
    if (url.pathname.startsWith('/api/build/')) {
      const jobId = url.pathname.split('/')[3]
      const job = jobManager.getJob(jobId)

      if (!job) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify(job), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Download endpoint
    if (url.pathname.startsWith('/api/download/')) {
      const cacheKey = url.pathname.split('/')[3]
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
                ...corsHeaders,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${firmwareFile}"`,
              },
            })
          }
        }
      } catch (error) {
        // Fall through to 404
      }

      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  },
})

console.log(`Server running on http://localhost:${PORT}`)
