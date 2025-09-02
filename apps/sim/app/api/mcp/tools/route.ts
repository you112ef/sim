import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { type MCPServerConfig, mcpClient } from '@/lib/mcp/client'

const logger = createLogger('MCPToolsAPI')

export async function POST(request: NextRequest) {
  try {
    const { serverUrl, headers } = await request.json()

    if (!serverUrl) {
      return NextResponse.json({ error: 'Server URL is required' }, { status: 400 })
    }

    // Create temporary server config for tool discovery
    const tempServerId = `temp-${Date.now()}`
    const serverConfig: MCPServerConfig = {
      id: tempServerId,
      name: 'temp-discovery',
      url: serverUrl,
      headers,
      transport: serverUrl.includes('/sse') ? 'http-sse' : 'stdio',
    }

    let client
    try {
      // Connect to server
      client = await mcpClient.connectToServer(serverConfig)

      // Discover available tools
      const tools = await mcpClient.getServerTools(tempServerId)

      // Return tool names for the submenu
      const toolNames = tools.map((tool) => tool.name)

      logger.info(`Discovered ${toolNames.length} tools from ${serverUrl}:`, toolNames)

      return NextResponse.json({
        tools: toolNames,
        schemas: tools.reduce(
          (acc, tool) => ({
            ...acc,
            [tool.name]: {
              description: tool.description,
              inputSchema: tool.inputSchema,
            },
          }),
          {}
        ),
      })
    } finally {
      // Always disconnect temporary connection
      if (client) {
        await mcpClient.disconnectFromServer(tempServerId)
      }
    }
  } catch (error) {
    logger.error('Error discovering MCP tools:', error)
    return NextResponse.json(
      {
        error: 'Failed to discover MCP tools',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
