'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Eye, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopilotSandboxModal } from './copilot-sandbox-modal/copilot-sandbox-modal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useCopilotStore } from '@/stores/copilot/store'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ReviewButton')

// Helper function to extract preview data from messages
function getLatestUnseenPreview(messages: any[], isToolCallSeen: (id: string) => boolean) {
  if (!messages.length) return null

  // Go through messages in reverse order (newest first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.content) continue

    const previewToolCallPattern = /__TOOL_CALL_EVENT__(.*?)__TOOL_CALL_EVENT__/g
    let match

    while ((match = previewToolCallPattern.exec(message.content)) !== null) {
      try {
        const toolCallEvent = JSON.parse(match[1])
        if (
          toolCallEvent.type === 'tool_call_complete' &&
          toolCallEvent.toolCall?.name === 'preview_workflow' &&
          toolCallEvent.toolCall?.state === 'completed' &&
          toolCallEvent.toolCall?.result &&
          toolCallEvent.toolCall?.id &&
          !isToolCallSeen(toolCallEvent.toolCall.id)
        ) {
          const result = toolCallEvent.toolCall.result
          let workflowState = null
          let yamlContent = null
          let description = null

          if (result.workflowState) {
            workflowState = result.workflowState
          }

          if (toolCallEvent.toolCall?.parameters) {
            yamlContent = toolCallEvent.toolCall.parameters.yamlContent
            description = toolCallEvent.toolCall.parameters.description
          }

          if (workflowState && yamlContent) {
            return {
              toolCallId: toolCallEvent.toolCall.id,
              workflowState,
              yamlContent,
              description,
            }
          }
        }
      } catch (error) {
        console.warn('Failed to parse tool call event:', error)
      }
    }
  }

  return null
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

  // Get the latest unseen preview from messages
  const latestPreview = useMemo(() => {
    console.log('useMemo: Checking for latest unseen preview, seenToolCallIds size:', seenToolCallIds.size)
    const preview = getLatestUnseenPreview(messages, isToolCallSeen)
    console.log('useMemo: Found preview:', !!preview, preview?.toolCallId)
    return preview
  }, [messages, isToolCallSeen, seenToolCallIds])

  // Debug logging
  console.log('ReviewButton render:', {
    hasLatestPreview: !!latestPreview,
    activeWorkflowId,
    messageCount: messages.length
  })

  // Only show if there's a real preview from copilot
  if (!latestPreview) {
    return null
  }

  const handleShowPreview = () => {
    setShowModal(true)
  }

  const handleApply = async () => {
    if (!activeWorkflowId || !latestPreview.yamlContent) {
      logger.error('No active workflow or YAML content')
      return
    }

    try {
      setIsProcessing(true)

      logger.info('Applying preview to current workflow', {
        workflowId: activeWorkflowId,
        yamlLength: latestPreview.yamlContent.length,
      })

      // Use the existing YAML endpoint to apply the changes
      const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: latestPreview.yamlContent,
          description: latestPreview.description || 'Applied copilot proposal',
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

      logger.info('Successfully applied preview to workflow')
      console.log('Marking tool call as seen:', latestPreview.toolCallId)
      markToolCallAsSeen(latestPreview.toolCallId)
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
    if (!latestPreview.yamlContent) {
      logger.error('No YAML content to save')
      return
    }

    try {
      setIsProcessing(true)

      logger.info('Creating new workflow from preview', {
        name,
        yamlLength: latestPreview.yamlContent.length,
      })

      // First create a new workflow
      const newWorkflowId = await createWorkflow({
        name,
        description: latestPreview.description,
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
          yamlContent: latestPreview.yamlContent,
          description: latestPreview.description || 'Created from copilot proposal',
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
      markToolCallAsSeen(latestPreview.toolCallId)
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
    if (!latestPreview) return
    
    try {
      setIsProcessing(true)
      markToolCallAsSeen(latestPreview.toolCallId)
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
      <div className='fixed bottom-6 left-1/2 z-30 -translate-x-1/2'>
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
      {showModal && latestPreview && (
        <CopilotSandboxModal
          isOpen={showModal}
          onClose={handleClose}
          proposedWorkflowState={latestPreview.workflowState}
          yamlContent={latestPreview.yamlContent}
          description={latestPreview.description}
          onApplyToCurrentWorkflow={handleApply}
          onSaveAsNewWorkflow={handleSaveAsNew}
          onReject={handleReject}
          isProcessing={isProcessing}
        />
      )}
    </>
  )
} 