import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const FIRMWARE_DIR = join(process.cwd(), 'firmware')
const PULL_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

async function pullFirmware(): Promise<void> {
  if (!existsSync(FIRMWARE_DIR)) {
    console.log('Firmware directory does not exist, skipping pull')
    return
  }

  console.log(
    `[${new Date().toISOString()}] Starting firmware repository pull...`
  )

  try {
    // Change to firmware directory and fetch all branches
    const fetchProcess = spawn('git', ['fetch', '--all'], {
      cwd: FIRMWARE_DIR,
      stdio: 'pipe',
    })

    let fetchOutput = ''
    let fetchError = ''

    fetchProcess.stdout.on('data', (data: Buffer) => {
      fetchOutput += data.toString()
    })

    fetchProcess.stderr.on('data', (data: Buffer) => {
      fetchError += data.toString()
    })

    await new Promise<void>((resolve, reject) => {
      fetchProcess.on('close', (code) => {
        if (code === 0) {
          console.log(
            `[${new Date().toISOString()}] Successfully fetched all branches`
          )
          resolve()
        } else {
          console.error(
            `[${new Date().toISOString()}] Git fetch failed with code ${code}: ${fetchError}`
          )
          reject(new Error(`Git fetch failed: ${fetchError}`))
        }
      })

      fetchProcess.on('error', (err) => {
        console.error(
          `[${new Date().toISOString()}] Git fetch error:`,
          err.message
        )
        reject(err)
      })
    })
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error pulling firmware:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function startFirmwarePuller(): void {
  console.log(
    `[${new Date().toISOString()}] Starting firmware puller (runs every hour)`
  )

  // Run immediately on startup
  pullFirmware()

  // Then run every hour
  setInterval(() => {
    pullFirmware()
  }, PULL_INTERVAL_MS)
}
