/**
 * Tests for copilot chat API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockCryptoUuid,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Chat API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockOrderBy = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockReturning = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()

  const mockExecuteProviderRequest = vi.fn()
  const mockGetCopilotModel = vi.fn()
  const mockGetRotatingApiKey = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({
      orderBy: mockOrderBy,
      limit: mockLimit,
    })
    mockOrderBy.mockResolvedValue([])
    mockLimit.mockResolvedValue([])
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    vi.doMock('@/db/schema', () => ({
      copilotChats: {
        id: 'id',
        userId: 'userId',
        messages: 'messages',
        title: 'title',
        model: 'model',
        workflowId: 'workflowId',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
    }))

    mockGetCopilotModel.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
    })

    // No longer using copilot config or prompts; mocks removed

    mockExecuteProviderRequest.mockResolvedValue({
      content: 'Generated Title',
    })

    vi.doMock('@/providers', () => ({
      executeProviderRequest: mockExecuteProviderRequest,
    }))

    mockGetRotatingApiKey.mockReturnValue('test-api-key')

    vi.doMock('@/lib/utils', () => ({
      getRotatingApiKey: mockGetRotatingApiKey,
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        SIM_AGENT_API_URL: 'http://localhost:8000',
        COPILOT_API_KEY: 'test-sim-agent-key',
        BETTER_AUTH_URL: 'http://localhost:3000',
      },
      isTruthy: (value: string | boolean | number | undefined) =>
        typeof value === 'string'
          ? value.toLowerCase() === 'true' || value === '1'
          : Boolean(value),
    }))

    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = createMockRequest('POST', {
        message: 'Hello',
        workflowId: 'workflow-123',
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 for invalid request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        // Missing required fields
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request data')
      expect(responseData.details).toBeDefined()
    })

    it('should handle new chat creation and forward to sim agent', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock successful chat creation
      const newChat = {
        id: 'chat-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        title: null,
        model: 'claude-3-haiku-20240307',
        messages: [],
      }
      mockReturning.mockResolvedValue([newChat])

      // Mock successful sim agent response
      const mockReadableStream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode('data: {"type": "assistant_message", "content": "Hello response"}\\n\\n')
          )
          controller.close()
        },
      })

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const req = createMockRequest('POST', {
        message: 'Hello',
        workflowId: 'workflow-123',
        createNewChat: true,
        stream: true,
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith({
        userId: 'user-123',
        workflowId: 'workflow-123',
        title: null,
        model: 'claude-3-haiku-20240307',
        messages: [],
      })

      // Verify sim agent was called and includes prefetchResults
      expect(global.fetch).toHaveBeenCalled()
      const fetchArgs = (global.fetch as any).mock.calls[0]
      expect(fetchArgs[0]).toBe('http://localhost:8000/api/chat-completion-streaming')
      const payload = JSON.parse(fetchArgs[1].body)
      expect(payload).toEqual(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
          workflowId: 'workflow-123',
          userId: 'user-123',
          stream: true,
          streamToolCalls: true,
          mode: 'agent',
          provider: 'openai',
          depth: 0,
          origin: 'http://localhost:3000',
        })
      )
      expect(payload.prefetchResults).toBeDefined()
    })

    it('should load existing chat and include conversation history', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock existing chat with history
      const existingChat = {
        id: 'chat-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        title: 'Existing Chat',
        messages: [
          { role: 'user', content: 'Previous message' },
          { role: 'assistant', content: 'Previous response' },
        ],
      }
      // For POST route, the select query uses limit not orderBy
      mockLimit.mockResolvedValue([existingChat])

      // Mock sim agent response
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const req = createMockRequest('POST', {
        message: 'New message',
        workflowId: 'workflow-123',
        chatId: 'chat-123',
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      // Verify conversation history was included and prefetchResults present
      const fetchArgs = (global.fetch as any).mock.calls[0]
      expect(fetchArgs[0]).toBe('http://localhost:8000/api/chat-completion-streaming')
      const payload = JSON.parse(fetchArgs[1].body)
      expect(payload.messages).toEqual([
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
        { role: 'user', content: 'New message' },
      ])
      expect(payload).toEqual(
        expect.objectContaining({
          workflowId: 'workflow-123',
          userId: 'user-123',
          stream: true,
          streamToolCalls: true,
          mode: 'agent',
          provider: 'openai',
          depth: 0,
          origin: 'http://localhost:3000',
        })
      )
      expect(payload.prefetchResults).toBeDefined()
    })

    it('should include implicit feedback in messages', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock new chat creation
      const newChat = {
        id: 'chat-123',
        userId: 'user-123',
        workflowId: 'workflow-123',
        messages: [],
      }
      mockReturning.mockResolvedValue([newChat])

      // Mock sim agent response

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      })

      const req = createMockRequest('POST', {
        message: 'Hello',
        workflowId: 'workflow-123',
        createNewChat: true,
        implicitFeedback: 'User seems confused about the workflow',
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      await POST(req)

      // Verify implicit feedback was included as system message and prefetchResults present
      const fetchArgs = (global.fetch as any).mock.calls[0]
      expect(fetchArgs[0]).toBe('http://localhost:8000/api/chat-completion-streaming')
      const payload = JSON.parse(fetchArgs[1].body)
      expect(payload.messages).toEqual([
        { role: 'system', content: 'User seems confused about the workflow' },
        { role: 'user', content: 'Hello' },
      ])
      expect(payload).toEqual(
        expect.objectContaining({
          workflowId: 'workflow-123',
          userId: 'user-123',
          stream: true,
          streamToolCalls: true,
          mode: 'agent',
          provider: 'openai',
          depth: 0,
          origin: 'http://localhost:3000',
        })
      )
      expect(payload.prefetchResults).toBeDefined()
    })

    it('should handle sim agent API errors', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock new chat creation
      mockReturning.mockResolvedValue([{ id: 'chat-123', messages: [] }])

      // Mock sim agent error

      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      })

      const req = createMockRequest('POST', {
        message: 'Hello',
        workflowId: 'workflow-123',
        createNewChat: true,
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toContain('Sim agent API error')
    })

    it('should handle database errors during chat creation', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock database error
      mockReturning.mockRejectedValue(new Error('Database connection failed'))

      const req = createMockRequest('POST', {
        message: 'Hello',
        workflowId: 'workflow-123',
        createNewChat: true,
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Database connection failed')
    })

    it('should use ask mode when specified', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock new chat creation
      mockReturning.mockResolvedValue([{ id: 'chat-123', messages: [] }])

      // Mock sim agent response

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      })

      const req = createMockRequest('POST', {
        message: 'What is this workflow?',
        workflowId: 'workflow-123',
        createNewChat: true,
        mode: 'ask',
      })

      const { POST } = await import('@/app/api/copilot/chat/route')
      await POST(req)

      const fetchArgs = (global.fetch as any).mock.calls[0]
      expect(fetchArgs[0]).toBe('http://localhost:8000/api/chat-completion-streaming')
      const payload = JSON.parse(fetchArgs[1].body)
      expect(payload).toEqual(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'What is this workflow?' }],
          workflowId: 'workflow-123',
          userId: 'user-123',
          stream: true,
          streamToolCalls: true,
          mode: 'ask',
          provider: 'openai',
          depth: 0,
          origin: 'http://localhost:3000',
        })
      )
      expect(payload.prefetchResults).toBeDefined()
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=workflow-123')

      const { GET } = await import('@/app/api/copilot/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when workflowId is missing', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/chat')

      const { GET } = await import('@/app/api/copilot/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('workflowId is required')
    })

    it('should return chats for authenticated user and workflow', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock returned chats
      const chats = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hello' }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      mockOrderBy.mockResolvedValue(chats)

      const req = new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=workflow-123')

      const { GET } = await import('@/app/api/copilot/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(Array.isArray(responseData.chats)).toBe(true)
      expect(responseData.chats.length).toBe(1)
      expect(responseData.chats[0]).toEqual(
        expect.objectContaining({
          id: 'chat-1',
          title: 'Chat 1',
          model: 'claude-3-haiku-20240307',
          messageCount: 1,
        })
      )
    })

    it('should handle database errors when fetching chats', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockOrderBy.mockRejectedValue(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=workflow-123')

      const { GET } = await import('@/app/api/copilot/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch chats')
    })

    it('should return empty array when no chats found', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockOrderBy.mockResolvedValue([])

      const req = new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=workflow-123')

      const { GET } = await import('@/app/api/copilot/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(Array.isArray(responseData.chats)).toBe(true)
      expect(responseData.chats.length).toBe(0)
    })
  })
})
