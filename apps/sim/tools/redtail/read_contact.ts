import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { RedtailReadParams, RedtailResponse } from './types'

const logger = createLogger('RedtailReadContact')

export const redtailReadContactTool: ToolConfig<RedtailReadParams, RedtailResponse> = {
  id: 'redtail_read_contact',
  name: 'Read Redtail Contact',
  description: 'Read contact information from Redtail CRM',
  version: '1.0.0',
  params: {
    contactId: {
      type: 'dropdown',
      required: false, // Make optional so we can get list when none selected
      description:
        'The ID of the contact to read (optional - if not provided, returns list of contacts)',
    },
    page: {
      type: 'input',
      required: false,
      description: 'Page number for contact list (default: 1)',
    },
  },
  directExecution: async (params) => {
    if (!env.REDTAIL_API_KEY || !params.username || !params.password) {
      throw new Error('API Key, username, and password are required')
    }

    // First, authenticate to get the userKey
    logger.info('Authenticating with Redtail...')
    const authResponse = await fetch(
      'https://review.crm.redtailtechnology.com/api/public/v1/authentication',
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.REDTAIL_API_KEY}:${params.username}:${params.password}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!authResponse.ok) {
      const errorText = await authResponse.text()
      logger.error(
        `Redtail authentication failed: ${authResponse.status} ${authResponse.statusText}`,
        errorText
      )
      throw new Error(
        `Authentication failed: ${authResponse.status} ${authResponse.statusText} - ${errorText}`
      )
    }

    const authData = await authResponse.json()
    const userKey = authData.authenticated_user?.user_key || authData.userkey

    if (!userKey) {
      logger.error('No userkey found in authentication response', authData)
      throw new Error('Authentication response did not contain a valid userkey')
    }

    // Build URL based on whether we're getting a specific contact or list
    const baseUrl = 'https://review.crm.redtailtechnology.com/api/public/v1'
    let url: string

    if (params.contactId) {
      // Get specific contact by ID
      const contactUrl = new URL(`${baseUrl}/contacts/${params.contactId}`)
      contactUrl.searchParams.set('recently_viewed', 'true')
      url = contactUrl.toString()
    } else {
      // Get list of contacts
      const listUrl = new URL(`${baseUrl}/contacts`)
      listUrl.searchParams.set('page', (params.page || 1).toString())
      url = listUrl.toString()
    }

    // Build headers
    const credentials = `${env.REDTAIL_API_KEY}:${userKey}`
    const encodedCredentials = Buffer.from(credentials).toString('base64')

    const includeHeader = params.contactId
      ? 'addresses,phones,emails,urls'
      : 'addresses,phones,emails,urls,family,family.members,tag_memberships'

    const headers: Record<string, string> = {
      Authorization: `Userkeyauth ${encodedCredentials}`,
      'Content-Type': 'application/json',
      include: includeHeader,
    }

    // Add pagesize header for list requests
    if (!params.contactId) {
      headers.pagesize = (params.page || 1).toString()
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    return redtailReadContactTool.transformResponse?.(response, params)
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
        `Redtail contact API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to read Redtail contact: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: false,
        output: {
          metadata: {
            operation: 'read_contact' as const,
            contactId: params?.contactId,
            itemType: 'contact' as const,
          },
        },
      }
    }

    // Handle different response structures
    if (params?.contactId) {
      // Single contact response
      if (data.contact) {
        return {
          success: true,
          output: {
            contact: data.contact,
            metadata: {
              operation: 'read_contact' as const,
              itemId: data.contact.id,
              contactId: params.contactId,
              itemType: 'contact' as const,
            },
          },
        }
      }
      // Direct contact object
      return {
        success: true,
        output: {
          contact: data,
          metadata: {
            operation: 'read_contact' as const,
            itemId: data.id,
            contactId: params.contactId,
            itemType: 'contact' as const,
          },
        },
      }
    }
    // Multiple contacts response
    if (data.contacts) {
      const contacts = Array.isArray(data.contacts) ? data.contacts : [data.contacts]

      return {
        success: true,
        output: {
          contacts,
          meta: data.meta, // Include pagination info
          metadata: {
            operation: 'read_contact' as const,
            itemType: 'contact' as const,
          },
        },
      }
    }

    // Fallback for unexpected response structure
    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'read_contact' as const,
          contactId: params?.contactId,
          itemType: 'contact' as const,
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

    return 'An error occurred while reading Redtail contact'
  },
}
