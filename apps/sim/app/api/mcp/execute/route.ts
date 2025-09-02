import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { type MCPServerConfig, mcpClient } from '@/lib/mcp/client'

const logger = createLogger('MCPExecuteAPI')

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { serverUrl, headers, toolName, params } = await request.json()

    if (!serverUrl || !toolName) {
      return NextResponse.json({ error: 'Server URL and tool name are required' }, { status: 400 })
    }

    logger.info(`Executing MCP tool ${toolName} on server ${serverUrl}`)

    // Create temporary server config for tool execution
    const tempServerId = `exec-${Date.now()}`
    const serverConfig: MCPServerConfig = {
      id: tempServerId,
      name: 'temp-execution',
      url: serverUrl,
      headers,
      transport: serverUrl.includes('/sse') ? 'http-sse' : 'stdio',
    }

    let client
    try {
      // Connect to server
      client = await mcpClient.connectToServer(serverConfig)

      // Execute the tool
      const result = await mcpClient.callTool(tempServerId, toolName, params || {})

      logger.info(`MCP tool execution completed: ${toolName}`)

      return NextResponse.json({
        success: true,
        output: result,
      })
    } finally {
      // Always disconnect temporary connection
      if (client) {
        await mcpClient.disconnectFromServer(tempServerId)
      }
    }
  } catch (error) {
    logger.error('Error executing MCP tool:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to execute MCP tool',
      },
      { status: 500 }
    )
  }
}
