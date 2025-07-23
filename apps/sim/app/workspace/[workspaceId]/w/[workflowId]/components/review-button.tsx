'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Eye, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopilotSandboxModal } from './copilot-sandbox-modal/copilot-sandbox-modal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useCopilotStore } from '@/stores/copilot/store'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotToolCall, CopilotMessage } from '@/stores/copilot/types'

const logger = createLogger('ReviewButton')

// Helper function to extract preview data from messages
export function getLatestUnseenPreview(messages: CopilotMessage[], isToolCallSeen: (id: string) => boolean) {
  if (!messages.length) return null

  const foundPreviews: { toolCallId: string; messageIndex: number; workflowState: any; yamlContent: string; description?: string }[] = []

  // Go through messages in reverse order (newest first) to find all unseen previews
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.toolCalls) continue

         message.toolCalls.forEach((toolCall: CopilotToolCall) => {
      if (
        toolCall.name === 'preview_workflow' &&
        toolCall.state === 'completed' &&
        toolCall.result &&
        toolCall.id &&
        !isToolCallSeen(toolCall.id)
      ) {
        const result = toolCall.result
        let workflowState = null
        let yamlContent = null
        let description = null

        if (result.workflowState) {
          workflowState = result.workflowState
        }

        if (toolCall.input) {
          yamlContent = toolCall.input.yamlContent
          description = toolCall.input.description
        }

        if (workflowState && yamlContent) {
          foundPreviews.push({
            toolCallId: toolCall.id,
            messageIndex: i,
            workflowState,
            yamlContent,
            description,
          })
        }
      }
    })
  }

  if (foundPreviews.length === 0) {
    return null
  }

  // Sort by message index (newest first)
  foundPreviews.sort((a, b) => b.messageIndex - a.messageIndex)

  // Return both the latest preview and all older preview IDs to invalidate
  return {
    latestPreview: {
      toolCallId: foundPreviews[0].toolCallId,
      workflowState: foundPreviews[0].workflowState,
      yamlContent: foundPreviews[0].yamlContent,
      description: foundPreviews[0].description,
    },
    olderPreviewIds: foundPreviews.slice(1).map(p => p.toolCallId)
  }
}

// Dummy functions for backward compatibility
export function setLatestPreview() {
  // This is now handled automatically by scanning messages
}

export function clearLatestPreview() {
  // This is now handled by marking tool calls as seen
}

export function ReviewButton() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId, createWorkflow } = useWorkflowRegistry()
  const { messages, sendImplicitFeedback } = useCopilotStore()
  const { markToolCallAsSeen, isToolCallSeen, seenToolCallIds } = usePreviewStore(
    (state) => ({
      markToolCallAsSeen: state.markToolCallAsSeen,
      isToolCallSeen: state.isToolCallSeen,
      seenToolCallIds: state.seenToolCallIds, // Include this to trigger re-renders
    })
  )
  const [showModal, setShowModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Add debounce timer ref to prevent premature invalidation
  const invalidationTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastToolCallIdRef = useRef<string | null>(null)

  // Get the latest unseen preview from messages
  const latestPreview = useMemo(() => {
    console.log('useMemo: Checking for latest unseen preview, seenToolCallIds size:', seenToolCallIds.size)
    const preview = getLatestUnseenPreview(messages, isToolCallSeen)
    console.log('useMemo: Found preview:', !!preview, preview?.latestPreview?.toolCallId)
    return preview
  }, [messages, isToolCallSeen, seenToolCallIds])

  // Debounced invalidation of older previews when a new one is detected
  // Add a 5-second delay to give users time to see and interact with the button
  useEffect(() => {
    // Clear existing timer
    if (invalidationTimerRef.current) {
      clearTimeout(invalidationTimerRef.current)
      invalidationTimerRef.current = null
    }

    if (latestPreview && latestPreview.olderPreviewIds && latestPreview.olderPreviewIds.length > 0) {
      // Check if this is actually a new preview (different from the last one)
      const currentToolCallId = latestPreview.latestPreview?.toolCallId
      const isNewPreview = currentToolCallId !== lastToolCallIdRef.current
      
      if (isNewPreview && currentToolCallId) {
        console.log('New preview detected, scheduling invalidation of older previews in 5 seconds:', latestPreview.olderPreviewIds)
        lastToolCallIdRef.current = currentToolCallId
        
        // Set a timer to invalidate older previews after 5 seconds
        invalidationTimerRef.current = setTimeout(() => {
          console.log('Invalidating older previews after delay:', latestPreview.olderPreviewIds)
          latestPreview.olderPreviewIds.forEach(id => {
            markToolCallAsSeen(id)
          })
          invalidationTimerRef.current = null
        }, 5000) // 5 second delay
      }
    }

    // Cleanup function
    return () => {
      if (invalidationTimerRef.current) {
        clearTimeout(invalidationTimerRef.current)
        invalidationTimerRef.current = null
      }
    }
  }, [latestPreview?.latestPreview?.toolCallId, latestPreview?.olderPreviewIds, markToolCallAsSeen])

  // Debug logging
  console.log('ReviewButton render:', {
    hasLatestPreview: !!latestPreview?.latestPreview,
    activeWorkflowId,
    messageCount: messages.length
  })

  // Only show if there's a real preview from copilot
  if (!latestPreview?.latestPreview) {
    return null
  }

  const handleShowPreview = () => {
    setShowModal(true)
  }

  const handleApply = async () => {
    if (!latestPreview?.latestPreview) return
    
    try {
      setIsProcessing(true)

      logger.info('Applying preview to current workflow (store-first)', {
        workflowId: activeWorkflowId,
        yamlLength: latestPreview.latestPreview.yamlContent.length,
      })

      // STEP 1: Parse YAML and update local store immediately
      try {
        // Import the necessary modules
        const { parseWorkflowYaml, convertYamlToWorkflow } = await import('@/stores/workflows/yaml/importer')
        const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
        const { getBlock } = await import('@/blocks')
        const { generateLoopBlocks, generateParallelBlocks } = await import('@/stores/workflows/workflow/utils')

        // Parse YAML content
        const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(latestPreview.latestPreview.yamlContent)

        if (!yamlWorkflow || parseErrors.length > 0) {
          throw new Error(`Failed to parse YAML: ${parseErrors.join(', ')}`)
        }

        // Convert YAML to workflow format  
        const { blocks, edges, errors: convertErrors } = convertYamlToWorkflow(yamlWorkflow)

        if (convertErrors.length > 0) {
          throw new Error(`Failed to convert YAML: ${convertErrors.join(', ')}`)
        }

        // Convert ImportedBlocks to workflow store format
        const workflowBlocks: Record<string, any> = {}
        const workflowEdges: any[] = []
        
        // Process blocks - convert from array to record format
        for (const block of blocks) {
          const blockId = block.id
          const blockConfig = getBlock(block.type)
          
          if (!blockConfig && (block.type === 'loop' || block.type === 'parallel')) {
            // Handle loop/parallel blocks
            workflowBlocks[blockId] = {
              id: blockId,
              type: block.type,
              name: block.name,
              position: block.position,
              subBlocks: {},
              outputs: {},
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: (block as any).data || {},
            }
          } else if (blockConfig) {
            // Handle regular blocks with proper subBlocks setup
            const subBlocks: Record<string, any> = {}
            
            // Set up subBlocks from block configuration
            blockConfig.subBlocks.forEach((subBlock) => {
              subBlocks[subBlock.id] = {
                id: subBlock.id,
                type: subBlock.type,
                value: (block as any).inputs?.[subBlock.id] || null,
              }
            })
            
            workflowBlocks[blockId] = {
              id: blockId,
              type: block.type,
              name: block.name,
              position: block.position,
              subBlocks,
              outputs: (block as any).outputs || {},
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: (block as any).data || {},
            }
          }
        }
        
        // Process edges
        for (const edge of edges) {
          workflowEdges.push({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            type: edge.type || 'default',
          })
        }

        // Generate loops and parallels
        const loops = generateLoopBlocks(workflowBlocks)
        const parallels = generateParallelBlocks(workflowBlocks)

        // Apply auto layout using the shared utility
        const { applyAutoLayoutToBlocks } = await import('../utils/auto-layout')
        const layoutResult = await applyAutoLayoutToBlocks(workflowBlocks, workflowEdges)
        
        const layoutedBlocks = layoutResult.success ? layoutResult.layoutedBlocks! : workflowBlocks
        
        if (layoutResult.success) {
          logger.info('Successfully applied auto layout to preview blocks')
        } else {
          logger.warn('Auto layout failed, using original positions:', layoutResult.error)
        }

        // Update workflow store immediately
        const workflowStore = useWorkflowStore.getState()
        const newWorkflowState = {
          blocks: layoutedBlocks,
          edges: workflowEdges,
          loops,
          parallels,
          lastSaved: Date.now(),
          isDeployed: workflowStore.isDeployed,
          deployedAt: workflowStore.deployedAt,
          deploymentStatuses: workflowStore.deploymentStatuses,
          hasActiveWebhook: workflowStore.hasActiveWebhook,
        }

        useWorkflowStore.setState(newWorkflowState)

        // Extract and update subblock values
        const subblockValues: Record<string, Record<string, any>> = {}
        Object.entries(layoutedBlocks).forEach(([blockId, block]) => {
          subblockValues[blockId] = {}
          Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
            subblockValues[blockId][subblockId] = (subblock as any).value
          })
        })

        // Update subblock store
        if (activeWorkflowId) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: subblockValues,
            },
          }))
        }

        logger.info('Successfully updated local stores with preview changes')

      } catch (storeError) {
        logger.error('Failed to update local stores:', storeError)
        throw new Error(`Store update failed: ${storeError instanceof Error ? storeError.message : 'Unknown error'}`)
      }

      // STEP 2: Save to database (in background, don't await to keep UI responsive)
      const saveToDatabase = async () => {
        try {
          const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              yamlContent: latestPreview.latestPreview.yamlContent,
              description: latestPreview.latestPreview.description || 'Applied copilot proposal',
              source: 'copilot',
              applyAutoLayout: true,
              createCheckpoint: true,
            }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.message || `Failed to apply workflow: ${response.statusText}`)
          }

          const result = await response.json()
          
          if (!result.success) {
            throw new Error(result.message || 'Failed to apply workflow changes')
          }

          logger.info('Successfully saved preview to database')
        } catch (dbError) {
          logger.error('Failed to save preview to database (store already updated):', dbError)
          // Don't throw - the store is already updated, so the UI is correct
          // The socket will eventually sync when the database is available
        }
      }

      // Save to database without blocking UI
      saveToDatabase()

      // STEP 3: Only dismiss preview after successful store update (user has accepted)
      console.log('Marking tool call as seen:', latestPreview.latestPreview.toolCallId)
      markToolCallAsSeen(latestPreview.latestPreview.toolCallId)
      console.log('Tool call marked as seen, closing modal')
      setShowModal(false)
      
      // Continue the copilot conversation with acceptance message
      await sendImplicitFeedback('The user has accepted and applied the workflow changes. Please continue.')
    } catch (error) {
      logger.error('Failed to apply preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSaveAsNew = async (name: string) => {
    if (!latestPreview.latestPreview.yamlContent) {
      logger.error('No YAML content to save')
      return
    }

    try {
      setIsProcessing(true)

      logger.info('Creating new workflow from preview', {
        name,
        yamlLength: latestPreview.latestPreview.yamlContent.length,
      })

      // First create a new workflow
      const newWorkflowId = await createWorkflow({
        name,
        description: latestPreview.latestPreview.description,
        workspaceId,
      })

      if (!newWorkflowId) {
        throw new Error('Failed to create new workflow')
      }

      // Then apply the YAML content to the new workflow
      const response = await fetch(`/api/workflows/${newWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: latestPreview.latestPreview.yamlContent,
          description: latestPreview.latestPreview.description || 'Created from copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to save workflow: ${response.statusText}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to save workflow')
      }

      logger.info('Successfully created new workflow from preview')
      markToolCallAsSeen(latestPreview.latestPreview.toolCallId)
      setShowModal(false)
      
      // Continue the copilot conversation with save as new message
      await sendImplicitFeedback(`The user has saved the workflow changes as a new workflow named "${name}". Please continue.`)
    } catch (error) {
      logger.error('Failed to save preview as new workflow:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!latestPreview?.latestPreview) return
    
    try {
      setIsProcessing(true)
      markToolCallAsSeen(latestPreview.latestPreview.toolCallId)
      setShowModal(false)
      
      // Continue the copilot conversation with rejection message
      await sendImplicitFeedback('The user has rejected the workflow changes. Please continue.')
    } catch (error) {
      logger.error('Failed to reject preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    setShowModal(false)
  }

  return (
    <>
      {/* Simple button at bottom center */}
      <div className='fixed bottom-20 left-1/2 z-30 -translate-x-1/2'>
        <div className='rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
                <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
              </div>
              <span className='font-medium text-sm'>Copilot has proposed changes</span>
            </div>
            <Button
              variant='default'
              size='sm'
              onClick={handleShowPreview}
              className='h-8 bg-purple-600 px-3 hover:bg-purple-700'
            >
              <FileText className='mr-1 h-3 w-3' />
              Review Changes
            </Button>
          </div>
        </div>
      </div>

      {/* Sandbox Modal */}
      {showModal && latestPreview?.latestPreview && (
        <CopilotSandboxModal
          isOpen={showModal}
          onClose={handleClose}
          proposedWorkflowState={latestPreview.latestPreview.workflowState}
          yamlContent={latestPreview.latestPreview.yamlContent}
          description={latestPreview.latestPreview.description}
          onApplyToCurrentWorkflow={handleApply}
          onSaveAsNewWorkflow={handleSaveAsNew}
          onReject={handleReject}
          isProcessing={isProcessing}
        />
      )}
    </>
  )
} 