export interface MeshtasticConfig {
  // Feature toggles
  disableNtp?: boolean
  disableWelcomeUnset?: boolean

  // Minimize build (master switch that enables all exclusions)
  minimizeBuild?: boolean

  // System-level exclusions
  excludeWifi?: boolean
  excludeBluetooth?: boolean
  excludeGps?: boolean
  excludeScreen?: boolean
  excludeMqtt?: boolean
  excludePowermon?: boolean
  excludeI2c?: boolean
  excludePki?: boolean
  excludePowerFsm?: boolean
  excludeTz?: boolean

  // Module exclusions (can be set individually or via minimizeBuild/excludeModules)
  excludeModules?: boolean
  excludeAudio?: boolean
  excludeDetectionSensor?: boolean
  excludeEnvironmentalSensor?: boolean
  excludeHealthTelemetry?: boolean
  excludeExternalNotification?: boolean
  excludePaxcounter?: boolean
  excludePowerTelemetry?: boolean
  excludeRangetest?: boolean
  excludeRemoteHardware?: boolean
  excludeStoreforward?: boolean
  excludeTextmessage?: boolean
  excludeAtak?: boolean
  excludeCannedmessages?: boolean
  excludeNeighborinfo?: boolean
  excludeTraceroute?: boolean
  excludeWaypoint?: boolean
  excludeInputbroker?: boolean
  excludeSerial?: boolean
  excludePowerStress?: boolean
  excludeAdmin?: boolean
}

export interface BuildConfig {
  branch: string
  environment?: string
  buildFlags?: string[]
  config?: MeshtasticConfig
  [key: string]: unknown
}

export interface BuildJob {
  id: string
  config: BuildConfig
  status: 'queued' | 'building' | 'completed' | 'failed'
  progress: string[]
  cacheKey: string
  outputPath?: string
  error?: string
  createdAt: number
  completedAt?: number
}
