import van from 'vanjs-core'
import './style.css'

const {
  div,
  span,
  form,
  input,
  select,
  option,
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

let eventSource: EventSource | null = null

const statusClass = derive(() => {
  const status = buildStatus.val
  return status ? `status-${status}` : ''
})

const statusDisplay = derive(() => {
  return buildStatus.val || ''
})

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
    branch: branch.val.trim(),
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
        input({
          type: 'text',
          value: branch,
          oninput: (e: Event) => {
            const target = e.target as HTMLInputElement
            branch.val = target.value
          },
          placeholder: 'master',
          required: true,
        }),
        small('Git branch, tag, or commit hash to build from')
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
