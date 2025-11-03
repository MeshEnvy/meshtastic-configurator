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

// Simple INI parser for PlatformIO files
interface IniSection {
  name: string
  data: Record<string, string>
  rawContent: string
}

function parseIniFile(filePath: string): Map<string, IniSection> {
  const sections = new Map<string, IniSection>()
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    let currentSection: IniSection | null = null
    let currentData: Record<string, string> = {}
    let currentRawContent = ''
    let currentKey: string | null = null
    let currentValue: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
      
      if (sectionMatch) {
        // Save previous key-value if any
        if (currentSection && currentKey) {
          currentData[currentKey] = currentValue.join(' ').trim()
          currentValue = []
          currentKey = null
        }
        // Save previous section
        if (currentSection) {
          currentSection.data = { ...currentData }
          currentSection.rawContent = currentRawContent
          sections.set(currentSection.name, currentSection)
        }
        // Start new section
        const sectionName = sectionMatch[1]
        currentSection = { name: sectionName, data: {}, rawContent: '' }
        currentData = {}
        currentRawContent = line + '\n'
      } else if (currentSection && trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
        // Check if this is a continuation line (starts with space/tab and previous line had a key=value)
        const isContinuation = (line.startsWith(' ') || line.startsWith('\t')) && currentKey
        
        if (isContinuation) {
          // Continuation of previous value
          currentValue.push(trimmed)
          currentRawContent += lines[i] + '\n'
        } else {
          // New key-value pair
          // Save previous key-value if any
          if (currentKey) {
            currentData[currentKey] = currentValue.join(' ').trim()
            currentValue = []
          }
          
          const match = trimmed.match(/^([^=]+)=(.*)$/)
          if (match) {
            currentKey = match[1].trim()
            const valuePart = match[2].trim()
            if (valuePart) {
              currentValue.push(valuePart)
            }
            currentRawContent += lines[i] + '\n'
          } else {
            currentRawContent += lines[i] + '\n'
          }
        }
      } else if (currentSection) {
        currentRawContent += lines[i] + '\n'
      }
    }

    // Save last key-value if any
    if (currentSection && currentKey) {
      currentData[currentKey] = currentValue.join(' ').trim()
    }

    // Save last section
    if (currentSection) {
      currentSection.data = currentData
      currentSection.rawContent = currentRawContent
      sections.set(currentSection.name, currentSection)
    }
  } catch (error) {
    console.error(`Error parsing INI file ${filePath}:`, error)
  }
  return sections
}

// Find the platformio.ini file containing an environment definition
function findEnvironmentFile(envName: string): string | null {
  const iniFiles = findPlatformioIniFiles(FIRMWARE_DIR)
  for (const iniFile of iniFiles) {
    const sections = parseIniFile(iniFile)
    if (sections.has(`env:${envName}`)) {
      return iniFile
    }
  }
  return null
}

// Find arch base file for a given base name
function findArchBaseFile(baseName: string): string | null {
  const archPath = join(FIRMWARE_DIR, 'arch')
  const archDirs = ['nrf52', 'esp32', 'esp32s3', 'esp32c3', 'esp32c6', 'esp32s2', 'rp2xx0', 'rp2040', 'rp2350', 'stm32']
  
  for (const archDir of archDirs) {
    // Try exact match first (e.g., nrf52840.ini for nrf52840_base)
    const archFile = join(archPath, archDir, `${baseName}.ini`)
    if (existsSync(archFile)) {
      return archFile
    }
    // Try with _base suffix removed (e.g., nrf52.ini for nrf52_base)
    const baseOnly = baseName.replace('_base', '')
    const archFile2 = join(archPath, archDir, `${baseOnly}.ini`)
    if (existsSync(archFile2)) {
      return archFile2
    }
  }
  return null
}

// Resolve extends chain and collect build flags
function resolveBuildFlags(
  sectionName: string,
  filePath: string,
  visited: Set<string> = new Set()
): string[] {
  const key = `${filePath}::${sectionName}`
  if (visited.has(key)) {
    return [] // Circular reference
  }
  visited.add(key)

  const sections = parseIniFile(filePath)
  const section = sections.get(sectionName)
  if (!section) {
    return []
  }

  const flags: string[] = []
  const buildFlags = section.data.build_flags || ''
  
  // Extract build flags from this section (skip variable substitutions for now)
  if (buildFlags) {
    // Split build flags - they can be space-separated or on multiple lines
    // Extract actual flag definitions, ignoring ${variable} substitutions
    const flagParts = buildFlags.split(/\s+/).filter(f => {
      const trimmed = f.trim()
      // Include actual flags like -D, -I, etc.
      return trimmed && !trimmed.startsWith('${')
    })
    flags.push(...flagParts)
  }

  // Follow extends chain
  const extendsValue = section.data.extends
  if (extendsValue) {
    // Handle different extend formats:
    if (extendsValue.startsWith('env:')) {
      // Reference to another env section (could be same file or need to find it)
      // First try same file
      if (sections.has(extendsValue)) {
        flags.push(...resolveBuildFlags(extendsValue, filePath, visited))
      } else {
        // Try to find the file containing this env
        const envName = extendsValue.replace('env:', '')
        const envFile = findEnvironmentFile(envName)
        if (envFile) {
          flags.push(...resolveBuildFlags(extendsValue, envFile, visited))
        }
      }
    } else {
      // Base section reference (e.g., nrf52840_base, arduino_base)
      let resolved = false
      
      // First check same file
      if (sections.has(extendsValue)) {
        flags.push(...resolveBuildFlags(extendsValue, filePath, visited))
        resolved = true
      }
      
      // Check arch files
      if (!resolved && extendsValue.includes('_base')) {
        const baseName = extendsValue.replace('_base', '')
        const archFile = findArchBaseFile(baseName)
        if (archFile) {
          flags.push(...resolveBuildFlags(extendsValue, archFile, visited))
          resolved = true
        }
      }
      
      // Check main platformio.ini for base configs like arduino_base, networking_base, etc.
      const mainIni = join(FIRMWARE_DIR, 'platformio.ini')
      if (!resolved && existsSync(mainIni) && filePath !== mainIni) {
        const mainSections = parseIniFile(mainIni)
        if (mainSections.has(extendsValue)) {
          flags.push(...resolveBuildFlags(extendsValue, mainIni, visited))
          resolved = true
        }
      }
      
      // Always get env base flags from main file if we're resolving from a variant
      if (filePath !== mainIni && existsSync(mainIni)) {
        const mainSections = parseIniFile(mainIni)
        if (mainSections.has('env')) {
          flags.push(...resolveBuildFlags('env', mainIni, visited))
        }
      }
    }
  }

  return flags
}

// Extract MESHTASTIC_EXCLUDE_* flags from build flags
function extractExclusionFlags(buildFlags: string[]): Set<string> {
  const exclusions = new Set<string>()
  for (const flag of buildFlags) {
    // Match -D MESHTASTIC_EXCLUDE_... or -DMESHTASTIC_EXCLUDE_... (with or without space)
    const match = flag.match(/-D\s*MESHTASTIC_EXCLUDE_([A-Z_]+)(?:=(\d+))?/)
    if (match) {
      const exclusionName = match[1]
      const value = match[2] !== undefined ? match[2] : '1'
      if (value === '1') {
        exclusions.add(exclusionName)
      }
    }
  }
  return exclusions
}

// Map MESHTASTIC_EXCLUDE_* flag names to MeshtasticConfig keys
function mapExclusionToConfigKey(exclusionFlag: string): string | null {
  // Convert SNAKE_CASE to camelCase
  const parts = exclusionFlag.toLowerCase().split('_')
  let camelCase = parts[0]
  for (let i = 1; i < parts.length; i++) {
    camelCase += parts[i][0].toUpperCase() + parts[i].slice(1)
  }
  
  // Map to config key names
  const mapping: Record<string, string> = {
    wifi: 'excludeWifi',
    bluetooth: 'excludeBluetooth',
    gps: 'excludeGps',
    screen: 'excludeScreen',
    mqtt: 'excludeMqtt',
    powermon: 'excludePowermon',
    i2c: 'excludeI2c',
    pki: 'excludePki',
    powerfsm: 'excludePowerFsm',
    tz: 'excludeTz',
    audio: 'excludeAudio',
    detectionsensor: 'excludeDetectionSensor',
    environmentalsensor: 'excludeEnvironmentalSensor',
    healthtelemetry: 'excludeHealthTelemetry',
    externalnotification: 'excludeExternalNotification',
    paxcounter: 'excludePaxcounter',
    powertelemetry: 'excludePowerTelemetry',
    rangetest: 'excludeRangetest',
    remotehardware: 'excludeRemoteHardware',
    storeforward: 'excludeStoreforward',
    textmessage: 'excludeTextmessage',
    atak: 'excludeAtak',
    cannedmessages: 'excludeCannedmessages',
    neighborinfo: 'excludeNeighborinfo',
    traceroute: 'excludeTraceroute',
    waypoint: 'excludeWaypoint',
    inputbroker: 'excludeInputbroker',
    serial: 'excludeSerial',
    powerstress: 'excludePowerStress',
    admin: 'excludeAdmin',
    webserver: 'excludeWifi', // webserver exclusion implies wifi exclusion
  }
  
  // Handle special cases with underscores
  if (exclusionFlag.includes('ENVIRONMENTAL_SENSOR_EXTERNAL')) {
    return 'excludeEnvironmentalSensor' // Map to main sensor exclusion
  }
  
  return mapping[camelCase] || null
}

// Check build_src_filter for architecture-level exclusions
function checkSrcFilterExclusions(filePath: string, sectionName: string): Set<string> {
  const sections = parseIniFile(filePath)
  const section = sections.get(sectionName)
  if (!section) {
    return new Set()
  }
  
  const exclusions = new Set<string>()
  const srcFilter = section.data.build_src_filter || ''
  
  // Check for architecture-level exclusions
  if (srcFilter.includes('-<mesh/wifi/>')) {
    exclusions.add('WIFI')
  }
  if (srcFilter.includes('-<nimble/>') || srcFilter.includes('-<mesh/ble/>')) {
    exclusions.add('BLUETOOTH')
  }
  if (srcFilter.includes('-<platform/esp32/>')) {
    // This indicates non-ESP32 architecture, but doesn't necessarily exclude features
  }
  
  return exclusions
}

// Get environment config defaults
export interface EnvironmentConfigDefaults {
  config: Partial<import('./types').MeshtasticConfig>
  hardExclusions: string[]
}

export async function getEnvironmentConfigDefaults(
  envName: string
): Promise<EnvironmentConfigDefaults> {
  if (!existsSync(FIRMWARE_DIR)) {
    return { config: {}, hardExclusions: [] }
  }

  try {
    const envFile = findEnvironmentFile(envName)
    if (!envFile) {
      console.error(`Environment ${envName} not found`)
      return { config: {}, hardExclusions: [] }
    }

    // Resolve all build flags from inheritance chain
    const allFlags = resolveBuildFlags(`env:${envName}`, envFile)
    
    // Extract exclusion flags
    const exclusionFlags = extractExclusionFlags(allFlags)
    
    // Check src filter for additional exclusions
    const sections = parseIniFile(envFile)
    const envSection = sections.get(`env:${envName}`)
    if (envSection) {
      const srcFilterExclusions = checkSrcFilterExclusions(envFile, `env:${envName}`)
      srcFilterExclusions.forEach(flag => exclusionFlags.add(flag))
    }

    // Map exclusions to config keys
    const config: Partial<import('./types').MeshtasticConfig> = {}
    const hardExclusions: string[] = []

    exclusionFlags.forEach((flag) => {
      const configKey = mapExclusionToConfigKey(flag)
      if (configKey) {
        config[configKey as keyof typeof config] = true
        hardExclusions.push(configKey)
      }
    })

    return { config, hardExclusions }
  } catch (error) {
    console.error(`Error getting config defaults for ${envName}:`, error)
    return { config: {}, hardExclusions: [] }
  }
}

