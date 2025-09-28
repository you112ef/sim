import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { FIELD_TYPE_METADATA, SUPPORTED_FIELD_TYPES } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('FieldTypesAPI')

// GET /api/knowledge/field-types - Get metadata for all supported field types
export async function GET(req: NextRequest) {
  try {
    logger.info('Getting field type metadata')

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const fieldTypes = SUPPORTED_FIELD_TYPES.map((fieldType) => ({
      value: fieldType,
      ...FIELD_TYPE_METADATA[fieldType],
    }))

    return NextResponse.json({
      success: true,
      data: {
        fieldTypes,
        supportedTypes: SUPPORTED_FIELD_TYPES,
      },
    })
  } catch (error) {
    logger.error('Error getting field type metadata', error)
    return NextResponse.json({ error: 'Failed to get field type metadata' }, { status: 500 })
  }
}
