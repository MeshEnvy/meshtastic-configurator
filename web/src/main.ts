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

// Branch/tag state
const branches = state<string[]>([])
const tags = state<string[]>([])
const selectedRefType = state<'dropdown' | 'custom'>('dropdown')
const customRef = state('')
const validationStatus = state<{
  valid: boolean
  type?: string
  error?: string
} | null>(null)

let eventSource: EventSource | null = null
let validationTimeout: ReturnType<typeof setTimeout> | null = null

const statusClass = derive(() => {
  const status = buildStatus.val
  return status ? `status-${status}` : ''
})

const statusDisplay = derive(() => {
  return buildStatus.val || ''
})

// Load firmware data on startup
async function loadFirmwareData() {
  try {
    const [branchesRes, tagsRes, latestTagRes] = await Promise.all([
      fetch(`${API_URL}/firmware/branches`),
      fetch(`${API_URL}/firmware/tags`),
      fetch(`${API_URL}/firmware/latest-tag`),
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

  const config = {
    branch: currentBranch.val.trim(),
    environment: environment.val,
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

    // If already completed (cached), show download immediately
    if (job.status === 'completed' && job.outputPath && job.cacheKey) {
      const url = `${API_URL}/download/${job.cacheKey}`
      downloadUrl.val = url
      showDownload.val = true
      showProgress.val = false
      buildStatus.val = 'completed'
    } else {
      // Otherwise connect to SSE for progress
      connectSSE(job.id)
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
      label(
        'Build Environment',
        select(
          {
            value: environment,
            onchange: (e: Event) => {
              const target = e.target as HTMLSelectElement
              environment.val = target.value
            },
          },
          option({ value: 'esp32dev' }, 'ESP32 Development Board'),
          option({ value: 'tlora-v1' }, 'T-Beam v1'),
          option({ value: 'tlora-v2' }, 'T-Beam v2'),
          option({ value: 'tlora-v2-1-1.6' }, 'T-Beam v2.1.1.6'),
          option({ value: 'heltec-v1' }, 'Heltec v1'),
          option({ value: 'heltec-v2' }, 'Heltec v2'),
          option({ value: 'heltec-v2.1' }, 'Heltec v2.1'),
          option({ value: 'heltec-v3' }, 'Heltec v3')
        )
      ),
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
