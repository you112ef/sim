import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('EnvironmentVariablesAPI')

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // For GET requests, check for workflowId in query params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    
    // Use dual authentication pattern like other copilot tools
    const userId = await getUserId(requestId, workflowId || undefined)
    
    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get only the variable names (keys), not values
    const result = await getEnvironmentVariableKeys(userId)

    return NextResponse.json({ 
      success: true,
      output: result
    }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Environment variables fetch error`, error)
    return NextResponse.json({ 
      success: false,
      error: error.message || 'Failed to get environment variables' 
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowId } = body
    
    // Use dual authentication pattern like other copilot tools
    const userId = await getUserId(requestId, workflowId)
    
    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get only the variable names (keys), not values
    const result = await getEnvironmentVariableKeys(userId)

    return NextResponse.json({ 
      success: true,
      output: result
    }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Environment variables fetch error`, error)
    return NextResponse.json({ 
      success: false,
      error: error.message || 'Failed to get environment variables' 
    }, { status: 500 })
  }
} 