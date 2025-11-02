import { spawn } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const FIRMWARE_DIR = join(import.meta.dir, '..', 'firmware')

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

// Recursively find all platformio.ini files
function findPlatformioIniFiles(dir: string, fileList: string[] = []): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Skip certain directories
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.pio' ||
          entry.name === 'build'
        ) {
          continue
        }
        findPlatformioIniFiles(fullPath, fileList)
      } else if (entry.isFile() && entry.name === 'platformio.ini') {
        fileList.push(fullPath)
      }
    }
  } catch (error) {
    // Ignore permission errors and continue
  }
  return fileList
}

// Parse INI file and extract environment names from [env:...] sections
function parseEnvironmentsFromIni(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const envRegex = /^\[env:([^\]]+)\]/gm
    const environments: string[] = []
    let match

    while ((match = envRegex.exec(content)) !== null) {
      environments.push(match[1])
    }

    return environments
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error)
    return []
  }
}

export async function getEnvironments(): Promise<string[]> {
  if (!existsSync(FIRMWARE_DIR)) {
    return []
  }

  try {
    // Ensure we're on develop branch
    const currentBranch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']).catch(
      () => ''
    )
    if (currentBranch !== 'develop') {
      // Fetch latest develop
      await runGitCommand(['fetch', 'origin', 'develop'])
      // Checkout develop
      await runGitCommand(['checkout', 'develop'])
    }

    // Find all platformio.ini files
    const iniFiles = findPlatformioIniFiles(FIRMWARE_DIR)
    const allEnvironments = new Set<string>()

    // Parse each INI file for environments
    for (const iniFile of iniFiles) {
      const envs = parseEnvironmentsFromIni(iniFile)
      envs.forEach((env) => allEnvironments.add(env))
    }

    // Return sorted list
    return Array.from(allEnvironments).sort()
  } catch (error) {
    console.error('Error fetching environments:', error)
    return []
  }
}

