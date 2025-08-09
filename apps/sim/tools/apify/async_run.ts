import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { ApifyAsyncRunParams, ApifyAsyncRunResponse } from './types'

const logger = createLogger('ApifyAsyncRunTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 1800000 // 30 minutes maximum polling time

export const apifyAsyncRunTool: ToolConfig<ApifyAsyncRunParams, ApifyAsyncRunResponse> = {
  id: 'apify_async_run',
  name: 'Apify Async Run',
  description: 'Run an Apify Actor asynchronously and poll for completion (30min max)',
  version: '1.0.0',

  params: {
    actorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Apify Actor ID or name (e.g., web-scraper or apify/web-scraper)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Apify API token for authentication',
    },
    input: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Input data to pass to the actor (JSON object)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Timeout in seconds for the actor run',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return',
    },
  },

  outputs: {
    data: {
      type: 'json',
      description: 'The output data from the Actor run',
    },
    runId: {
      type: 'string',
      description: 'The ID of the Actor run',
    },
    actorId: {
      type: 'string',
      description: 'The ID of the Actor that was run',
    },
    status: {
      type: 'string',
      description: 'Final status of the Actor run',
    },
    defaultDatasetId: {
      type: 'string',
      description: 'ID of the default dataset containing results',
    },
    stats: {
      type: 'json',
      description: 'Runtime statistics (memory, CPU usage, etc.)',
    },
    usage: {
      type: 'json',
      description: 'Resource usage details (compute units, data transfers, etc.)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(params.actorId)}/runs`
      const queryParams = new URLSearchParams()

      if (params.timeout) {
        queryParams.append('timeout', params.timeout.toString())
      }
      if (params.maxItems) {
        queryParams.append('maxItems', params.maxItems.toString())
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'POST',
    isInternalRoute: false,
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: any = {}

      // Add input if provided
      if (params.input) {
        Object.assign(body, params.input)
      }

      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage =
        data.error?.message || data.message || `HTTP ${response.status}: ${response.statusText}`
      logger.error('Apify async run failed to start:', {
        actorId: params?.actorId,
        status: response.status,
        error: errorMessage,
      })
      throw new Error(errorMessage)
    }

    logger.info('Apify async run started successfully:', {
      actorId: params?.actorId,
      runId: data.id,
      status: data.status,
    })

    return {
      success: true,
      output: {
        runId: data.id,
        actorId: data.actId || params?.actorId || '',
        status: data.status,
        defaultDatasetId: data.defaultDatasetId,
        defaultKeyValueStoreId: data.defaultKeyValueStoreId,
        startedAt: data.startedAt,
        buildId: data.buildId,
        data: undefined, // Will be populated during polling
        stats: undefined, // Will be populated during polling
        usage: undefined, // Will be populated during polling
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const runId = result.output.runId
    const actorId = result.output.actorId
    const defaultDatasetId = result.output.defaultDatasetId

    logger.info(`Apify async run ${runId} started, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        // Check run status
        const statusResponse = await fetch(
          `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs/${runId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
            },
          }
        )

        if (!statusResponse.ok) {
          throw new Error(`Failed to get run status: ${statusResponse.statusText}`)
        }

        const runData = await statusResponse.json()
        logger.info(`Apify run ${runId} status: ${runData.data.status}`)

        if (runData.data.status === 'SUCCEEDED') {
          // Fetch results from dataset
          try {
            const resultsResponse = await fetch(
              `https://api.apify.com/v2/datasets/${defaultDatasetId}/items`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${params.apiKey}`,
                },
              }
            )

            if (resultsResponse.ok) {
              const resultsData = await resultsResponse.json()
              result.output = {
                ...result.output,
                data: resultsData,
              }
            } else {
              logger.warn(`Failed to fetch results from dataset ${defaultDatasetId}`)
              result.output = {
                ...result.output,
                data: { message: 'Run completed but results could not be retrieved' },
              }
            }
          } catch (fetchError) {
            logger.warn('Error fetching results:', fetchError)
            result.output = {
              ...result.output,
              data: { message: 'Run completed but results could not be retrieved' },
            }
          }

          result.output = {
            ...result.output,
            status: runData.data.status,
            stats: runData.data.stats,
            usage: runData.data.usage,
          }

          return result
        }

        if (runData.data.status === 'FAILED') {
          return {
            ...result,
            success: false,
            error: `Actor run failed: ${runData.data.statusMessage || 'Unknown error'}`,
          }
        }

        if (runData.data.status === 'TIMED-OUT') {
          return {
            ...result,
            success: false,
            error: 'Actor run timed out',
          }
        }

        if (runData.data.status === 'ABORTED') {
          return {
            ...result,
            success: false,
            error: 'Actor run was aborted',
          }
        }

        // Continue polling for RUNNING or READY status
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for run status:', {
          message: error.message || 'Unknown error',
          runId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for run status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Actor run ${runId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Actor run did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  transformError: (error) => {
    const errorMessage = error?.message || ''

    if (errorMessage.includes('401')) {
      return new Error('Invalid API key. Please check your Apify API token.')
    }
    if (errorMessage.includes('403')) {
      return new Error(
        'Access forbidden. Check if the Actor exists and you have permission to run it.'
      )
    }
    if (errorMessage.includes('404')) {
      return new Error('Actor not found. Please verify the Actor ID is correct.')
    }
    if (errorMessage.includes('429')) {
      return new Error('Rate limit exceeded. Please try again later.')
    }
    if (errorMessage.includes('400')) {
      return new Error('Bad request. Please check your input parameters.')
    }

    return error
  },
}
