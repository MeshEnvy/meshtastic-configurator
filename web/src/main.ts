import van from 'vanjs-core'
import './style.css'

const {
  div,
  span,
  form,
  input,
  select,
  option,
  optgroup,
  button,
  a,
  label,
  small,
  h1,
  h2,
  h3,
} = van.tags
const { state, derive } = van

// Determine API URL based on environment
const getApiUrl = (): string => {
  // In development, use localhost:3000
  if (
    import.meta.env.DEV ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return 'http://localhost:3000'
  }
  // In production, use the production API
  return 'https://configurator-api.meshenvy.org'
}

const API_URL = getApiUrl()

type BuildStatus = 'queued' | 'building' | 'completed' | 'failed' | ''

interface BuildJob {
  id: string
  status: BuildStatus
  progress?: string[]
  outputPath?: string
  cacheKey?: string
  error?: string
}

interface SSEProgressData {
  status: BuildStatus
  progress?: string[]
  outputPath?: string
  error?: string
}

// Reactive state
const branch = state('')
const environment = state('esp32dev')
const buildStatus = state<BuildStatus>('')
const progressLines = state<string[]>([])
const downloadUrl = state('')
const errorMessage = state('')
const showBuildStatus = state(false)
const showProgress = state(false)
const showDownload = state(false)
const showError = state(false)

// Configuration option states will be created dynamically

// Category visibility states (will be initialized when config options load)
const categoryShown = new Map<string, ReturnType<typeof state<boolean>>>()

// Branch/tag state
const branches = state<string[]>([])
const tags = state<string[]>([])
const environments = state<string[]>([])
const selectedRefType = state<'dropdown' | 'custom'>('dropdown')
const customRef = state('')
const validationStatus = state<{
  valid: boolean
  type?: string
  error?: string
} | null>(null)

// Configuration options from API
interface ConfigOption {
  key: string
  name: string
  description?: string
  category: 'feature' | 'system' | 'module'
  hierarchical?: boolean
  implies?: string[]
}
const configOptions = state<ConfigOption[]>([])
const configOptionStates = new Map<string, ReturnType<typeof state<boolean>>>()

let eventSource: EventSource | null = null
let validationTimeout: ReturnType<typeof setTimeout> | null = null

const statusClass = derive(() => {
  const status = buildStatus.val
  return status ? `status-${status}` : ''
})

const statusDisplay = derive(() => {
  return buildStatus.val || ''
})

// Load firmware data and config options on startup
async function loadFirmwareData() {
  try {
    const [
      branchesRes,
      tagsRes,
      latestTagRes,
      environmentsRes,
      configOptionsRes,
    ] = await Promise.all([
      fetch(`${API_URL}/firmware/branches`),
      fetch(`${API_URL}/firmware/tags`),
      fetch(`${API_URL}/firmware/latest-tag`),
      fetch(`${API_URL}/firmware/environments`),
      fetch(`${API_URL}/config/options`),
    ])

    if (branchesRes.ok) {
      branches.val = await branchesRes.json()
    }
    if (tagsRes.ok) {
      tags.val = await tagsRes.json()
    }
    if (latestTagRes.ok) {
      const { tag } = await latestTagRes.json()
      if (tag) {
        branch.val = tag
      }
    }
    if (environmentsRes.ok) {
      const envs = await environmentsRes.json()
      environments.val = envs
      // Set default environment to first one if available and no environment is currently selected
      if (envs.length > 0) {
        // Only set if current value is empty or not in the list
        if (!environment.val || !envs.includes(environment.val)) {
          environment.val = envs[0]
        }
      }
    }
    if (configOptionsRes.ok) {
      const options: ConfigOption[] = await configOptionsRes.json()
      console.log('Loaded config options:', options.length, options)

      // Initialize state for each config option BEFORE setting configOptions.val
      // This ensures states exist when reactive functions run
      options.forEach((option) => {
        if (!configOptionStates.has(option.key)) {
          configOptionStates.set(option.key, state(false))
        }
        // Initialize category visibility states
        if (!categoryShown.has(option.category)) {
          categoryShown.set(option.category, state(false))
        }
      })
      console.log('Initialized states for', configOptionStates.size, 'options')
      console.log('Category states:', Array.from(categoryShown.keys()))

      // Set the options AFTER states are initialized
      configOptions.val = options
      console.log('Set configOptions.val, length:', configOptions.val.length)
    } else {
      console.error('Failed to load config options:', configOptionsRes.status)
    }
  } catch (error) {
    console.error('Error loading firmware data:', error)
  }
}

// Get the current branch value (either from dropdown or custom input)
const currentBranch = derive(() => {
  if (selectedRefType.val === 'custom') {
    return customRef.val
  }
  return branch.val
})

// Validate branch/tag/commit
async function validateCustomRef(value: string) {
  if (!value.trim()) {
    validationStatus.val = null
    return
  }

  // Clear previous timeout
  if (validationTimeout) {
    clearTimeout(validationTimeout)
  }

  // Debounce validation
  validationTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`${API_URL}/firmware/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: value }),
      })

      if (response.ok) {
        validationStatus.val = await response.json()
      } else {
        validationStatus.val = { valid: false, error: 'Validation failed' }
      }
    } catch (error) {
      console.error('Validation error:', error)
      validationStatus.val = { valid: false, error: 'Could not validate' }
    }
  }, 500)
}

// Initialize on load
loadFirmwareData()

function connectSSE(jobId: string): void {
  if (eventSource) {
    eventSource.close()
  }

  const url = `${API_URL}/build/${jobId}/progress`
  eventSource = new EventSource(url)

  eventSource.onmessage = (event: MessageEvent) => {
    try {
      const data: SSEProgressData = JSON.parse(event.data)

      buildStatus.val = data.status

      if (data.progress && Array.isArray(data.progress)) {
        progressLines.val = [...data.progress]
      }

      if (data.status === 'completed' && data.outputPath) {
        const cacheKey = data.outputPath.split('/').pop()
        if (cacheKey) {
          const url = `${API_URL}/download/${cacheKey}`
          downloadUrl.val = url
          showDownload.val = true
          showProgress.val = false
          showError.val = false
          eventSource?.close()
        }
      } else if (data.status === 'failed') {
        errorMessage.val = data.error || 'Build failed'
        showError.val = true
        showProgress.val = false
        showDownload.val = false
        eventSource?.close()
      } else if (data.status === 'building' || data.status === 'queued') {
        showProgress.val = true
        showError.val = false
        showDownload.val = false
      }
    } catch (err) {
      console.error('Error parsing SSE data:', err)
    }
  }

  eventSource.onerror = (err: Event) => {
    console.error('SSE error:', err)
    if (eventSource?.readyState === EventSource.CLOSED) {
      eventSource.close()
    }
  }
}

async function handleSubmit(e: Event): Promise<void> {
  e.preventDefault()

  showBuildStatus.val = true
  showProgress.val = true
  showError.val = false
  showDownload.val = false
  progressLines.val = []
  buildStatus.val = 'queued'
  errorMessage.val = ''
  downloadUrl.val = ''

  // Collect all configuration options dynamically
  const meshtasticConfig: Record<string, boolean> = {}
  configOptions.val.forEach((option) => {
    const optionState = configOptionStates.get(option.key)
    if (optionState && optionState.val) {
      meshtasticConfig[option.key] = true
    }
  })

  const config: Record<string, unknown> = {
    branch: currentBranch.val.trim(),
    environment: environment.val,
  }

  // Only include config if there are any options set
  if (Object.keys(meshtasticConfig).length > 0) {
    config.config = meshtasticConfig
  }

  try {
    const response = await fetch(`${API_URL}/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to start build')
    }

    const job: BuildJob = await response.json()

    // Always connect to SSE for progress updates
    connectSSE(job.id)

    // If already completed (cached), show download immediately
    if (job.status === 'completed' && job.outputPath && job.cacheKey) {
      const url = `${API_URL}/download/${job.cacheKey}`
      downloadUrl.val = url
      showDownload.val = true
      showProgress.val = false
      buildStatus.val = 'completed'
    }
  } catch (error) {
    errorMessage.val =
      error instanceof Error ? error.message : 'Failed to start build'
    showError.val = true
    showProgress.val = false
    buildStatus.val = 'failed'
  }
}

const App = () =>
  div(
    h1('Meshtastic Firmware Builder'),
    form(
      { onsubmit: handleSubmit },
      label(
        'Branch/Tag/Commit',
        () =>
          selectedRefType.val === 'dropdown'
            ? select(
                {
                  value: branch,
                  onchange: (e: Event) => {
                    const target = e.target as HTMLSelectElement
                    const value = target.value
                    if (value === '__custom__') {
                      selectedRefType.val = 'custom'
                      customRef.val = ''
                      validationStatus.val = null
                    } else {
                      branch.val = value
                    }
                  },
                },
                option({ value: '' }, 'Select a branch or tag...'),
                tags.val.length > 0
                  ? optgroup(
                      { label: 'Tags' },
                      ...tags.val.map((tag) =>
                        option({ value: tag }, `🏷️ ${tag}`)
                      )
                    )
                  : null,
                branches.val.length > 0
                  ? optgroup(
                      { label: 'Branches' },
                      ...branches.val.map((branchName) =>
                        option({ value: branchName }, `🌿 ${branchName}`)
                      )
                    )
                  : null,
                option({ value: '__custom__' }, '➕ Custom (type your own)')
              )
            : div(
                {},
                input({
                  type: 'text',
                  value: customRef,
                  oninput: (e: Event) => {
                    const target = e.target as HTMLInputElement
                    customRef.val = target.value
                    validateCustomRef(target.value)
                  },
                  placeholder: 'Enter branch name, tag, or commit hash...',
                  required: true,
                  style: `width: 100%; margin-bottom: 0.5rem; ${
                    validationStatus.val && !validationStatus.val.valid
                      ? 'border-color: #ff4444;'
                      : validationStatus.val && validationStatus.val.valid
                      ? 'border-color: #00ff00;'
                      : ''
                  }`,
                }),
                button(
                  {
                    type: 'button',
                    onclick: () => {
                      selectedRefType.val = 'dropdown'
                      customRef.val = ''
                      validationStatus.val = null
                    },
                    style: 'width: 100%;',
                  },
                  '← Back to dropdown'
                )
              ),
        () =>
          selectedRefType.val === 'custom'
            ? validationStatus.val
              ? validationStatus.val.valid
                ? small(
                    { style: 'color: #00ff00;' },
                    `✓ Valid ${validationStatus.val.type || 'reference'}`
                  )
                : small(
                    { style: 'color: #ff4444;' },
                    `✗ ${validationStatus.val.error || 'Invalid reference'}`
                  )
              : small('Enter a branch name, tag, or commit hash (7+ hex chars)')
            : small(
                'Select from the dropdown, or choose "Custom" to type your own'
              )
      ),
      label('Build Environment', () =>
        select(
          {
            value: environment,
            onchange: (e: Event) => {
              const target = e.target as HTMLSelectElement
              environment.val = target.value
            },
          },
          environments.val.length > 0
            ? environments.val.map((env) => option({ value: env }, env))
            : option({ value: '', disabled: true }, 'Loading environments...')
        )
      ),
      h3('Configuration Options'),
      () => {
        const count = configOptions.val.length
        console.log('Render check - configOptions count:', count)
        if (count === 0) {
          return small('Loading configuration options...')
        }
        return null
      },
      // Render hierarchical options first (minimizeBuild)
      () => {
        // Access configOptions.val FIRST to establish dependency tracking
        const opts = configOptions.val
        const count = opts.length
        console.log('Render hierarchical - configOptions count:', count)

        if (count === 0) {
          console.log('No config options')
          return div() // Return empty div instead of null to maintain tracking
        }

        const hierarchicalOptions = opts.filter(
          (opt) => opt.hierarchical && opt.category === 'system'
        )
        console.log('Found hierarchical options:', hierarchicalOptions.length)

        if (hierarchicalOptions.length === 0) {
          console.log('No hierarchical options')
          return div() // Return empty div instead of null
        }

        const elements = hierarchicalOptions
          .map((option) => {
            const optionState = configOptionStates.get(option.key)
            if (!optionState) return null
            return div(
              { style: 'margin-bottom: 1rem;' },
              label(
                {
                  style:
                    'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;',
                },
                input({
                  type: 'checkbox',
                  checked: optionState,
                  onchange: (e: Event) => {
                    const target = e.target as HTMLInputElement
                    optionState.val = target.checked
                    // When hierarchical option is checked, enable all implied options
                    if (target.checked && option.implies) {
                      option.implies.forEach((impliedKey) => {
                        const impliedState = configOptionStates.get(impliedKey)
                        if (impliedState) {
                          impliedState.val = true
                        }
                      })
                    }
                  },
                }),
                span(
                  { style: 'font-weight: bold;' },
                  option.name,
                  option.description
                    ? small(
                        {
                          style:
                            'display: block; font-weight: normal; opacity: 0.7;',
                        },
                        option.description
                      )
                    : null
                )
              )
            )
          })
          .filter((el) => el !== null)

        console.log('Hierarchical options:', elements)

        if (elements.length === 0) {
          console.log('No hierarchical options')
          return div() // Return empty div instead of null
        }
        return div({}, ...elements)
      },
      // Render collapsible sections for each category
      () => {
        if (configOptions.val.length === 0) return div() // Return empty div instead of null

        const categoryTitles: Record<string, string> = {
          feature: 'Feature Toggles',
          system: 'System-Level Exclusions',
          module: 'Module Exclusions',
        }

        const categories = ['feature', 'system', 'module'].filter((cat) =>
          configOptions.val.some(
            (opt) => opt.category === cat && !opt.hierarchical
          )
        )

        if (categories.length === 0) return div() // Return empty div instead of null

        const categoryElements = categories
          .map((category) => {
            let shownState = categoryShown.get(category)
            if (!shownState) {
              // Create state if it doesn't exist (shouldn't happen, but safety check)
              shownState = state(false)
              categoryShown.set(category, shownState)
            }

            // Note: categoryOptions is now computed inside the reactive function
            // to ensure it tracks configOptions.val changes
            return div(
              {
                style:
                  'margin-bottom: 1rem; border: 1px solid #ddd; padding: 0.5rem; border-radius: 4px;',
              },
              button(
                {
                  type: 'button',
                  onclick: () => {
                    shownState.val = !shownState.val
                  },
                  style:
                    'width: 100%; text-align: left; background: none; border: none; padding: 0.5rem; cursor: pointer; font-weight: bold;',
                },
                () => (shownState.val ? '▼ ' : '▶ ') + categoryTitles[category]
              ),
              () => {
                if (!shownState.val) return div() // Return empty div instead of null

                // Access configOptions.val directly inside the reactive function to track changes
                const opts = configOptions.val

                // Build array of elements to render
                const elements: (HTMLElement | null)[] = []

                // Render hierarchical module option first if category is module
                if (category === 'module') {
                  const hierarchicalModuleOptions = opts
                    .filter(
                      (opt) => opt.category === category && opt.hierarchical
                    )
                    .map((option) => {
                      const optionState = configOptionStates.get(option.key)
                      if (!optionState) return null
                      return label(
                        {
                          style:
                            'display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; cursor: pointer;',
                        },
                        input({
                          type: 'checkbox',
                          checked: optionState,
                          onchange: (e: Event) => {
                            const target = e.target as HTMLInputElement
                            optionState.val = target.checked
                            // When hierarchical option is checked, enable all implied options
                            if (target.checked && option.implies) {
                              option.implies.forEach((impliedKey) => {
                                const impliedState =
                                  configOptionStates.get(impliedKey)
                                if (impliedState) {
                                  impliedState.val = true
                                }
                              })
                            }
                          },
                        }),
                        span({ style: 'font-weight: bold;' }, option.name)
                      )
                    })
                    .filter((el) => el !== null)
                  elements.push(...(hierarchicalModuleOptions as HTMLElement[]))
                }

                // Render regular options - filter from opts directly, not categoryOptions
                const categoryOptions = opts.filter(
                  (opt) => opt.category === category && !opt.hierarchical
                )
                const regularOptions = categoryOptions
                  .map((option) => {
                    const optionState = configOptionStates.get(option.key)
                    if (!optionState) return null
                    return label(
                      {
                        style:
                          'display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; cursor: pointer;',
                      },
                      input({
                        type: 'checkbox',
                        checked: optionState,
                        onchange: (e: Event) => {
                          optionState.val = (
                            e.target as HTMLInputElement
                          ).checked
                        },
                      }),
                      span(
                        option.name,
                        option.description
                          ? small(
                              {
                                style:
                                  'display: block; font-weight: normal; opacity: 0.7; font-size: 0.9em; margin-left: 1.5rem;',
                              },
                              option.description
                            )
                          : null
                      )
                    )
                  })
                  .filter((el) => el !== null) as HTMLElement[]

                elements.push(...regularOptions)

                return div(
                  { style: 'margin-top: 0.5rem; padding-left: 1rem;' },
                  ...elements
                )
              }
            )
          })
          .filter((el) => el !== null) as HTMLElement[]

        if (categoryElements.length === 0) return div() // Return empty div instead of null
        return div({}, ...categoryElements)
      },
      button({ type: 'submit' }, 'Start Build')
    ),
    () =>
      showBuildStatus.val
        ? div(
            { class: 'build-status' },
            h2('Build Status'),
            div('Status: ', span({ class: statusClass }, statusDisplay)),
            () =>
              showProgress.val
                ? (() => {
                    const logContainer = div({ class: 'progress-log' })
                    derive(() => {
                      const lines = progressLines.val.map((line) =>
                        div({ class: 'log-line' }, line)
                      )
                      logContainer.replaceChildren(...lines)
                      ;(logContainer as HTMLElement).scrollTop = (
                        logContainer as HTMLElement
                      ).scrollHeight
                    })
                    return div(
                      { class: 'progress-container' },
                      h3('Progress'),
                      logContainer
                    )
                  })()
                : null,
            () =>
              showDownload.val && downloadUrl.val
                ? div(
                    { class: 'download-section' },
                    h3('Download'),
                    a(
                      {
                        href: downloadUrl,
                        target: '_blank',
                        class: 'button',
                      },
                      'Download Firmware'
                    )
                  )
                : null,
            () =>
              showError.val && errorMessage.val
                ? div(
                    { class: 'error-section' },
                    h3('Error'),
                    div({ class: 'progress-log' }, errorMessage)
                  )
                : null
          )
        : null
  )

const appElement = document.getElementById('app')
if (appElement) {
  van.add(appElement, App())
}
