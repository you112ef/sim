import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type CopilotChat,
  type CopilotMessage,
  createChat,
  deleteChat as deleteApiChat,
  getChat,
  listChats,
  listCheckpoints,
  revertToCheckpoint,
  sendStreamingDocsMessage,
  sendStreamingMessage,
  updateChatMessages,
} from '@/lib/copilot/api'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotStore } from './types'

const logger = createLogger('CopilotStore')

/**
 * Initial state for the copilot store
 */
const initialState = {
  mode: 'ask' as const,
  currentChat: null,
  chats: [],
  messages: [],
  checkpoints: [],
  isLoading: false,
  isLoadingChats: false,
  isLoadingCheckpoints: false,
  isSendingMessage: false,
  isSaving: false,
  isRevertingCheckpoint: false,
  error: null,
  saveError: null,
  checkpointError: null,
  workflowId: null,
}

/**
 * Helper function to create a new user message
 */
function createUserMessage(content: string): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to create a streaming placeholder message
 */
function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to create an error message
 */
function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to handle errors in async operations
 */
function handleStoreError(error: unknown, fallbackMessage: string): string {
  const errorMessage = error instanceof Error ? error.message : fallbackMessage
  logger.error(fallbackMessage, error)
  return errorMessage
}

/**
 * Helper function to get a display name for a tool
 */
function getToolDisplayName(toolName: string): string {
  switch (toolName) {
    case 'docs_search_internal':
      return 'Searching documentation'
    case 'get_user_workflow':
      return 'Analyzing your workflow'
    case 'preview_workflow':
      return 'Preview workflow changes'
    case 'get_blocks_and_tools':
      return 'Getting block information'
    case 'get_blocks_metadata':
      return 'Getting block metadata'
    case 'get_yaml_structure':
      return 'Analyzing workflow structure'
    case 'edit_workflow':
      return 'Editing your workflow'
    default:
      return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }
}

/**
 * Copilot store using the new unified API
 */
export const useCopilotStore = create<CopilotStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Set chat mode
      setMode: (mode) => {
        const previousMode = get().mode
        set({ mode })
        logger.info(`Copilot mode changed from ${previousMode} to ${mode}`)
      },

      // Set current workflow ID
      setWorkflowId: (workflowId: string | null) => {
        const currentWorkflowId = get().workflowId
        if (currentWorkflowId !== workflowId) {
          logger.info(`Workflow ID changed from ${currentWorkflowId} to ${workflowId}`)

          // Clear all state to prevent cross-workflow data leaks
          set({
            workflowId,
            currentChat: null,
            chats: [],
            messages: [],
            error: null,
            saveError: null,
            isSaving: false,
            isLoading: false,
            isLoadingChats: false,
          })

          // Load chats for the new workflow
          if (workflowId) {
            get()
              .loadChats()
              .catch((error) => {
                logger.error('Failed to load chats after workflow change:', error)
              })
          }
        }
      },

      // Validate current chat belongs to current workflow
      validateCurrentChat: () => {
        const { currentChat, chats, workflowId } = get()

        if (!currentChat || !workflowId) {
          return true
        }

        // Check if current chat exists in the current workflow's chat list
        const chatBelongsToWorkflow = chats.some((chat) => chat.id === currentChat.id)

        if (!chatBelongsToWorkflow) {
          logger.warn(`Current chat ${currentChat.id} does not belong to workflow ${workflowId}`)
          set({
            currentChat: null,
            messages: [],
          })
          return false
        }

        return true
      },

      // Load chats for current workflow
      loadChats: async () => {
        const { workflowId } = get()
        if (!workflowId) {
          logger.warn('Cannot load chats: no workflow ID set')
          return
        }

        set({ isLoadingChats: true, error: null })

        try {
          const result = await listChats(workflowId)

          if (result.success) {
            set({
              chats: result.chats,
              isLoadingChats: false,
            })
            logger.info(`Loaded ${result.chats.length} chats for workflow ${workflowId}`)

            // Auto-select the most recent chat if no current chat is selected and chats exist
            const { currentChat } = get()
            if (!currentChat && result.chats.length > 0) {
              // Sort by updatedAt descending to get the most recent chat
              const sortedChats = [...result.chats].sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              )
              const mostRecentChat = sortedChats[0]

              logger.info(`Auto-selecting most recent chat: ${mostRecentChat.title || 'Untitled'}`)
              await get().selectChat(mostRecentChat)
            }
          } else {
            throw new Error(result.error || 'Failed to load chats')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to load chats'),
            isLoadingChats: false,
          })
        }
      },

      // Select a specific chat
      selectChat: async (chat: CopilotChat) => {
        const { workflowId } = get()

        if (!workflowId) {
          logger.error('Cannot select chat: no workflow ID set')
          return
        }

        set({ isLoading: true, error: null })

        try {
          const result = await getChat(chat.id)

          if (result.success && result.chat) {
            // Verify workflow hasn't changed during selection
            const currentWorkflow = get().workflowId
            if (currentWorkflow !== workflowId) {
              logger.warn('Workflow changed during chat selection')
              set({ isLoading: false })
              return
            }

            set({
              currentChat: result.chat,
              messages: result.chat.messages,
              isLoading: false,
            })

            logger.info(`Selected chat: ${result.chat.title || 'Untitled'}`)
          } else {
            throw new Error(result.error || 'Failed to load chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to load chat'),
            isLoading: false,
          })
        }
      },

      // Create a new chat
      createNewChat: async (options = {}) => {
        const { workflowId } = get()
        if (!workflowId) {
          logger.warn('Cannot create chat: no workflow ID set')
          return
        }

        set({ isLoading: true, error: null })

        try {
          const result = await createChat(workflowId, options)

          if (result.success && result.chat) {
            set({
              currentChat: result.chat,
              messages: result.chat.messages,
              isLoading: false,
            })

            // Add the new chat to the chats list
            set((state) => ({
              chats: [result.chat!, ...state.chats],
            }))

            logger.info(`Created new chat: ${result.chat.id}`)
          } else {
            throw new Error(result.error || 'Failed to create chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to create chat'),
            isLoading: false,
          })
        }
      },

      // Delete a chat
      deleteChat: async (chatId: string) => {
        try {
          const result = await deleteApiChat(chatId)

          if (result.success) {
            const { currentChat } = get()

            // Remove from chats list
            set((state) => ({
              chats: state.chats.filter((chat) => chat.id !== chatId),
            }))

            // If this was the current chat, clear it and select another one
            if (currentChat?.id === chatId) {
              // Get the updated chats list (after removal) in a single atomic operation
              const { chats: updatedChats } = get()
              const remainingChats = updatedChats.filter((chat) => chat.id !== chatId)

              if (remainingChats.length > 0) {
                const sortedByCreation = [...remainingChats].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )
                set({
                  currentChat: null,
                  messages: [],
                })
                await get().selectChat(sortedByCreation[0])
              } else {
                set({
                  currentChat: null,
                  messages: [],
                })
              }
            }

            logger.info(`Deleted chat: ${chatId}`)
          } else {
            throw new Error(result.error || 'Failed to delete chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to delete chat'),
          })
        }
      },

      // Send a regular message
      sendMessage: async (message: string, options = {}) => {
        const { workflowId, currentChat, mode } = get()
        const { stream = true } = options

        if (!workflowId) {
          logger.warn('Cannot send message: no workflow ID set')
          return
        }

        set({ isSendingMessage: true, error: null })

        const userMessage = createUserMessage(message)
        const streamingMessage = createStreamingMessage()

        set((state) => ({
          messages: [...state.messages, userMessage, streamingMessage],
        }))

        try {
          const result = await sendStreamingMessage({
            message,
            chatId: currentChat?.id,
            workflowId,
            mode,
            createNewChat: !currentChat,
            stream,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
          } else {
            throw new Error(result.error || 'Failed to send message')
          }
        } catch (error) {
          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while processing your message. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send message'),
            isSendingMessage: false,
          }))
        }
      },

      // Send implicit feedback to continue conversation without showing user message
      sendImplicitFeedback: async (implicitFeedback: string) => {
        const { workflowId, currentChat, mode, messages } = get()

        if (!workflowId) {
          logger.warn('Cannot send implicit feedback: no workflow ID set')
          return
        }

        set({ isSendingMessage: true, error: null })

        // Find the last assistant message (the one that was cut off by preview tool)
        let lastAssistantMessage = null
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            lastAssistantMessage = messages[i]
            break
          }
        }

        if (!lastAssistantMessage) {
          logger.warn('No previous assistant message found to continue')
          return
        }

        try {
          const result = await sendStreamingMessage({
            message: 'Please continue your response.', // Simple continuation prompt
            chatId: currentChat?.id,
            workflowId,
            mode,
            createNewChat: !currentChat,
            stream: true,
            implicitFeedback, // Pass the implicit feedback
          })

          if (result.success && result.stream) {
            // Continue streaming to the existing assistant message
            await get().handleStreamingResponse(result.stream, lastAssistantMessage.id, true)
          } else {
            throw new Error(result.error || 'Failed to send implicit feedback')
          }
        } catch (error) {
          const errorMessage = createErrorMessage(
            lastAssistantMessage?.id || crypto.randomUUID(),
            'Sorry, I encountered an error while processing your feedback. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastAssistantMessage?.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send implicit feedback'),
            isSendingMessage: false,
          }))
        }
      },

      // Send a docs RAG message
      sendDocsMessage: async (query: string, options = {}) => {
        const { workflowId, currentChat } = get()
        const { stream = true, topK = 10 } = options

        if (!workflowId) {
          logger.warn('Cannot send docs message: no workflow ID set')
          return
        }

        set({ isSendingMessage: true, error: null })

        const userMessage = createUserMessage(query)
        const streamingMessage = createStreamingMessage()

        set((state) => ({
          messages: [...state.messages, userMessage, streamingMessage],
        }))

        try {
          const result = await sendStreamingDocsMessage({
            query,
            topK,
            chatId: currentChat?.id,
            workflowId,
            createNewChat: !currentChat,
            stream,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
          } else {
            throw new Error(result.error || 'Failed to send docs message')
          }
        } catch (error) {
          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while searching the documentation. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send docs message'),
            isSendingMessage: false,
          }))
        }
      },

      // Handle streaming response
      handleStreamingResponse: async (stream: ReadableStream, messageId: string, isContinuation = false) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        
        // If this is a continuation, start with the existing message content
        let accumulatedContent = ''
        if (isContinuation) {
          const { messages } = get()
          const existingMessage = messages.find(msg => msg.id === messageId)
          accumulatedContent = existingMessage?.content || ''
        }
        
        let newChatId: string | undefined
        let streamComplete = false

        // Track tool calls for native Anthropic events
        let currentBlockType: 'text' | 'tool_use' | null = null
        let toolCallBuffer: any = null
        const toolCalls: any[] = []

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done || streamComplete) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))

                  // Handle chat ID event (our custom event)
                  if (data.type === 'chat_id') {
                    newChatId = data.chatId
                    logger.info('Received chatId from stream:', newChatId)
                    
                    // Update current chat if we don't have one
                    const { currentChat } = get()
                    if (!currentChat && newChatId) {
                      await get().handleNewChatCreation(newChatId)
                    }
                  }
                  // Handle native Anthropic SSE events
                  else if (data.type === 'message_start') {
                    logger.info('Message started')
                  } else if (data.type === 'content_block_start') {
                    currentBlockType = data.content_block?.type
                    
                    if (currentBlockType === 'tool_use') {
                      // Start buffering a tool call
                      toolCallBuffer = {
                        id: data.content_block.id,
                        name: data.content_block.name,
                        displayName: getToolDisplayName(data.content_block.name),
                        input: {},
                        partialInput: '',
                        state: 'executing',
                        startTime: Date.now(),
                      }
                      toolCalls.push(toolCallBuffer)
                      logger.info(`Starting tool call: ${data.content_block.name}`)
                      
                      // Update message with tool calls array
                      set((state) => ({
                        messages: state.messages.map((msg) =>
                          msg.id === messageId ? { ...msg, content: accumulatedContent, toolCalls: [...toolCalls] } : msg
                        ),
                      }))
                    }
                  } else if (data.type === 'content_block_delta') {
                    if (currentBlockType === 'text' && data.delta?.text) {
                      // Add text content normally
                      if (isContinuation && accumulatedContent && !accumulatedContent.endsWith(' ') && data.delta.text && !data.delta.text.startsWith(' ')) {
                        accumulatedContent += ' ' + data.delta.text
                      } else {
                        accumulatedContent += data.delta.text
                      }

                      // Update message in real-time
                      set((state) => ({
                        messages: state.messages.map((msg) =>
                          msg.id === messageId ? { ...msg, content: accumulatedContent, toolCalls: [...toolCalls] } : msg
                        ),
                      }))
                    } else if (currentBlockType === 'tool_use' && data.delta?.partial_json && toolCallBuffer) {
                      // Buffer partial JSON for tool calls (silently)
                      toolCallBuffer.partialInput += data.delta.partial_json
                    }
                  } else if (data.type === 'content_block_stop') {
                    if (currentBlockType === 'tool_use' && toolCallBuffer) {
                      try {
                        // Parse complete tool call input
                        toolCallBuffer.input = JSON.parse(toolCallBuffer.partialInput || '{}')
                        toolCallBuffer.state = 'completed'
                        toolCallBuffer.endTime = Date.now()
                        toolCallBuffer.duration = toolCallBuffer.endTime - toolCallBuffer.startTime
                        logger.info(`Tool call completed: ${toolCallBuffer.name}`, toolCallBuffer.input)
                        
                        // Update message with completed tool call
                        set((state) => ({
                          messages: state.messages.map((msg) =>
                            msg.id === messageId ? { ...msg, content: accumulatedContent, toolCalls: [...toolCalls] } : msg
                          ),
                        }))
                      } catch (error) {
                        logger.error('Error parsing tool call input:', error)
                        toolCallBuffer.state = 'error'
                        toolCallBuffer.endTime = Date.now()
                        toolCallBuffer.duration = toolCallBuffer.endTime - toolCallBuffer.startTime
                      }
                      toolCallBuffer = null
                    }
                    currentBlockType = null
                  } else if (data.type === 'message_delta') {
                    // Handle token usage updates silently
                    if (data.delta?.stop_reason === 'tool_use') {
                      logger.info('Message stopped for tool use - backend will handle execution')
                    }
                  } else if (data.type === 'message_stop') {
                    // Don't complete yet - let the backend continue if there are tools
                    logger.info('Message stop received - checking if final')
                  } else if (data.type === 'error') {
                    // Handle error events from backend
                    logger.error('Backend error:', data.error)
                    streamComplete = true
                    break
                  }
                } catch (parseError) {
                  logger.warn('Failed to parse SSE data:', parseError)
                }
              }
            }
          }

          // Stream ended naturally - finalize the message
          logger.info(`Completed streaming response, content length: ${accumulatedContent.length}`)
          
          // Final update when stream actually ends
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content: accumulatedContent, toolCalls: [...toolCalls] } : msg
            ),
            isSendingMessage: false,
          }))

          // Auto-save messages after streaming completes
          const { currentChat } = get()
          const chatIdToSave = currentChat?.id || newChatId
          
          if (chatIdToSave) {
            try {
              logger.info('Auto-saving chat messages after streaming completion to chat:', chatIdToSave)
              await get().saveChatMessages(chatIdToSave)
            } catch (error) {
              logger.error('Failed to auto-save chat messages:', error)
            }
          } else {
            logger.warn('No chat ID available for auto-saving messages')
          }
        } catch (error) {
          logger.error('Error handling streaming response:', error)
          throw error
        }
      },

      // Handle new chat creation after streaming
      handleNewChatCreation: async (newChatId: string) => {
        try {
          const chatResult = await getChat(newChatId)
          if (chatResult.success && chatResult.chat) {
            // Set the new chat as current
            set({
              currentChat: chatResult.chat,
            })

            // Add to chats list if not already there (atomic check and update)
            set((state) => {
              const chatExists = state.chats.some((chat) => chat.id === newChatId)
              if (!chatExists) {
                return {
                  chats: [chatResult.chat!, ...state.chats],
                }
              }
              return state
            })
          }
        } catch (error) {
          logger.error('Failed to fetch new chat after creation:', error)
          // Fallback: reload all chats
          await get().loadChats()
        }
      },

      // Save chat messages to database
      saveChatMessages: async (chatId: string) => {
        const { messages, chats } = get()
        set({ isSaving: true, saveError: null })

        try {
          const result = await updateChatMessages(chatId, messages)

          if (result.success && result.chat) {
            const updatedChat = result.chat

            // Update local state with the saved chat
            set({
              currentChat: updatedChat,
              messages: updatedChat.messages,
              isSaving: false,
              saveError: null,
            })

            // Update the chat in the chats list (atomic check, update, or add)
            set((state) => {
              const chatExists = state.chats.some((chat) => chat.id === updatedChat!.id)

              if (!chatExists) {
                // Chat doesn't exist, add it to the beginning
                return {
                  chats: [updatedChat!, ...state.chats],
                }
              }
              // Chat exists, update it
              const updatedChats = state.chats.map((chat) =>
                chat.id === updatedChat!.id ? updatedChat! : chat
              )
              return { chats: updatedChats }
            })

            logger.info(`Successfully saved chat ${chatId}`)
          } else {
            const errorMessage = result.error || 'Failed to save chat'
            set({
              isSaving: false,
              saveError: errorMessage,
            })
            throw new Error(errorMessage)
          }
        } catch (error) {
          const errorMessage = handleStoreError(error, 'Error saving chat')
          set({
            isSaving: false,
            saveError: errorMessage,
          })
          throw error
        }
      },

      // Load checkpoints for current chat
      loadCheckpoints: async (chatId: string) => {
        set({ isLoadingCheckpoints: true, checkpointError: null })

        try {
          const result = await listCheckpoints(chatId)

          if (result.success) {
            set({
              checkpoints: result.checkpoints,
              isLoadingCheckpoints: false,
            })
            logger.info(`Loaded ${result.checkpoints.length} checkpoints for chat ${chatId}`)
          } else {
            throw new Error(result.error || 'Failed to load checkpoints')
          }
        } catch (error) {
          set({
            checkpointError: handleStoreError(error, 'Failed to load checkpoints'),
            isLoadingCheckpoints: false,
          })
        }
      },

      // Revert to a specific checkpoint
      revertToCheckpoint: async (checkpointId: string) => {
        set({ isRevertingCheckpoint: true, checkpointError: null })

        try {
          const result = await revertToCheckpoint(checkpointId)

          if (result.success) {
            set({ isRevertingCheckpoint: false })
            logger.info(`Successfully reverted to checkpoint ${checkpointId}`)
          } else {
            throw new Error(result.error || 'Failed to revert to checkpoint')
          }
        } catch (error) {
          set({
            checkpointError: handleStoreError(error, 'Failed to revert to checkpoint'),
            isRevertingCheckpoint: false,
          })
        }
      },

      // Clear current messages
      clearMessages: () => {
        set({
          currentChat: null,
          messages: [],
          error: null,
        })
        logger.info('Cleared current chat and messages')
      },

      // Clear error state
      clearError: () => {
        set({ error: null })
      },

      // Clear save error state
      clearSaveError: () => {
        set({ saveError: null })
      },

      // Clear checkpoint error state
      clearCheckpointError: () => {
        set({ checkpointError: null })
      },

      // Retry saving chat messages
      retrySave: async (chatId: string) => {
        await get().saveChatMessages(chatId)
      },

      // Reset entire store
      reset: () => {
        set(initialState)
      },
    }),
    { name: 'copilot-store' }
  )
)
