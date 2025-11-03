export interface ConfigOption {
  key: string
  name: string
  description?: string
  category: 'feature' | 'system' | 'module'
  hierarchical?: boolean // If true, enabling this enables others
  implies?: string[] // Keys of other options that this implies
}

export const CONFIG_OPTIONS: ConfigOption[] = [
  {
    key: 'minimizeBuild',
    name: 'Minimize Build',
    description: 'Enable all exclusions for a minimal build',
    category: 'system',
    hierarchical: true,
    implies: [
      'excludeModules',
      'excludeWifi',
      'excludeBluetooth',
      'excludeGps',
      'excludeScreen',
      'excludeMqtt',
      'excludePowermon',
      'excludeI2c',
      'excludePki',
      'excludePowerFsm',
      'excludeTz',
    ],
  },
  {
    key: 'disableNtp',
    name: 'Disable NTP',
    category: 'feature',
  },
  {
    key: 'disableWelcomeUnset',
    name: 'Disable Welcome Unset',
    category: 'feature',
  },
  {
    key: 'excludeWifi',
    name: 'Exclude WiFi',
    description: 'Also excludes webserver',
    category: 'system',
  },
  {
    key: 'excludeBluetooth',
    name: 'Exclude Bluetooth',
    category: 'system',
  },
  {
    key: 'excludeGps',
    name: 'Exclude GPS',
    description: 'Also excludes rangetest',
    category: 'system',
    implies: ['excludeRangetest'],
  },
  {
    key: 'excludeScreen',
    name: 'Exclude Screen',
    category: 'system',
  },
  {
    key: 'excludeMqtt',
    name: 'Exclude MQTT',
    category: 'system',
  },
  {
    key: 'excludePowermon',
    name: 'Exclude Power Monitor',
    category: 'system',
  },
  {
    key: 'excludeI2c',
    name: 'Exclude I2C',
    category: 'system',
  },
  {
    key: 'excludePki',
    name: 'Exclude PKI',
    category: 'system',
  },
  {
    key: 'excludePowerFsm',
    name: 'Exclude Power FSM',
    category: 'system',
  },
  {
    key: 'excludeTz',
    name: 'Exclude Timezone',
    category: 'system',
  },
  {
    key: 'excludeModules',
    name: 'Exclude All Modules',
    category: 'module',
    hierarchical: true,
    implies: [
      'excludeAudio',
      'excludeDetectionSensor',
      'excludeEnvironmentalSensor',
      'excludeHealthTelemetry',
      'excludeExternalNotification',
      'excludePaxcounter',
      'excludePowerTelemetry',
      'excludeRangetest',
      'excludeRemoteHardware',
      'excludeStoreforward',
      'excludeTextmessage',
      'excludeAtak',
      'excludeCannedmessages',
      'excludeNeighborinfo',
      'excludeTraceroute',
      'excludeWaypoint',
      'excludeInputbroker',
      'excludeSerial',
      'excludePowerStress',
      'excludeAdmin',
    ],
  },
  {
    key: 'excludeAudio',
    name: 'Audio',
    category: 'module',
  },
  {
    key: 'excludeDetectionSensor',
    name: 'Detection Sensor',
    category: 'module',
  },
  {
    key: 'excludeEnvironmentalSensor',
    name: 'Environmental Sensor',
    category: 'module',
  },
  {
    key: 'excludeHealthTelemetry',
    name: 'Health Telemetry',
    category: 'module',
  },
  {
    key: 'excludeExternalNotification',
    name: 'External Notification',
    category: 'module',
  },
  {
    key: 'excludePaxcounter',
    name: 'Paxcounter',
    category: 'module',
  },
  {
    key: 'excludePowerTelemetry',
    name: 'Power Telemetry',
    category: 'module',
  },
  {
    key: 'excludeRangetest',
    name: 'Range Test',
    category: 'module',
  },
  {
    key: 'excludeRemoteHardware',
    name: 'Remote Hardware',
    category: 'module',
  },
  {
    key: 'excludeStoreforward',
    name: 'Store & Forward',
    category: 'module',
  },
  {
    key: 'excludeTextmessage',
    name: 'Text Message',
    category: 'module',
  },
  {
    key: 'excludeAtak',
    name: 'ATAK',
    category: 'module',
  },
  {
    key: 'excludeCannedmessages',
    name: 'Canned Messages',
    category: 'module',
  },
  {
    key: 'excludeNeighborinfo',
    name: 'Neighbor Info',
    category: 'module',
  },
  {
    key: 'excludeTraceroute',
    name: 'Traceroute',
    category: 'module',
  },
  {
    key: 'excludeWaypoint',
    name: 'Waypoint',
    category: 'module',
  },
  {
    key: 'excludeInputbroker',
    name: 'Input Broker',
    category: 'module',
  },
  {
    key: 'excludeSerial',
    name: 'Serial',
    category: 'module',
  },
  {
    key: 'excludePowerStress',
    name: 'Power Stress',
    category: 'module',
  },
  {
    key: 'excludeAdmin',
    name: 'Admin',
    category: 'module',
  },
]
