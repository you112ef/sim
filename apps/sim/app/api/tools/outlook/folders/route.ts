import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OutlookFoldersAPI')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })
    }

    // Get OAuth token
    const accessToken = await getOAuthToken(session.user.id, 'outlook')
    if (!accessToken) {
      return NextResponse.json({ error: 'No Outlook credentials found' }, { status: 404 })
    }

    // Fetch mail folders from Microsoft Graph
    const response = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch folders: ${response.status}`)
    }

    const data = await response.json()
    
    // Transform folders to match Gmail labels format
    const folders = data.value?.map((folder: any) => ({
      id: folder.id,
      name: folder.displayName,
      type: folder.wellKnownName || 'user',
      messagesTotal: folder.totalItemCount || 0,
      messagesUnread: folder.unreadItemCount || 0,
    })) || []

    // Add well-known folders first, then custom folders
    const sortedFolders = [
      ...folders.filter((f: any) => f.type !== 'user'),
      ...folders.filter((f: any) => f.type === 'user'),
    ]

    return NextResponse.json({ folders: sortedFolders })
  } catch (error) {
    logger.error('Error fetching Outlook folders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch folders' },
      { status: 500 }
    )
  }
}
