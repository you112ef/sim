import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('RedtailContactSearch')

export async function POST(request: NextRequest) {
  try {
    const { username, password, query } = await request.json()

    const apiKey = env.REDTAIL_API_KEY
    if (!apiKey || !username || !password) {
      return NextResponse.json(
        { error: 'Redtail API key not configured or missing username/password' },
        { status: 400 }
      )
    }

    // First authenticate to get userKey
    logger.info('Authenticating with Redtail for contact search', {
      apiKey: apiKey ? `${apiKey.substring(0, 4)}...` : 'missing',
      username: username ? `${username.substring(0, 2)}...` : 'missing',
      password: password ? '***' : 'missing',
    })

    const authCredentials = `${apiKey}:${username}:${password}`
    const authEncodedCredentials = Buffer.from(authCredentials).toString('base64')
    logger.info('Authentication format', {
      credentialsLength: authCredentials.length,
      encodedLength: authEncodedCredentials.length,
      authHeader: `Basic ${authEncodedCredentials.substring(0, 20)}...`,
    })

    const authResponse = await fetch(
      'https://review.crm.redtailtechnology.com/api/public/v1/authentication',
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authEncodedCredentials}`,
          'Content-Type': 'application/json',
        },
      }
    )

    logger.info('Authentication response status', {
      status: authResponse.status,
      statusText: authResponse.statusText,
      headers: Object.fromEntries(authResponse.headers.entries()),
    })

    if (!authResponse.ok) {
      const errorText = await authResponse.text()
      logger.error(`Redtail authentication failed: ${authResponse.status}`, {
        statusText: authResponse.statusText,
        error: errorText,
        url: 'https://review.crm.redtailtechnology.com/api/public/v1/authentication',
      })
      return NextResponse.json(
        { error: `Authentication failed: ${authResponse.status} - ${errorText}` },
        { status: authResponse.status }
      )
    }

    const authData = await authResponse.json()
    logger.info('Authentication response data', {
      responseKeys: Object.keys(authData),
      responseData: authData,
    })

    // Extract userkey from the nested structure
    const userKey = authData.authenticated_user?.user_key || authData.userkey

    if (!userKey) {
      logger.error('No userkey in response', {
        authData,
        expectedPaths: ['authenticated_user.user_key', 'userkey'],
        availableKeys: Object.keys(authData),
        authenticatedUser: authData.authenticated_user,
      })
      return NextResponse.json(
        { error: 'Authentication response did not contain userkey' },
        { status: 500 }
      )
    }

    logger.info('Successfully extracted userkey', {
      userKey: userKey ? `${userKey.substring(0, 8)}...` : 'missing',
    })

    // Now search contacts using the userKey
    const credentials = `${apiKey}:${userKey}`
    const encodedCredentials = Buffer.from(credentials).toString('base64')

    // Build search URL
    const searchUrl = new URL(
      'https://review.crm.redtailtechnology.com/api/public/v1/contacts/search'
    )
    if (query) {
      searchUrl.searchParams.set('formatted_full_name', query)
    }

    logger.info('Searching Redtail contacts', { query, url: searchUrl.toString() })

    // Make request to Redtail API
    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Userkeyauth ${encodedCredentials}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Redtail search failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: `Search failed: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Transform the response to a format suitable for dropdowns
    const contacts = data.contacts || []
    const options = contacts.map((contact: any) => ({
      id: contact.id,
      label: contact.formatted_full_name || `${contact.first_name} ${contact.last_name}`.trim(),
      value: contact.id,
      // Include additional info that might be useful
      email: contact.emails?.[0]?.address || '',
      phone: contact.phones?.[0]?.number || '',
    }))

    return NextResponse.json({ options })
  } catch (error) {
    logger.error('Error in contact search', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
