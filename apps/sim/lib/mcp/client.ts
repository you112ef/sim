import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MCPClient')

export interface MCPServerConfig {
  id: string
  name: string
  url: string
  headers?: Record<string, string>
  transport: 'stdio' | 'http-sse'
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema: any
}

export class MCPClientManager {
  private clients: Map<string, Client> = new Map()
  private serverConfigs: Map<string, MCPServerConfig> = new Map()

  async connectToServer(config: MCPServerConfig): Promise<Client> {
    try {
      logger.info(`Connecting to MCP server: ${config.name}`)

      // Create appropriate transport
      let transport
      if (config.transport === 'stdio') {
        // For local servers
        const command = config.url.split(' ')[0]
        const args = config.url.split(' ').slice(1)
        transport = new StdioClientTransport({ command, args })
      } else {
        // For HTTP SSE servers
        transport = new StreamableHTTPClientTransport(new URL(config.url))
        // TODO: Add headers support if needed
      }

      // Create and connect client
      const client = new Client(
        {
          name: 'sim-agent',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            prompts: {},
            resources: {},
          },
        }
      )

      await client.connect(transport)

      // Store client and config
      this.clients.set(config.id, client)
      this.serverConfigs.set(config.id, config)

      logger.info(`Successfully connected to MCP server: ${config.name}`)
      return client
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${config.name}:`, error)
      throw error
    }
  }

  async disconnectFromServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.close()
      this.clients.delete(serverId)
      this.serverConfigs.delete(serverId)
      logger.info(`Disconnected from MCP server: ${serverId}`)
    }
  }

  async getServerTools(serverId: string): Promise<MCPTool[]> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`No active connection to server: ${serverId}`)
    }

    try {
      const response = await client.listTools()
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    } catch (error) {
      logger.error(`Failed to list tools for server ${serverId}:`, error)
      throw error
    }
  }

  async callTool(serverId: string, toolName: string, parameters: any): Promise<any> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`No active connection to server: ${serverId}`)
    }

    try {
      const response = await client.callTool({
        name: toolName,
        arguments: parameters,
      })

      return response.content
    } catch (error) {
      logger.error(`Failed to call tool ${toolName} on server ${serverId}:`, error)
      throw error
    }
  }

  getConnectedServers(): MCPServerConfig[] {
    return Array.from(this.serverConfigs.values())
  }

  isConnected(serverId: string): boolean {
    return this.clients.has(serverId)
  }
}

// Singleton instance
export const mcpClient = new MCPClientManager()
