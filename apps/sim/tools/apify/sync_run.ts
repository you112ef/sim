import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { ApifySyncRunParams, ApifySyncRunResponse } from './types'

const logger = createLogger('ApifySyncRunTool')

export const apifySyncRunTool: ToolConfig<ApifySyncRunParams, ApifySyncRunResponse> = {
  id: 'apify_sync_run',
  name: 'Apify Sync Run',
  description: 'Run an Apify Actor synchronously and return its output (300s timeout)',
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
      description: 'Timeout in seconds (max 300 for sync runs)',
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
    url: (params) => `https://api.apify.com/v2/acts/${encodeURIComponent(params.actorId)}/run-sync`,
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
      logger.error('Apify sync run failed:', {
        actorId: params?.actorId,
        status: response.status,
        error: errorMessage,
      })
      throw new Error(errorMessage)
    }

    logger.info('Apify sync run completed successfully:', {
      actorId: params?.actorId,
      hasData: !!data,
    })

    return {
      success: true,
      output: {
        data: data,
        actorId: params?.actorId || '',
        status: 'SUCCEEDED',
        // Additional metadata could be included if available in response headers
      },
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
    if (errorMessage.includes('408') || errorMessage.includes('timeout')) {
      return new Error(
        'Request timeout. The Actor took longer than 300 seconds to complete. Consider using the async run tool.'
      )
    }
    if (errorMessage.includes('400')) {
      return new Error('Bad request. Please check your input parameters.')
    }

    return error
  },
}
