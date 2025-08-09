import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { ApifySyncGetParams, ApifySyncRunResponse } from './types'

const logger = createLogger('ApifySyncGetTool')

export const apifySyncGetTool: ToolConfig<ApifySyncGetParams, ApifySyncRunResponse> = {
  id: 'apify_sync_get',
  name: 'Apify Sync Get',
  description:
    'Run an Apify Actor synchronously without input and return its output (300s timeout)',
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
    url: (params) => {
      const baseUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(params.actorId)}/run-sync`
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
    method: 'GET',
    isInternalRoute: false,
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage =
        data.error?.message || data.message || `HTTP ${response.status}: ${response.statusText}`
      logger.error('Apify sync get failed:', {
        actorId: params?.actorId,
        status: response.status,
        error: errorMessage,
      })
      throw new Error(errorMessage)
    }

    logger.info('Apify sync get completed successfully:', {
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
      return new Error('Bad request. Please check your Actor ID and parameters.')
    }

    return error
  },
}
