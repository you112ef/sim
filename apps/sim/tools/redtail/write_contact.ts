import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { RedtailResponse, RedtailWriteParams } from './types'

const logger = createLogger('RedtailWriteContact')

// Helper function to parse phone number and extract country code
const parsePhoneNumber = (phoneNumber: string) => {
  const cleaned = phoneNumber.trim()
  
  if (cleaned.startsWith('+')) {
    // Extract country code (1-3 digits after +)
    const match = cleaned.match(/^\+(\d{1,3})(.+)$/)
    if (match) {
      return {
        countryCode: match[1],
        number: match[2].replace(/\D/g, ''), // Remove non-digits from number
      }
    }
  }
  
  // Default to US (+1) if no country code provided
  return {
    countryCode: '1',
    number: cleaned.replace(/\D/g, ''), // Remove non-digits
  }
}

export const redtailWriteContactTool: ToolConfig<RedtailWriteParams, RedtailResponse> = {
  id: 'redtail_write_contact',
  name: 'Write Redtail Contact',
  description: 'Create a new contact in Redtail CRM',
  version: '1.0.0',

  directExecution: async (params) => {
    if (!params.apiKey || !params.username || !params.password) {
      throw new Error('API Key, username, and password are required')
    }

    // Validate required fields
    if (!params.firstName || params.firstName.trim() === '') {
      throw new Error('First name is required')
    }
    if (!params.lastName || params.lastName.trim() === '') {
      throw new Error('Last name is required')
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

    // Create the contact
    const credentials = `${params.apiKey}:${userKey}`
    const encodedCredentials = Buffer.from(credentials).toString('base64')
    
    const contactBody = {
      first_name: params.firstName.trim(),
      last_name: params.lastName.trim(),
      middle_name: params.middleName || '',
      tax_id: params.taxId || '',
      dob: params.dateOfBirth || '',
      source_id: params.sourceId || 2,
      status_id: params.statusId || 2,
      category_id: params.categoryId || 5,
    }

    const response = await fetch('https://review.crm.redtailtechnology.com/api/public/v1/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Userkeyauth ${encodedCredentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contactBody),
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Redtail write contact API error: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Failed to write Redtail contact: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    let contact = data.contact || data
    let contactId = contact.id

    if (!contactId) {
      throw new Error('Failed to get contact ID from response')
    }

    logger.info(`Contact created successfully with ID: ${contactId}`)
    const warnings: string[] = []

    // Add email if provided
    if (params.contactEmailAddress && params.contactEmailAddress.trim() !== '') {
      try {
        const emailResponse = await fetch(`https://review.crm.redtailtechnology.com/api/public/v1/contacts/${contactId}/emails`, {
          method: 'POST',
          headers: {
            Authorization: `Userkeyauth ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: params.contactEmailAddress.trim(),
            email_type: 'Personal',
            primary: true,
          }),
        })
        
        if (!emailResponse.ok) {
          const errorText = await emailResponse.text()
          throw new Error(`HTTP ${emailResponse.status}: ${errorText}`)
        }
        
      } catch (error) {
        const errorMsg = `Failed to add email to contact: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMsg)
        warnings.push(errorMsg)
      }
    }

    // Add phone if provided
    if (params.contactPhoneNumber && params.contactPhoneNumber.trim() !== '') {
      try {
        const { countryCode, number } = parsePhoneNumber(params.contactPhoneNumber)
        
        const phoneResponse = await fetch(`https://review.crm.redtailtechnology.com/api/public/v1/contacts/${contactId}/phones`, {
          method: 'POST',
          headers: {
            Authorization: `Userkeyauth ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            number: number,
            country_code: countryCode,
            phone_type: 'Mobile',
            primary: true,
          }),
        })
        
        if (!phoneResponse.ok) {
          const errorText = await phoneResponse.text()
          throw new Error(`HTTP ${phoneResponse.status}: ${errorText}`)
        }
        
      } catch (error) {
        const errorMsg = `Failed to add phone to contact: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMsg)
        warnings.push(errorMsg)
      }
    }

    // Add note if provided
    if (params.contactNote && params.contactNote.trim() !== '') {
      try {
        const noteResponse = await fetch(`https://review.crm.redtailtechnology.com/api/public/v1/contacts/${contactId}/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Userkeyauth ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: params.contactNote.trim(),
            category_id: 2,
            note_type: 1,
            pinned: false,
            draft: false,
          }),
        })
        
        if (!noteResponse.ok) {
          const errorText = await noteResponse.text()
          throw new Error(`HTTP ${noteResponse.status}: ${errorText}`)
        }
        
      } catch (error) {
        const errorMsg = `Failed to add note to contact: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMsg)
        warnings.push(errorMsg)
      }
    }

    return {
      success: true,
      output: {
        contact,
        warnings: warnings.length > 0 ? warnings : undefined,
        metadata: {
          operation: 'write_contact' as const,
          itemId: contactId,
          contactId: contactId,
          itemType: 'contact' as const,
        },
      },
    }
  },
  params: {
    firstName: {
      type: 'input',
      required: true,
      description: 'First name of the contact',
    },
    lastName: {
      type: 'input',
      required: true,
      description: 'Last name of the contact',
    },
    contactEmailAddress: {
      type: 'input',
      required: false,
      description: 'Email address of the contact',
    },
    contactPhoneNumber: {
      type: 'input',
      required: false,
      description: 'Phone number of the contact',
    },
    middleName: {
      type: 'input',
      required: false,
      description: 'Middle name of the contact',
    },
    taxId: {
      type: 'input',
      required: false,
      description: 'Tax ID/SSN of the contact',
    },
    dateOfBirth: {
      type: 'input',
      required: false,
      description: 'Date of birth (YYYY-MM-DD format)',
    },
    sourceId: {
      type: 'input',
      required: false,
      description: 'Source ID (default: 2)',
    },
    statusId: {
      type: 'input',
      required: false,
      description: 'Status ID (default: 2)',
    },
    categoryId: {
      type: 'input',
      required: false,
      description: 'Category ID (default: 5)',
    },
    contactNote: {
      type: 'long-input',
      required: false,
      description: 'Optional note to attach to the contact',
    },
  },
  request: {
    url: () => {
      return 'https://review.crm.redtailtechnology.com/api/public/v1/contacts'
    },
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey || !params.username || !params.password) {
        throw new Error('API Key, username, and password are required')
      }
      
      // Note: This is a placeholder. The actual authentication will be handled in directExecution
      return {
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Validate required fields
      if (!params.firstName || params.firstName.trim() === '') {
        throw new Error('First name is required')
      }
      if (!params.lastName || params.lastName.trim() === '') {
        throw new Error('Last name is required')
      }

      // Build the request body with required and optional fields
      const requestBody: any = {
        type: 'Crm::Contact::Individual', // Fixed value for individual contacts
        source_id: params.sourceId || 2,
        source: 'Internet Advertisement', // Default source
        status_id: params.statusId || 2,
        category_id: params.categoryId || 5,
        first_name: params.firstName.trim(),
        last_name: params.lastName.trim(),
      }

      // Add optional fields if provided
      if (params.middleName && params.middleName.trim() !== '') {
        requestBody.middle_name = params.middleName.trim()
      }

      if (params.taxId && params.taxId.trim() !== '') {
        requestBody.tax_id = params.taxId.trim()
      }

      if (params.dateOfBirth && params.dateOfBirth.trim() !== '') {
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(params.dateOfBirth)) {
          throw new Error('Date of birth must be in YYYY-MM-DD format')
        }
        requestBody.dob = params.dateOfBirth.trim()
      }

      return requestBody
    },
  },
  transformResponse: async (response: Response, params?: RedtailWriteParams) => {
    // This function is not used since we use directExecution
    // Keeping it for compatibility with the ToolConfig interface
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Redtail write contact API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to write Redtail contact: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()
    const contact = data.contact || data

    return {
      success: true,
      output: {
        contact,
        metadata: {
          operation: 'write_contact' as const,
          itemId: contact.id,
          contactId: contact.id,
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

    return 'An error occurred while writing Redtail contact'
  },
}
