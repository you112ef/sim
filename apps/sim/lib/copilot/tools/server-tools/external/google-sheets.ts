import { BaseCopilotTool } from '../base'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { getSession } from '@/lib/auth'
import { executeTool } from '@/tools'
import type { GoogleSheetsReadResponse } from '@/tools/google_sheets/types'

interface GoogleSheetsReadParams {
  userId?: string
  spreadsheetId: string
  range?: string
}

interface GoogleSheetsReadResult {
  data: {
    range: string
    values: any[][]
  }
  metadata: {
    spreadsheetId: string
    spreadsheetUrl: string
  }
}

class GoogleSheetsReadTool extends BaseCopilotTool<GoogleSheetsReadParams, GoogleSheetsReadResult> {
  readonly id = 'google_sheets_read'
  readonly displayName = 'Read Google Sheets'

  protected async executeImpl(params: GoogleSheetsReadParams): Promise<GoogleSheetsReadResult> {
    return await readGoogleSheets(params)
  }
}

// Export the tool instance
export const googleSheetsReadTool = new GoogleSheetsReadTool()

// Implementation function that wraps the existing google_sheets_read tool
async function readGoogleSheets(params: GoogleSheetsReadParams): Promise<GoogleSheetsReadResult> {
  const logger = createLogger('GoogleSheetsRead')
  const { userId: directUserId, spreadsheetId, range } = params

  logger.info('Reading Google Sheets data for copilot', {
    hasUserId: !!directUserId,
    spreadsheetId,
    range,
  })

  // Get userId from session if not provided directly
  let userId = directUserId
  if (!userId) {
    const session = await getSession()
    userId = session?.user?.id
  }

  if (!userId) {
    logger.warn('No userId could be determined')
    throw new Error('User authentication required')
  }

  // Validate required parameters
  if (!spreadsheetId) {
    throw new Error('Spreadsheet ID is required')
  }

  // Get OAuth access token for Google Sheets
  const accessToken = await getOAuthToken(userId, 'google-sheets')
  if (!accessToken) {
    throw new Error('Google Sheets authorization required. Please connect your Google account in the settings.')
  }

  logger.info('Retrieved OAuth token for Google Sheets', {
    userId,
    hasToken: !!accessToken,
  })

  // Prepare parameters for the existing google_sheets_read tool
  const toolParams = {
    accessToken,
    spreadsheetId,
    range,
  }

  logger.info('Executing google_sheets_read tool', {
    spreadsheetId,
    range,
  })

  // Execute the existing google_sheets_read tool
  const result = await executeTool('google_sheets_read', toolParams)

  if (!result.success) {
    logger.error('Google Sheets read tool failed', {
      error: result.error,
      spreadsheetId,
    })
    throw new Error(result.error || 'Failed to read Google Sheets data')
  }

  const sheetsResponse = result.output as GoogleSheetsReadResponse

  logger.info('Google Sheets read successful', {
    spreadsheetId,
    range: sheetsResponse.output.data.range,
    rowCount: sheetsResponse.output.data.values?.length || 0,
  })

  // Return the data in the expected format
  return {
    data: sheetsResponse.output.data,
    metadata: {
      spreadsheetId: sheetsResponse.output.metadata.spreadsheetId,
      spreadsheetUrl: sheetsResponse.output.metadata.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    },
  }
} 