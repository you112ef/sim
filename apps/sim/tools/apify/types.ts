import type { ToolResponse } from '@/tools/types'

// Common Apify parameters
export interface ApifyBaseParams {
  actorId: string
  apiKey: string
}

// Actor Input can be any JSON-serializable data
export type ActorInput = Record<string, any>

// Actor Run Status from Apify API
export type ActorRunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED'

// Apify Actor Run object structure
export interface ActorRun {
  id: string
  actId: string
  userId: string
  actorTaskId?: string
  status: ActorRunStatus
  startedAt: string
  finishedAt?: string
  buildId: string
  exitCode?: number
  defaultDatasetId: string
  defaultKeyValueStoreId: string
  defaultRequestQueueId: string
  buildNumber: string
  containerUrl?: string
  meta: {
    origin: string
    clientIp: string
    userAgent: string
  }
  stats: {
    inputBodyLen: number
    restartCount: number
    resurrectCount: number
    memAvgBytes?: number
    memMaxBytes?: number
    memCurrentBytes?: number
    cpuAvgUsage?: number
    cpuMaxUsage?: number
    cpuCurrentUsage?: number
    netRxBytes?: number
    netTxBytes?: number
    durationMillis?: number
    runTimeSecs?: number
    metamorph?: number
    computeUnits?: number
  }
  options: {
    build?: string
    timeoutSecs?: number
    memoryMbytes?: number
    maxItems?: number
  }
  usage?: {
    ACTOR_COMPUTE_UNITS: number
    DATASET_READS: number
    DATASET_WRITES: number
    KEY_VALUE_STORE_READS: number
    KEY_VALUE_STORE_WRITES: number
    REQUEST_QUEUE_READS: number
    REQUEST_QUEUE_WRITES: number
    DATA_TRANSFER_INTERNAL_GBYTES: number
    DATA_TRANSFER_EXTERNAL_GBYTES: number
    PROXY_RESIDENTIAL_TRANSFER_GBYTES: number
    PROXY_SERPS_TRANSFER_GBYTES: number
  }
}

// Synchronous Actor Run Parameters (POST)
export interface ApifySyncRunParams extends ApifyBaseParams {
  input?: ActorInput
  timeout?: number
  maxItems?: number
  webhooks?: string[]
}

// Synchronous Actor Run Parameters (GET) - no input needed
export interface ApifySyncGetParams extends ApifyBaseParams {
  timeout?: number
  maxItems?: number
  webhooks?: string[]
}

// Asynchronous Actor Run Parameters
export interface ApifyAsyncRunParams extends ApifyBaseParams {
  input?: ActorInput
  timeout?: number
  maxItems?: number
  webhooks?: string[]
}

// Actor Run Status Check Parameters
export interface ApifyRunStatusParams {
  runId: string
  apiKey: string
}

// Generic Apify Response
export interface ApifyResponse<T extends Record<string, any> = Record<string, any>>
  extends ToolResponse {
  output: T
}

// Synchronous Run Response - returns actor output directly
export interface ApifySyncRunResponse extends ApifyResponse {
  output: {
    data: any // The actual output from the actor
    runId?: string
    actorId: string
    status: 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT'
    stats?: ActorRun['stats']
    usage?: ActorRun['usage']
  }
}

// Asynchronous Run Response - returns run details for polling
export interface ApifyAsyncRunResponse extends ApifyResponse {
  output: {
    runId: string
    actorId: string
    status: ActorRunStatus
    defaultDatasetId: string
    defaultKeyValueStoreId?: string
    startedAt: string
    buildId: string
    data?: any
    stats?: ActorRun['stats']
    usage?: ActorRun['usage']
  }
}

// Run Status Response - for checking async run progress
export interface ApifyRunStatusResponse extends ApifyResponse {
  output: {
    run: ActorRun
    data?: any // Actor output if run is completed
  }
}

// Union type for all Apify responses
export type ApifyAllResponse = ApifySyncRunResponse | ApifyAsyncRunResponse | ApifyRunStatusResponse

// Error response structure from Apify
export interface ApifyError {
  error: {
    type: string
    message: string
  }
}
