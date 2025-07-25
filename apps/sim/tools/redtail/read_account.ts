import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { RedtailResponse, RedtailReadParams } from './types'

const logger = createLogger('RedtailReadAccount')

export const redtailReadAccountTool: ToolConfig<RedtailReadParams, RedtailResponse> = {
  id: 'redtail_read_account',
  name: 'Read Redtail Account',
  description: 'Read account information for a contact from Redtail CRM',
  version: '1.0.0',
  params: {
    contactId: {
      type: 'dropdown',
      required: true,
      description: 'The ID of the contact whose accounts to read',
    },
    page: {
      type: 'input',
      required: false,
      description: 'Page number for account list (default: 1)',
    },
    includeAssets: {
      type: 'checkbox',
      required: false,
      description: 'Include assets with each account (default: true)',
    },
  },
  directExecution: async (params) => {
    if (!params.contactId) {
      throw new Error('Contact ID is required')
    }
    
    if (!params.apiKey || !params.username || !params.password) {
      throw new Error('API Key, username, and password are required')
    }

    // First, authenticate to get the userKey
    logger.info('Authenticating with Redtail...')
    const authResponse = await fetch('https://review.crm.redtailtechnology.com/api/public/v1/authentication', {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${params.apiKey}:${params.username}:${params.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    })
    
    if (!authResponse.ok) {
      const errorText = await authResponse.text()
      logger.error(`Redtail authentication failed: ${authResponse.status} ${authResponse.statusText}`, errorText)
      throw new Error(`Authentication failed: ${authResponse.status} ${authResponse.statusText} - ${errorText}`)
    }
    
    const authData = await authResponse.json()
    const userKey = authData.authenticated_user?.user_key || authData.userkey
    
    if (!userKey) {
      logger.error('No userkey found in authentication response', authData)
      throw new Error('Authentication response did not contain a valid userkey')
    }

    // Now make the actual API call with the userKey
    const baseUrl = `https://review.crm.redtailtechnology.com/api/public/v1/contacts/${params.contactId}/accounts`
    const url = new URL(baseUrl)
    
    // Add query parameters
    url.searchParams.set('page', (params.page || 1).toString())
    
    // Include assets by default (true unless explicitly set to false)
    const includeAssets = params.includeAssets !== false
    if (includeAssets) {
      url.searchParams.set('assets', 'true')
    }
    
    const credentials = `${params.apiKey}:${userKey}`
    const encodedCredentials = Buffer.from(credentials).toString('base64')
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Userkeyauth ${encodedCredentials}`,
        'Content-Type': 'application/json',
      },
    })
    
    return redtailReadAccountTool.transformResponse?.(response, params)
  },

  request: {
    url: () => '', // Not used with directExecution
    method: 'GET',
    headers: () => ({}), // Not used with directExecution
  },
  transformResponse: async (response: Response, params?: RedtailReadParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Redtail account API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to read Redtail account: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: false,
        output: {
          metadata: {
            operation: 'read_account' as const,
            contactId: params?.contactId,
            itemType: 'account' as const,
          },
        },
      }
    }

    // Handle accounts response
    if (data.accounts) {
      const accounts = Array.isArray(data.accounts) ? data.accounts : [data.accounts]
      
      return {
        success: true,
        output: {
          accounts,
          meta: data.meta, // Include pagination info
          metadata: {
            operation: 'read_account' as const,
            contactId: params?.contactId,
            itemType: 'account' as const,
          },
        },
      }
    }

    // Handle single account response (unlikely but possible)
    if (data.account) {
      return {
        success: true,
        output: {
          account: data.account,
          metadata: {
            operation: 'read_account' as const,
            itemId: data.account.id,
            contactId: params?.contactId,
            itemType: 'account' as const,
          },
        },
      }
    }

    // Fallback for unexpected response structure
    return {
      success: true,
      output: {
        accounts: [data],
        metadata: {
          operation: 'read_account' as const,
          contactId: params?.contactId,
          itemType: 'account' as const,
        },
      },
    }
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    return 'An error occurred while reading Redtail account'
  },
}
