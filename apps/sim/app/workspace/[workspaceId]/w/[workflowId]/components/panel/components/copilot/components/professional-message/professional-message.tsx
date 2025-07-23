'use client'

import { type FC, memo, useMemo, useEffect, useState } from 'react'
import { Bot, Copy, User, ChevronDown, ChevronRight, CheckCircle, Settings, XCircle, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { parseMessageContent, stripToolCallIndicators, groupDesignApproachTools, isDesignApproachTool } from '@/lib/tool-call-parser'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/stores/copilot/types'
import type { ToolCallState } from '@/types/tool-call'
import { setLatestPreview } from '../../../../../review-button'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

// Design Approach Group Component
function DesignApproachGroup({ tools, isCompleted }: { tools: ToolCallState[], isCompleted: boolean }) {
  const [isExpanded, setIsExpanded] = useState(true)
  
  const activeToolIndex = tools.findIndex(tool => tool.state === 'executing')
  const completedCount = tools.filter(tool => tool.state === 'completed').length
  const hasError = tools.some(tool => tool.state === 'error')
  
  const getGroupStatus = () => {
    if (hasError) return 'error'
    if (completedCount === tools.length) return 'completed' // All tools completed
    if (activeToolIndex >= 0) return 'executing'
    return 'pending'
  }
  
  const status = getGroupStatus()
  
  // Stable group title - always show as designed when all tools are done
  const getGroupTitle = () => {
    if (status === 'completed') return 'Designed an Approach'
    if (status === 'executing') return 'Designing an Approach'
    if (status === 'error') return 'Approach Design Failed'
    return 'Designing an Approach'
  }
  
  const getGroupSubtitle = () => {
    if (status === 'executing' && activeToolIndex >= 0) {
      return `Step ${activeToolIndex + 1} of ${tools.length} • ${tools[activeToolIndex].displayName || tools[activeToolIndex].name}`
    }
    if (status === 'completed') {
      return 'Approach designed successfully'
    }
    if (status === 'error') {
      return 'Error in approach design'
    }
    return `${completedCount}/${tools.length} steps completed`
  }
  
  return (
    <div className={cn(
      'my-3 rounded-xl border-2 transition-all duration-300',
      status === 'executing' && 'border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 dark:border-blue-800 dark:from-blue-950/50 dark:to-indigo-950/50',
      status === 'completed' && 'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 dark:border-green-800 dark:from-green-950/50 dark:to-emerald-950/50',
      status === 'error' && 'border-red-200 bg-gradient-to-r from-red-50 to-pink-50 dark:border-red-800 dark:from-red-950/50 dark:to-pink-950/50',
      status === 'pending' && 'border-gray-200 bg-gradient-to-r from-gray-50 to-slate-50 dark:border-gray-700 dark:from-gray-900/50 dark:to-slate-900/50'
    )}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-4 text-left hover:bg-transparent"
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full',
                status === 'executing' && 'bg-blue-100 dark:bg-blue-900',
                status === 'completed' && 'bg-green-100 dark:bg-green-900',
                status === 'error' && 'bg-red-100 dark:bg-red-900',
                status === 'pending' && 'bg-gray-100 dark:bg-gray-800'
              )}>
                {status === 'executing' && <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />}
                {status === 'completed' && <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />}
                {status === 'error' && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
                {status === 'pending' && <Settings className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
              </div>
              <div>
                <div className={cn(
                  'font-semibold text-sm',
                  status === 'executing' && 'text-blue-900 dark:text-blue-100',
                  status === 'completed' && 'text-green-900 dark:text-green-100',
                  status === 'error' && 'text-red-900 dark:text-red-100',
                  status === 'pending' && 'text-gray-900 dark:text-gray-100'
                )}>
                  {getGroupTitle()}
                </div>
                <div className={cn(
                  'text-xs',
                  status === 'executing' && 'text-blue-700 dark:text-blue-300',
                  status === 'completed' && 'text-green-700 dark:text-green-300',
                  status === 'error' && 'text-red-700 dark:text-red-300',
                  status === 'pending' && 'text-gray-700 dark:text-gray-300'
                )}>
                  {getGroupSubtitle()}
                </div>
              </div>
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <div className="space-y-2">
            {tools.map((tool, index) => (
              <InlineToolCall key={tool.id} tool={tool} stepNumber={index + 1} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// Inline Tool Call Component
function InlineToolCall({ tool, stepNumber }: { tool: ToolCallState, stepNumber?: number }) {
  const getStateIcon = () => {
    switch (tool.state) {
      case 'executing':
        return <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" />
      case 'completed':
        return <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
      case 'error':
        return <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
      default:
        return <div className="h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600" />
    }
  }
  
  const getStateColors = () => {
    switch (tool.state) {
      case 'executing':
        return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100'
      case 'completed':
        return 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100'
      case 'error':
        return 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
      default:
        return 'border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
    }
  }

  const formatDuration = (duration?: number) => {
    if (!duration) return ''
    return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`
  }

  // Special handling for preview workflow
  const isPreviewTool = tool.name === 'preview_workflow'
  
  if (isPreviewTool) {
    return (
      <div className={cn(
        'rounded-xl border-2 p-4 transition-all duration-300',
        tool.state === 'executing' && 'border-purple-200 bg-gradient-to-r from-purple-50 to-violet-50 dark:border-purple-800 dark:from-purple-950/50 dark:to-violet-950/50',
        tool.state === 'completed' && 'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 dark:border-green-800 dark:from-green-950/50 dark:to-emerald-950/50',
        tool.state === 'error' && 'border-red-200 bg-gradient-to-r from-red-50 to-pink-50 dark:border-red-800 dark:from-red-950/50 dark:to-pink-950/50'
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full',
            tool.state === 'executing' && 'bg-purple-100 dark:bg-purple-900',
            tool.state === 'completed' && 'bg-green-100 dark:bg-green-900',
            tool.state === 'error' && 'bg-red-100 dark:bg-red-900'
          )}>
            {tool.state === 'executing' && <Loader2 className="h-4 w-4 animate-spin text-purple-600 dark:text-purple-400" />}
            {tool.state === 'completed' && <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />}
            {tool.state === 'error' && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
          </div>
          <div>
            <div className={cn(
              'font-semibold text-sm',
              tool.state === 'executing' && 'text-purple-900 dark:text-purple-100',
              tool.state === 'completed' && 'text-green-900 dark:text-green-100', 
              tool.state === 'error' && 'text-red-900 dark:text-red-100'
            )}>
              {tool.displayName || tool.name}
            </div>
            <div className={cn(
              'text-xs',
              tool.state === 'executing' && 'text-purple-700 dark:text-purple-300',
              tool.state === 'completed' && 'text-green-700 dark:text-green-300',
              tool.state === 'error' && 'text-red-700 dark:text-red-300'
            )}>
              {tool.state === 'executing' 
                ? 'Building workflow...'
                : tool.state === 'completed'
                ? 'Changes ready for review'
                : 'Workflow generation failed'
              }
            </div>
          </div>
          {tool.duration && tool.state === 'completed' && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {formatDuration(tool.duration)}
            </Badge>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-all duration-200',
      getStateColors()
    )}>
      <div className="flex items-center gap-2">
        {stepNumber && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70 text-xs font-medium dark:bg-black/20">
            {stepNumber}
          </div>
        )}
        {getStateIcon()}
      </div>
      <span className="flex-1 font-medium">
        {tool.displayName || tool.name}
      </span>
      {tool.duration && tool.state === 'completed' && (
        <Badge variant="secondary" className="text-xs">
          {formatDuration(tool.duration)}
        </Badge>
      )}
      {tool.state === 'executing' && tool.progress && (
        <Badge variant="outline" className="text-xs">
          {tool.progress}
        </Badge>
      )}
    </div>
  )
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(({ message, isStreaming }) => {
  const { theme } = useTheme()
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  const handleCopyContent = () => {
    // Copy clean text content without tool call indicators
    const contentToCopy = isAssistant ? stripToolCallIndicators(message.content) : message.content
    navigator.clipboard.writeText(contentToCopy)
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Parse message content to separate text and tool calls
  const parsedContent = useMemo(() => {
    if (isAssistant && message.content) {
      const result = parseMessageContent(message.content)
      return result
    }
    return null
  }, [isAssistant, message.content, message.id])

  // Get clean text content without tool call indicators
  const cleanTextContent = useMemo(() => {
    if (isAssistant && message.content) {
      return stripToolCallIndicators(message.content)
    }
    return message.content
  }, [isAssistant, message.content])

  // Group design approach tools if they exist
  const designApproachGroup = useMemo(() => {
    if (parsedContent?.inlineContent) {
      const group = groupDesignApproachTools(parsedContent.inlineContent)
      
      // Only warn if we have design tools but no group (indicates a problem)
      const designTools = parsedContent.inlineContent.filter(item => 
        item.type === 'tool_call' && item.toolCall && isDesignApproachTool(item.toolCall.name)
      )
      
      if (designTools.length >= 2 && !group) {
        console.warn('Design approach group should exist but was not detected:', {
          messageId: message.id,
          designToolCount: designTools.length,
          designToolNames: designTools.map(item => item.toolCall?.name)
        })
      }
      
      return group
    }
    return null
  }, [parsedContent?.inlineContent, message.id, message.content.length])

  // Custom components for react-markdown with improved styling
  const markdownComponents = {
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      if (!inline && language) {
        return (
          <div className='group relative my-4 overflow-hidden rounded-xl border border-border bg-muted/30'>
            <div className='flex items-center justify-between border-b border-border/50 bg-muted/50 px-4 py-2'>
              <span className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
                {language}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-0 opacity-70 hover:opacity-100'
                onClick={() => navigator.clipboard.writeText(String(children))}
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
            <div className='overflow-x-auto'>
              <SyntaxHighlighter
                style={theme === 'dark' ? oneDark : oneLight}
                language={language}
                PreTag='div'
                className='!m-0 !bg-transparent'
                showLineNumbers={language !== 'bash' && language !== 'shell'}
                wrapLines={true}
                wrapLongLines={true}
                customStyle={{
                  margin: '0 !important',
                  padding: '1rem',
                  fontSize: '0.875rem',
                  background: 'transparent',
                }}
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          </div>
        )
      }

      return (
        <code
          className='rounded-md border bg-muted/80 px-1.5 py-0.5 font-mono text-sm'
          {...props}
        >
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => children,
    h1: ({ children }: any) => (
      <h1 className='mt-8 mb-4 border-b border-border pb-2 font-bold text-foreground text-2xl'>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className='mt-6 mb-3 font-semibold text-foreground text-xl'>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className='mt-4 mb-2 font-semibold text-foreground text-lg'>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className='mb-4 leading-relaxed text-foreground last:mb-0'>
        {children}
      </p>
    ),
    a: ({ href, children }: any) => (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-600/60 dark:text-blue-400 dark:hover:text-blue-300'
      >
        {children}
      </a>
    ),
    ul: ({ children }: any) => (
      <ul className='mb-4 ml-6 list-disc space-y-1'>{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className='mb-4 ml-6 list-decimal space-y-1'>{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className='leading-relaxed text-foreground'>{children}</li>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className='my-4 border-l-4 border-muted-foreground/20 bg-muted/30 py-3 pl-6 italic text-muted-foreground'>
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className='my-4 overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className='border-b bg-muted/50 px-4 py-2 text-left font-semibold'>
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className='border-b border-muted/30 px-4 py-2'>{children}</td>
    ),
  }

  if (isUser) {
    return (
      <div className='group mb-6 flex w-full justify-end px-4'>
        <div className='flex max-w-[85%] items-start gap-3'>
          <div className='flex flex-col items-end space-y-2'>
            <div className='overflow-hidden rounded-2xl rounded-tr-lg bg-primary px-4 py-3 text-primary-foreground shadow-sm'>
              <div className='whitespace-pre-wrap text-sm leading-relaxed'>
                {message.content}
              </div>
            </div>
            <div className='flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
              <span className='text-muted-foreground text-xs'>
                {formatTimestamp(message.timestamp)}
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleCopyContent}
                className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
          </div>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm'>
            <User className='h-4 w-4' />
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className='group mb-6 flex w-full justify-start px-4'>
        <div className='flex w-full max-w-[85%] flex-col'>
          {/* Main message content with icon */}
          <div className='flex items-start gap-3'>
            {/* Bot icon */}
            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm'>
              <Bot className={`h-4 w-4 ${isStreaming ? 'animate-pulse' : ''}`} />
            </div>

            {/* Message content */}
            <div className='min-w-0 flex-1'>
              {/* Render inline content */}
              {parsedContent?.inlineContent && parsedContent.inlineContent.length > 0 ? (
                <div className='space-y-3'>
                  {parsedContent.inlineContent.map((item, index) => {
                    // If this index is within the design approach group range, skip individual rendering
                    if (designApproachGroup && 
                        index >= designApproachGroup.groupStart && 
                        index <= designApproachGroup.groupEnd) {
                      // Only render the group once at the start position
                      if (index === designApproachGroup.groupStart) {
                        return (
                          <DesignApproachGroup 
                            key={`design-group-${designApproachGroup.groupStart}`}
                            tools={designApproachGroup.groupedTools}
                            isCompleted={designApproachGroup.groupedTools.every(t => t.state === 'completed' || t.state === 'error')}
                          />
                        )
                      }
                      return null
                    }

                    if (item.type === 'tool_call' && item.toolCall) {
                      return <InlineToolCall key={`${item.toolCall.id}-${index}`} tool={item.toolCall} />
                    }
                    
                    if (item.type === 'text' && item.content.trim()) {
                      return (
                        <div
                          key={`text-${index}`}
                          className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'
                        >
                          <div className='prose prose-sm dark:prose-invert max-w-none'>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {item.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              ) : (
                /* Fallback for empty content or streaming */
                <div className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'>
                  {cleanTextContent ? (
                    <div className='prose prose-sm dark:prose-invert max-w-none'>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {cleanTextContent}
                      </ReactMarkdown>
                    </div>
                  ) : isStreaming ? (
                    <div className='flex items-center gap-2 py-2 text-muted-foreground'>
                      <div className='flex space-x-1'>
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                      <span className='text-sm'>Thinking...</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Timestamp and actions */}
          <div className='ml-11 mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
            <span className='text-muted-foreground text-xs'>
              {formatTimestamp(message.timestamp)}
            </span>
            {cleanTextContent && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleCopyContent}
                className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
              >
                <Copy className='h-3 w-3' />
              </Button>
            )}
          </div>

          {/* Citations if available */}
          {message.citations && message.citations.length > 0 && (
            <div className='ml-11 mt-2 space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>Sources:</div>
              <div className='flex flex-wrap gap-2'>
                {message.citations.map((citation) => (
                  <a
                    key={citation.id}
                    href={citation.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
                  >
                    {citation.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
})

ProfessionalMessage.displayName = 'ProfessionalMessage'

export { ProfessionalMessage }
