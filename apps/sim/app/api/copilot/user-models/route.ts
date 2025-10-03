import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/../../packages/db'
import { settings } from '@/../../packages/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotUserModelsAPI')

const DEFAULT_ENABLED_MODELS = [
  'gpt-5',
  'gpt-5-medium',
  'o3',
  'claude-4-sonnet',
  'claude-4.5-sonnet',
  'claude-4.1-opus',
]

// GET - Fetch user's enabled models
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Try to fetch existing settings record
    const [userSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    if (userSettings) {
      return NextResponse.json({
        enabledModels: userSettings.copilotEnabledModels || DEFAULT_ENABLED_MODELS,
      })
    }

    // If no settings record exists, create one with defaults
    const [created] = await db
      .insert(settings)
      .values({
        id: userId,
        userId,
        copilotEnabledModels: DEFAULT_ENABLED_MODELS,
      })
      .returning()

    return NextResponse.json({
      enabledModels: created.copilotEnabledModels || DEFAULT_ENABLED_MODELS,
    })
  } catch (error) {
    logger.error('Failed to fetch user models', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Update user's enabled models
export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    if (!body.enabledModels || !Array.isArray(body.enabledModels)) {
      return NextResponse.json(
        { error: 'enabledModels must be an array' },
        { status: 400 }
      )
    }

    // Check if settings record exists
    const [existing] = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    if (existing) {
      // Update existing record
      await db
        .update(settings)
        .set({
          copilotEnabledModels: body.enabledModels,
          updatedAt: new Date(),
        })
        .where(eq(settings.userId, userId))
    } else {
      // Create new settings record
      await db.insert(settings).values({
        id: userId,
        userId,
        copilotEnabledModels: body.enabledModels,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to update user models', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
