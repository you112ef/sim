import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { RedtailResponse, RedtailWriteParams } from './types'

const logger = createLogger('RedtailWriteNote')

export const redtailWriteNoteTool: ToolConfig<RedtailWriteParams, RedtailResponse> = {
  id: 'redtail_write_note',
  name: 'Write Redtail Note',
  description: 'Create a new note in Redtail CRM',
  version: '1.0.0',
  params: {
    contactId: {
      type: 'dropdown',
      required: true,
      description: 'The ID of the contact to create a note for',
    },
    contactNote: {
      type: 'long-input',
      required: true,
      description: 'The note body',
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
    const url = `https://review.crm.redtailtechnology.com/api/public/v1/contacts/${params.contactId}/notes`
    const credentials = `${params.apiKey}:${userKey}`
    const encodedCredentials = Buffer.from(credentials).toString('base64')
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Userkeyauth ${encodedCredentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: params.contactNote,
        category_id: 2,
        note_type: 1,
        pinned: false,
        draft: false,
      }),
    })
    
    return redtailWriteNoteTool.transformResponse?.(response, params)
  },

  request: {
    url: () => '', // Not used with directExecution
    method: 'POST',
    headers: () => ({}), // Not used with directExecution
  },
  transformResponse: async (response: Response, params?: RedtailWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Redtail write note API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to write Redtail note: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: false,
        output: {
          metadata: {
            operation: 'write_note' as const,
            contactId: params?.contactId,
            itemType: 'note' as const,
          },
        },
      }
    }

    // Handle successful note creation
    if (data.note) {
      return {
        success: true,
        output: {
          note: data.note,
          metadata: {
            operation: 'write_note' as const,
            itemId: data.note.id,
            contactId: params?.contactId,
            itemType: 'note' as const,
          },
        },
      }
    }

    // Fallback for unexpected response structure
    return {
      success: true,
      output: {
        note: data,
        metadata: {
          operation: 'write_note' as const,
          contactId: params?.contactId,
          itemType: 'note' as const,
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

    return 'An error occurred while writing Redtail note'
  },
}
