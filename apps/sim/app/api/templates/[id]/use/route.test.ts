/**
 * Integration tests for template usage API route
 * Tests template application to create workflows
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Template Use API Route', () => {
  const templateId = 'template-123'
  const workspaceId = 'workspace-123'

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
      v4: vi.fn().mockReturnValue('mock-workflow-123'),
    }))

    // Mock the database schema module
    vi.doMock('@/db/schema', () => ({
      templates: {},
      workflow: {},
    }))

    // Mock drizzle-orm operators
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      sql: vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
    }))

    // Mock the workflows db-helpers module
    vi.doMock('@/lib/workflows/db-helpers', () => ({
      saveWorkflowToNormalizedTables: vi.fn().mockResolvedValue({
        success: true,
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/templates/[id]/use', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      vi.doMock('@/db', () => ({
        db: {},
      }))

      const req = new NextRequest(`http://localhost:3000/api/templates/${templateId}/use`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      })
      const params = Promise.resolve({ id: templateId })

      const { POST } = await import('./route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should create workflow successfully with ID remapping', async () => {
      const mockTemplateData = {
        id: templateId,
        name: 'Test Template',
        description: 'Test Description',
        state: {
          blocks: {
            'template-block-1': {
              id: 'template-block-1',
              type: 'agent',
              name: 'Agent Block',
              position: { x: 100, y: 100 },
              subBlocks: {
                systemPrompt: { value: 'You are a helpful assistant' },
                model: { value: 'gpt-4' },
              },
              data: { temperature: 0.7 },
              outputs: {},
            },
            'template-block-2': {
              id: 'template-block-2',
              type: 'response',
              name: 'Response Block',
              position: { x: 300, y: 100 },
              subBlocks: {},
              data: {},
              outputs: {},
            },
          },
          edges: [
            {
              id: 'template-edge-1',
              source: 'template-block-1',
              target: 'template-block-2',
              sourceHandle: 'output',
              targetHandle: 'input',
            },
          ],
          loops: {
            'template-loop-1': {
              id: 'template-loop-1',
              nodes: ['template-block-1'],
              iterationCount: 3,
            },
          },
          parallels: {
            'template-parallel-1': {
              id: 'template-parallel-1',
              nodes: ['template-block-2'],
              parallelCount: 2,
            },
          },
        },
        color: '#3972F6',
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => {
        let selectCallCount = 0
        return {
          db: {
            select: vi.fn().mockImplementation(() => {
              selectCallCount++
              return {
                from: vi.fn().mockImplementation(() => ({
                  where: vi.fn().mockImplementation(() => ({
                    limit: vi.fn().mockImplementation(() => {
                      // First call: template lookup
                      if (selectCallCount === 1) {
                        return Promise.resolve([mockTemplateData])
                      }
                      // Second call: verification query
                      if (selectCallCount === 2) {
                        return Promise.resolve([{ id: 'mock-workflow-123' }])
                      }
                      // Default: empty array
                      return Promise.resolve([])
                    }),
                  })),
                })),
              }
            }),
            transaction: vi.fn().mockImplementation(async (callback) => {
              const tx = {
                update: vi.fn().mockReturnValue({
                  set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                  }),
                }),
                insert: vi.fn().mockReturnValue({
                  values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'mock-workflow-123' }]),
                  }),
                }),
              }
              return await callback(tx)
            }),
          },
        }
      })

      const req = new NextRequest(`http://localhost:3000/api/templates/${templateId}/use`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      })
      const params = Promise.resolve({ id: templateId })

      const { POST } = await import('./route')
      const response = await POST(req, { params })

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.message).toBe('Template used successfully')
      expect(data.workflowId).toBe('mock-workflow-123')
      expect(data.workspaceId).toBe(workspaceId)
    })
  })
})
