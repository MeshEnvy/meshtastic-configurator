import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const FIRMWARE_DIR = join(process.cwd(), 'firmware')

interface GitRef {
  name: string
  type: 'branch' | 'tag' | 'commit'
  commit: string
}

async function runGitCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('git', args, {
      cwd: FIRMWARE_DIR,
      stdio: 'pipe',
    })

    let output = ''
    let error = ''

    process.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    process.stderr.on('data', (data: Buffer) => {
      error += data.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim())
      } else {
        reject(new Error(`Git command failed: ${error}`))
      }
    })

    process.on('error', (err) => {
      reject(err)
    })
  })
}

export async function getBranches(): Promise<string[]> {
  if (!existsSync(FIRMWARE_DIR)) {
    return []
  }

  try {
    const output = await runGitCommand(['branch', '-r'])
    return output
      .split('\n')
      .filter((b) => b.trim())
      .map((b) => b.trim().replace(/^origin\//, '').replace(/^\*\s*/, ''))
      .filter((b) => b && !b.includes('HEAD'))
  } catch (error) {
    console.error('Error fetching branches:', error)
    return []
  }
}

export async function getTags(): Promise<string[]> {
  if (!existsSync(FIRMWARE_DIR)) {
    return []
  }

  try {
    const output = await runGitCommand(['tag', '--sort=-creatordate'])
    return output.split('\n').filter((t) => t.trim())
  } catch (error) {
    console.error('Error fetching tags:', error)
    return []
  }
}

export async function getLatestTag(): Promise<string | null> {
  if (!existsSync(FIRMWARE_DIR)) {
    return null
  }

  try {
    const tags = await getTags()
    return tags.length > 0 ? tags[0] : null
  } catch (error) {
    console.error('Error fetching latest tag:', error)
    return null
  }
}

export async function validateRef(ref: string): Promise<{
  valid: boolean
  type?: 'branch' | 'tag' | 'commit'
  error?: string
}> {
  if (!existsSync(FIRMWARE_DIR)) {
    return { valid: false, error: 'Firmware directory not found' }
  }

  // Check if it's a commit hash (7+ hex characters)
  if (/^[0-9a-f]{7,}$/i.test(ref)) {
    try {
      await runGitCommand(['cat-file', '-e', ref])
      return { valid: true, type: 'commit' }
    } catch {
      return { valid: false, error: 'Commit hash not found' }
    }
  }

  // Check if it's a branch
  try {
    await runGitCommand(['show-ref', '--verify', '--quiet', `refs/heads/${ref}`])
    return { valid: true, type: 'branch' }
  } catch {
    // Not a local branch, try remote
    try {
      await runGitCommand(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${ref}`])
      return { valid: true, type: 'branch' }
    } catch {
      // Not a branch, continue
    }
  }

  // Check if it's a tag
  try {
    await runGitCommand(['show-ref', '--verify', '--quiet', `refs/tags/${ref}`])
    return { valid: true, type: 'tag' }
  } catch {
    return { valid: false, error: 'Branch, tag, or commit not found' }
  }
}

