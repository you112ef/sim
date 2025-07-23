import type {
  InlineContent,
  ParsedMessageContent,
  ToolCallIndicator,
  ToolCallState,
} from '@/types/tool-call'

// Tool ID to display name mapping for better UX
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  docs_search_internal: 'Searching documentation',
  get_user_workflow: 'Analyzing your workflow',
  get_blocks_and_tools: 'Getting context',
  get_blocks_metadata: 'Diving deeper',
  get_yaml_structure: 'Structuring your workflow',
  preview_workflow: 'Preview Ready',
  // edit_workflow: 'Building your workflow', // Commented out - only preview is allowed
}

// Past tense versions for completed tool calls
const TOOL_PAST_TENSE_NAMES: Record<string, string> = {
  docs_search_internal: 'Searched documentation',
  get_user_workflow: 'Analyzed your workflow',
  get_blocks_and_tools: 'Got context',
  get_blocks_metadata: 'Dove deeper',
  get_yaml_structure: 'Structured your workflow',
  preview_workflow: 'Built Workflow',
  // edit_workflow: 'Built your workflow', // Commented out - only preview is allowed
}

// Tool grouping for "Designing an Approach"
const DESIGN_APPROACH_TOOLS = new Set([
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_yaml_structure'
])

// Regex patterns to detect structured tool call events
const TOOL_CALL_PATTERNS = {
  // Matches structured tool call events: __TOOL_CALL_EVENT__{"type":"..."}__TOOL_CALL_EVENT__
  toolCallEvent: /__TOOL_CALL_EVENT__(.*?)__TOOL_CALL_EVENT__/g,
  // Fallback patterns for legacy emoji indicators (if needed)
  statusIndicator: /🔄\s+([^🔄\n]+)/gu,
  thinkingPattern: /(\.\.\.|…|💭|🤔)/g,
  functionCall: /(\w+)\s*\(\s*([^)]*)\s*\)/g,
  completionIndicator: /✅|☑️|✓|Done|Complete/g,
  errorIndicator: /❌|⚠️|Error|Failed/g,
}

/**
 * Extract tool names from a status message
 */
export function extractToolNames(statusMessage: string): string[] {
  // Remove the 🔄 indicator and split on • or bullet points
  const cleanMessage = statusMessage.replace(/🔄\s*/, '').trim()

  // Split on common separators
  const toolNames = cleanMessage
    .split(/[•·|,&]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  return toolNames
}

/**
 * Get display name for a tool
 */
export function getToolDisplayName(toolId: string, isCompleted = false): string {
  if (isCompleted) {
    return TOOL_PAST_TENSE_NAMES[toolId] || TOOL_DISPLAY_NAMES[toolId] || toolId.replace(/_/g, ' ')
  }
  return TOOL_DISPLAY_NAMES[toolId] || toolId.replace(/_/g, ' ')
}

/**
 * Check if a tool is part of the "Designing an Approach" group
 */
export function isDesignApproachTool(toolId: string): boolean {
  return DESIGN_APPROACH_TOOLS.has(toolId)
}

/**
 * Group consecutive design approach tools together
 */
export function groupDesignApproachTools(inlineContent: InlineContent[]): { 
  groupStart: number
  groupEnd: number
  groupedTools: ToolCallState[]
} | null {
  if (inlineContent.length < 2) return null
  
  // Find consecutive design approach tools in the inline content
  let groupStart = -1
  let groupEnd = -1
  const groupedTools: ToolCallState[] = []
  let consecutiveDesignTools = 0
  
  for (let i = 0; i < inlineContent.length; i++) {
    const item = inlineContent[i]
    
    if (item.type === 'tool_call' && item.toolCall && isDesignApproachTool(item.toolCall.name)) {
      if (groupStart === -1) {
        groupStart = i
      }
      groupEnd = i
      groupedTools.push(item.toolCall)
      consecutiveDesignTools++
    } else if (item.type === 'tool_call' && item.toolCall && !isDesignApproachTool(item.toolCall.name)) {
      // Found a non-design tool call - if we have at least 2 design tools, stop the group
      if (consecutiveDesignTools >= 2) {
        break
      } else {
        // Reset if we haven't found enough consecutive design tools yet
        groupStart = -1
        groupEnd = -1
        groupedTools.length = 0
        consecutiveDesignTools = 0
      }
    }
    // Note: Text content doesn't break the group, only non-design tool calls do
  }
  
  // Only group if we have at least 2 consecutive design tools
  if (groupStart !== -1 && groupEnd > groupStart && groupedTools.length >= 2) {
    // Ensure all tools in the group are either completed or in error state for stability
    const allToolsFinished = groupedTools.every(tool => 
      tool.state === 'completed' || tool.state === 'error'
    )
    
    return {
      groupStart,
      groupEnd,
      groupedTools
    }
  }
  
  return null
}

/**
 * Parse structured tool call events from the stream and maintain state transitions
 */
export function parseToolCallEvents(
  content: string,
  existingToolCalls: ToolCallState[] = []
): ToolCallState[] {
  const toolCallsMap = new Map<string, ToolCallState>()

  // Start with existing tool calls
  existingToolCalls.forEach((tc) => {
    toolCallsMap.set(tc.id, { ...tc })
  })

  const matches = content.matchAll(TOOL_CALL_PATTERNS.toolCallEvent)

  for (const match of matches) {
    try {
      const eventData = JSON.parse(match[1])

      switch (eventData.type) {
        case 'tool_call_detected':
          if (!toolCallsMap.has(eventData.toolCall.id)) {
            const toolCall = {
              ...eventData.toolCall,
              displayName: getToolDisplayName(eventData.toolCall.name), // Ensure displayName is set
              startTime: Date.now(),
            }
            toolCallsMap.set(eventData.toolCall.id, toolCall)
          }
          break

        case 'tool_calls_start':
          eventData.toolCalls.forEach((toolCall: any) => {
            if (!toolCallsMap.has(toolCall.id)) {
              const enhancedToolCall = {
                ...toolCall,
                displayName: getToolDisplayName(toolCall.name), // Ensure displayName is set
                state: 'executing' as const, // Explicitly set state for new tool calls
                startTime: Date.now(),
              }
              toolCallsMap.set(toolCall.id, enhancedToolCall)
            } else {
              // Update existing tool call to executing state
              const existing = toolCallsMap.get(toolCall.id)!
              const updatedToolCall = {
                ...existing,
                displayName: getToolDisplayName(existing.name), // Ensure displayName is set
                state: 'executing' as const,
                parameters: toolCall.parameters || existing.parameters,
              }
              toolCallsMap.set(toolCall.id, updatedToolCall)
            }
          })
          break

        case 'tool_call_complete': {
          const completedToolCall = eventData.toolCall
          if (toolCallsMap.has(completedToolCall.id)) {
            // Update existing tool call to completed state
            const existing = toolCallsMap.get(completedToolCall.id)!
            const state = completedToolCall.state === 'error' ? 'error' : 'completed'
            const updatedToolCall = {
              ...existing,
              displayName: getToolDisplayName(existing.name, true), // Use past tense for completed
              state: state as 'completed' | 'error',
              endTime: completedToolCall.endTime,
              duration: completedToolCall.duration,
              result: completedToolCall.result,
              error: completedToolCall.error,
            }
            toolCallsMap.set(completedToolCall.id, updatedToolCall)
          } else {
            // Create new completed tool call if it doesn't exist
            const state = completedToolCall.state === 'error' ? 'error' : 'completed'
            const enhancedToolCall = {
              ...completedToolCall,
              displayName: getToolDisplayName(completedToolCall.name, true), // Use past tense for completed
              state: state as 'completed' | 'error',
            }
            toolCallsMap.set(completedToolCall.id, enhancedToolCall)
          }
          break
        }
      }
    } catch (error) {
      console.warn('Failed to parse tool call event:', error)
    }
  }

  return Array.from(toolCallsMap.values())
}

/**
 * Parse a tool call status message and extract tool information (fallback for legacy)
 */
export function parseToolCallStatus(content: string): ToolCallIndicator | null {
  // First check for structured events
  const structuredEvents = parseToolCallEvents(content)
  if (structuredEvents.length > 0) {
    return {
      type: 'status',
      content: content,
      toolNames: structuredEvents.map((e) => e.displayName || e.name),
    }
  }

  // Fallback to legacy emoji parsing
  const statusMatch = content.match(TOOL_CALL_PATTERNS.statusIndicator)

  if (statusMatch) {
    const statusText = statusMatch[0]
    const toolNames = extractToolNames(statusText)

    return {
      type: 'status',
      content: statusText,
      toolNames,
    }
  }

  // Check for thinking patterns
  if (TOOL_CALL_PATTERNS.thinkingPattern.test(content)) {
    return {
      type: 'thinking',
      content: content.trim(),
    }
  }

  // Check for function call patterns
  const functionMatch = content.match(TOOL_CALL_PATTERNS.functionCall)
  if (functionMatch) {
    return {
      type: 'execution',
      content: content.trim(),
    }
  }

  return null
}

/**
 * Create a tool call state from detected information
 */
export function createToolCallState(
  name: string,
  parameters?: Record<string, any>,
  state: ToolCallState['state'] = 'detecting'
): ToolCallState {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    displayName: getToolDisplayName(name),
    parameters,
    state,
    startTime: Date.now(),
  }
}

/**
 * Parse message content and maintain inline positioning of tool calls
 */
export function parseMessageContent(
  content: string,
  existingToolCalls: ToolCallState[] = []
): ParsedMessageContent {
  // Get all tool call events with state transitions
  const toolCallEvents = parseToolCallEvents(content, existingToolCalls)
  const toolCallsMap = new Map<string, ToolCallState>()

  toolCallEvents.forEach((tc) => {
    toolCallsMap.set(tc.id, tc)
  })

  // Parse content maintaining inline positioning and deduplicating tool calls
  const inlineContent: InlineContent[] = []
  const toolCallPositions = new Map<string, number>() // Track where each tool call first appears
  let currentTextBuffer = ''

  // Split content into segments, preserving tool call markers inline
  const segments = content.split(/(__TOOL_CALL_EVENT__.*?__TOOL_CALL_EVENT__)/)

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    if (segment.match(/__TOOL_CALL_EVENT__.*?__TOOL_CALL_EVENT__/)) {
      // This is a tool call event
      try {
        const eventMatch = segment.match(/__TOOL_CALL_EVENT__(.*?)__TOOL_CALL_EVENT__/)
        if (eventMatch) {
          const eventData = JSON.parse(eventMatch[1])
          
          // Handle different event types
          switch (eventData.type) {
            case 'tool_call_detected': {
              const id = eventData.toolCall?.id
              if (id && toolCallsMap.has(id) && !toolCallPositions.has(id)) {
                // Add text buffer before tool call
                if (currentTextBuffer.trim()) {
                  inlineContent.push({
                    type: 'text',
                    content: currentTextBuffer.trim(),
                  })
                  currentTextBuffer = ''
                }

                // Add tool call
                const toolCall = toolCallsMap.get(id)!
                const newIndex = inlineContent.length
                inlineContent.push({
                  type: 'tool_call',
                  content: segment,
                  toolCall,
                })
                toolCallPositions.set(id, newIndex)
              } else if (id && toolCallsMap.has(id) && toolCallPositions.has(id)) {
                // Update existing tool call in place
                const existingIndex = toolCallPositions.get(id)!
                if (inlineContent[existingIndex]?.type === 'tool_call') {
                  inlineContent[existingIndex].toolCall = toolCallsMap.get(id)!
                }
              }
              break
            }
            
            case 'tool_calls_start': {
              // Handle each tool call in the start event
              if (eventData.toolCalls && Array.isArray(eventData.toolCalls)) {
                let hasAddedToolCalls = false
                
                eventData.toolCalls.forEach((tc: any) => {
                  const id = tc.id
                  if (id && toolCallsMap.has(id)) {
                    if (!toolCallPositions.has(id)) {
                      // First time seeing this tool call - add text buffer once
                      if (!hasAddedToolCalls && currentTextBuffer.trim()) {
                        inlineContent.push({
                          type: 'text',
                          content: currentTextBuffer.trim(),
                        })
                        currentTextBuffer = ''
                        hasAddedToolCalls = true
                      }

                      // Add each tool call
                      const toolCallFromMap = toolCallsMap.get(id)!
                      const newIndex = inlineContent.length
                      inlineContent.push({
                        type: 'tool_call',
                        content: segment,
                        toolCall: toolCallFromMap,
                      })
                      toolCallPositions.set(id, newIndex)
                    } else {
                      // Update existing tool call in place
                      const existingIndex = toolCallPositions.get(id)!
                      if (inlineContent[existingIndex]?.type === 'tool_call') {
                        inlineContent[existingIndex].toolCall = toolCallsMap.get(id)!
                      }
                    }
                  }
                })
              }
              break
            }
            
            case 'tool_call_complete': {
              const id = eventData.toolCall?.id
              if (id && toolCallsMap.has(id)) {
                if (!toolCallPositions.has(id)) {
                  // Add text buffer before tool call
                  if (currentTextBuffer.trim()) {
                    inlineContent.push({
                      type: 'text',
                      content: currentTextBuffer.trim(),
                    })
                    currentTextBuffer = ''
                  }

                  // Add tool call
                  const toolCall = toolCallsMap.get(id)!
                  const newIndex = inlineContent.length
                  inlineContent.push({
                    type: 'tool_call',
                    content: segment,
                    toolCall,
                  })
                  toolCallPositions.set(id, newIndex)
                } else {
                  // Update existing tool call in place
                  const existingIndex = toolCallPositions.get(id)!
                  if (inlineContent[existingIndex]?.type === 'tool_call') {
                    inlineContent[existingIndex].toolCall = toolCallsMap.get(id)!
                  }
                }
              }
              break
            }
          }
        }
      } catch (error) {
        console.warn('Failed to parse tool call event:', error)
        // If parsing fails, treat as text
        currentTextBuffer += segment
      }
    } else {
      // Regular text content
      currentTextBuffer += segment
    }
  }

  // Add any remaining text
  if (currentTextBuffer.trim()) {
    inlineContent.push({
      type: 'text',
      content: currentTextBuffer.trim(),
    })
  }

  // FALLBACK: Ensure all tool calls from toolCallsMap are included in inlineContent
  // This prevents tool calls from disappearing if parsing failed to include them
  const missingToolCalls: ToolCallState[] = []
  for (const [id, toolCall] of toolCallsMap.entries()) {
    if (!toolCallPositions.has(id)) {
      missingToolCalls.push(toolCall)
      console.warn('Tool call was not included in inline content, adding as fallback:', toolCall.name, toolCall.id)
    }
  }

  // Add missing tool calls at the end
  missingToolCalls.forEach((toolCall) => {
    inlineContent.push({
      type: 'tool_call',
      content: `__TOOL_CALL_EVENT__{"type":"tool_call_complete","toolCall":${JSON.stringify(toolCall)}}__TOOL_CALL_EVENT__`,
      toolCall,
    })
  })

  // Create clean text content for fallback
  const cleanTextContent = content.replace(TOOL_CALL_PATTERNS.toolCallEvent, '').trim()

  return {
    textContent: cleanTextContent,
    toolCalls: Array.from(toolCallsMap.values()),
    toolGroups: [], // No grouping for inline display
    inlineContent,
  }
}

/**
 * Update tool call states based on new content
 */
export function updateToolCallStates(
  existingToolCalls: ToolCallState[],
  newContent: string
): ToolCallState[] {
  const updatedToolCalls = [...existingToolCalls]

  // Look for completion or error indicators
  if (TOOL_CALL_PATTERNS.completionIndicator.test(newContent)) {
    // Mark executing tools as completed
    updatedToolCalls.forEach((toolCall) => {
      if (toolCall.state === 'executing') {
        toolCall.state = 'completed'
        toolCall.endTime = Date.now()
        toolCall.duration = toolCall.endTime - (toolCall.startTime || 0)
      }
    })
  } else if (TOOL_CALL_PATTERNS.errorIndicator.test(newContent)) {
    // Mark executing tools as error
    updatedToolCalls.forEach((toolCall) => {
      if (toolCall.state === 'executing') {
        toolCall.state = 'error'
        toolCall.endTime = Date.now()
        toolCall.duration = toolCall.endTime - (toolCall.startTime || 0)
        toolCall.error = 'Tool execution failed'
      }
    })
  }

  return updatedToolCalls
}

/**
 * Check if content contains tool call indicators
 */
export function hasToolCallIndicators(content: string): boolean {
  return (
    TOOL_CALL_PATTERNS.toolCallEvent.test(content) ||
    TOOL_CALL_PATTERNS.statusIndicator.test(content) ||
    TOOL_CALL_PATTERNS.functionCall.test(content) ||
    TOOL_CALL_PATTERNS.thinkingPattern.test(content)
  )
}

/**
 * Remove tool call indicators from content, leaving only text
 */
export function stripToolCallIndicators(content: string): string {
  return content
    .replace(TOOL_CALL_PATTERNS.toolCallEvent, '')
    .replace(TOOL_CALL_PATTERNS.statusIndicator, '')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}

/**
 * Parse streaming content incrementally
 */
export function parseStreamingContent(
  accumulatedContent: string,
  newChunk: string,
  existingToolCalls: ToolCallState[] = []
): {
  parsedContent: ParsedMessageContent
  updatedToolCalls: ToolCallState[]
} {
  const fullContent = accumulatedContent + newChunk
  const parsedContent = parseMessageContent(fullContent, existingToolCalls)

  // The parseMessageContent now handles state transitions, so we use its tool calls
  const updatedToolCalls = parsedContent.toolCalls

  return {
    parsedContent,
    updatedToolCalls,
  }
}
