/**
 * Integration tests for templates API route
 * Tests template creation and retrieval functionality
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Templates API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-req-12345678'),
    })

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-template-123'),
    }))

    // Mock the database schema module
    vi.doMock('@/db/schema', () => ({
      templates: {},
      templateStars: {},
      workflow: {},
    }))

    // Mock drizzle-orm operators
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
      ilike: vi.fn((field, value) => ({ field, value, type: 'ilike' })),
      or: vi.fn((...conditions) => ({ conditions, type: 'or' })),
      sql: vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/templates', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      vi.doMock('@/db', () => ({
        db: {},
      }))

      const req = new NextRequest('http://localhost:3000/api/templates')

      const { GET } = await import('./route')
      const response = await GET(req)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return templates with pagination', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          workflowId: 'workflow-1',
          userId: 'user-123',
          name: 'Test Template 1',
          description: 'Description 1',
          author: 'Test Author',
          views: 100,
          stars: 5,
          color: '#3972F6',
          icon: 'FileText',
          category: 'marketing',
          state: { blocks: {}, edges: [] },
          createdAt: '2025-07-23T04:00:12.671Z',
          updatedAt: '2025-07-23T04:00:12.671Z',
          isStarred: false,
        },
      ]

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue(mockTemplates),
                      }),
                    }),
                  }),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ count: 1 }]), // Total count query
              }),
            }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/templates?limit=10&offset=0')

      const { GET } = await import('./route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data).toEqual(mockTemplates)
      expect(data.pagination).toBeDefined()
    })
  })

  describe('POST /api/templates', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      vi.doMock('@/db', () => ({
        db: {},
      }))

      const validTemplateData = {
        workflowId: 'workflow-123',
        name: 'Test Template',
        description: 'Test Description',
        author: 'Test Author',
        category: 'marketing',
        icon: 'FileText',
        color: '#3972F6',
      }

      const req = new NextRequest('http://localhost:3000/api/templates', {
        method: 'POST',
        body: JSON.stringify(validTemplateData),
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should create template successfully with ID remapping', async () => {
      const mockNormalizedData = {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'agent',
            name: 'Test Block',
            position: { x: 0, y: 0 },
            subBlocks: {
              systemPrompt: { value: 'You are a helpful assistant' },
            },
            data: {},
            outputs: {},
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'block-1',
            target: 'block-2',
            sourceHandle: null,
            targetHandle: null,
          },
        ],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'workflow-123' }]), // Workflow exists
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([{ id: 'mock-template-123' }]),
          }),
        },
      }))

      vi.doMock('@/lib/workflows/db-helpers', () => ({
        loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue(mockNormalizedData),
      }))

      const validTemplateData = {
        workflowId: 'workflow-123',
        name: 'Test Template',
        description: 'Test Description',
        author: 'Test Author',
        category: 'marketing',
        icon: 'FileText',
        color: '#3972F6',
      }

      const req = new NextRequest('http://localhost:3000/api/templates', {
        method: 'POST',
        body: JSON.stringify(validTemplateData),
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.id).toBe('mock-template-123')
      expect(data.message).toBe('Template created successfully')
    })
  })
})
