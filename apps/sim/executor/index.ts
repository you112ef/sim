import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console/logger'
import type { TraceSpan } from '@/lib/logs/types'
import { getBlock } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  LoopBlockHandler,
  ParallelBlockHandler,
  ResponseBlockHandler,
  RouterBlockHandler,
  TriggerBlockHandler,
  WaitBlockHandler,
  WorkflowBlockHandler,
} from '@/executor/handlers'
import { LoopManager } from '@/executor/loops/loops'
import { ParallelManager } from '@/executor/parallels/parallels'
import { ParallelRoutingUtils } from '@/executor/parallels/utils'
import { PathTracker } from '@/executor/path/path'
import { InputResolver } from '@/executor/resolver/resolver'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { streamingResponseFormatProcessor } from '@/executor/utils'
import { VirtualBlockUtils } from '@/executor/utils/virtual-blocks'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('Executor')

declare global {
  interface Window {
    __SIM_TELEMETRY_ENABLED?: boolean
    __SIM_TRACK_EVENT?: (eventName: string, properties?: Record<string, any>) => void
  }
}

/**
 * Tracks telemetry events for workflow execution if telemetry is enabled
 */
function trackWorkflowTelemetry(eventName: string, data: Record<string, any>) {
  if (typeof window !== 'undefined' && window.__SIM_TRACK_EVENT) {
    // Add timestamp and sanitize the data to avoid circular references
    const safeData = {
      ...data,
      timestamp: Date.now(),
    }

    // Track the event through the global telemetry function
    window.__SIM_TRACK_EVENT(eventName, {
      category: 'workflow',
      ...safeData,
    })
  }
}

/**
 * Core execution engine that runs workflow blocks in topological order.
 *
 * Handles block execution, state management, and error handling.
 */
export class Executor {
  // Core components are initialized once and remain immutable
  private resolver: InputResolver
  private loopManager: LoopManager
  private parallelManager: ParallelManager
  private pathTracker: PathTracker
  private blockHandlers: BlockHandler[]
  private workflowInput: any
  private isDebugging = false
  private contextExtensions: any = {}
  private actualWorkflow: SerializedWorkflow
  private isCancelled = false
  private isPaused = false
  private isChildExecution = false

  constructor(
    private workflowParam:
      | SerializedWorkflow
      | {
          workflow: SerializedWorkflow
          currentBlockStates?: Record<string, BlockOutput>
          envVarValues?: Record<string, string>
          workflowInput?: any
          workflowVariables?: Record<string, any>
          contextExtensions?: {
            stream?: boolean
            selectedOutputIds?: string[]
            edges?: Array<{ source: string; target: string }>
            onStream?: (streamingExecution: StreamingExecution) => Promise<void>
            executionId?: string
            workspaceId?: string
            isChildExecution?: boolean
            // Marks executions that must use deployed constraints (API/webhook/schedule/chat)
            isDeployedContext?: boolean
          }
        },
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {},
    workflowInput?: any,
    private workflowVariables: Record<string, any> = {}
  ) {
    // Handle new constructor format with options object
    if (typeof workflowParam === 'object' && 'workflow' in workflowParam) {
      const options = workflowParam
      this.actualWorkflow = options.workflow
      this.initialBlockStates = options.currentBlockStates || {}
      this.environmentVariables = options.envVarValues || {}
      this.workflowInput = options.workflowInput || {}
      this.workflowVariables = options.workflowVariables || {}

      // Store context extensions for streaming and output selection
      if (options.contextExtensions) {
        this.contextExtensions = options.contextExtensions
        this.isChildExecution = options.contextExtensions.isChildExecution || false
      }
    } else {
      this.actualWorkflow = workflowParam

      if (workflowInput) {
        this.workflowInput = workflowInput
      } else {
        this.workflowInput = {}
      }
    }

    this.validateWorkflow()

    this.loopManager = new LoopManager(this.actualWorkflow.loops || {})
    this.parallelManager = new ParallelManager(this.actualWorkflow.parallels || {})

    // Calculate accessible blocks for consistent reference resolution
    const accessibleBlocksMap = BlockPathCalculator.calculateAccessibleBlocksForWorkflow(
      this.actualWorkflow
    )

    this.resolver = new InputResolver(
      this.actualWorkflow,
      this.environmentVariables,
      this.workflowVariables,
      this.loopManager,
      accessibleBlocksMap
    )
    this.pathTracker = new PathTracker(this.actualWorkflow)

    this.blockHandlers = [
      new TriggerBlockHandler(),
      new WaitBlockHandler(),
      new AgentBlockHandler(),
      new RouterBlockHandler(this.pathTracker),
      new ConditionBlockHandler(this.pathTracker, this.resolver),
      new EvaluatorBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
      new LoopBlockHandler(this.resolver, this.pathTracker),
      new ParallelBlockHandler(this.resolver, this.pathTracker),
      new ResponseBlockHandler(),
      new WorkflowBlockHandler(),
      new GenericBlockHandler(),
    ]

    this.isDebugging = useGeneralStore.getState().isDebugModeEnabled
  }

  /**
   * Cancels the current workflow execution.
   * Sets the cancellation flag to stop further execution.
   */
  public cancel(): void {
    logger.info('Workflow execution cancelled')
    this.isCancelled = true
  }

  /**
   * Pauses the current workflow execution.
   * Sets the pause flag to stop further execution at the next safe point.
   */
  public pause(): void {
    logger.info('Workflow execution paused')
    this.isPaused = true
  }

  /**
   * Resumes the workflow execution.
   * Clears the pause flag to allow execution to continue.
   */
  public resume(): void {
    logger.info('Workflow execution resumed')
    this.isPaused = false
  }

  /**
   * Checks if the execution is currently paused
   */
  public isPausedState(): boolean {
    return this.isPaused
  }

  /**
   * Creates an executor and resumes execution from a paused state.
   * 
   * @param workflowState - Serialized workflow state
   * @param executionContext - Saved execution context from pause
   * @param environmentVariables - Environment variables
   * @param workflowInput - Original workflow input
   * @param workflowVariables - Workflow variables
   * @param contextExtensions - Additional context (executionId, workspaceId, etc.)
   * @returns Resumed executor ready to continue execution
   */
  static createFromPausedState(
    workflowState: SerializedWorkflow,
    executionContext: ExecutionContext,
    environmentVariables: Record<string, string>,
    workflowInput: any,
    workflowVariables: Record<string, any> = {},
    contextExtensions?: any
  ): { executor: Executor; context: ExecutionContext } {
    // Create a new executor with the saved state
    const executor = new Executor(
      {
        workflow: workflowState,
        currentBlockStates: {}, // Block states are in the context
        envVarValues: environmentVariables,
        workflowInput,
        workflowVariables,
        contextExtensions,
      },
      {}, // initialBlockStates not needed when resuming
      environmentVariables,
      workflowInput,
      workflowVariables
    )

    // Return the executor along with the context to resume from
    return { executor, context: executionContext }
  }

  /**
   * Continues execution from a paused context.
   * Similar to continueExecution but designed for resuming from database state.
   * 
   * @param workflowId - Workflow ID
   * @param context - Execution context to resume from
   * @returns Execution result
   */
  async resumeFromContext(
    workflowId: string,
    context: ExecutionContext
  ): Promise<ExecutionResult | StreamingExecution> {
    const { setIsExecuting, setPendingBlocks, setExecutionIdentifiers, reset } =
      useExecutionStore.getState()
    let finalOutput: NormalizedBlockOutput = {}

    const resumeTime = new Date()
    
    trackWorkflowTelemetry('workflow_execution_resumed', {
      workflowId,
      executedBlockCount: context.executedBlocks.size,
      resumeTime: resumeTime.toISOString(),
    })

    try {
      // Only manage global execution state for parent executions
      if (!this.isChildExecution) {
        setIsExecuting(true)
        setExecutionIdentifiers({
          executionId: this.contextExtensions.executionId,
          workflowId,
          isResuming: true,
        })
      }

      // Resume the execution loop from where it was paused
      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 500

      while (hasMoreLayers && iteration < maxIterations && !this.isCancelled && !this.isPaused) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (nextLayer.length === 0) {
          hasMoreLayers = this.hasMoreParallelWork(context)
        } else {
          const outputs = await this.executeLayer(nextLayer, context)

          for (const output of outputs) {
            if (
              output &&
              typeof output === 'object' &&
              'stream' in output &&
              'execution' in output
            ) {
              if (context.onStream) {
                const streamingExec = output as StreamingExecution
                const [streamForClient, streamForExecutor] = streamingExec.stream.tee()

                const blockId = (streamingExec.execution as any).blockId

                let responseFormat: any
                if (this.initialBlockStates?.[blockId]) {
                  const blockState = this.initialBlockStates[blockId] as any
                  responseFormat = blockState.responseFormat
                }

                const processedClientStream = streamingResponseFormatProcessor.processStream(
                  streamForClient,
                  blockId,
                  context.selectedOutputIds || [],
                  responseFormat
                )

                const clientStreamingExec = { ...streamingExec, stream: processedClientStream }

                try {
                  await context.onStream(clientStreamingExec)
                } catch (streamError: any) {
                  logger.error('Error in onStream callback:', streamError)
                }

                const reader = streamForExecutor.getReader()
                const decoder = new TextDecoder()
                let fullContent = ''

                try {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    fullContent += decoder.decode(value, { stream: true })
                  }

                  const blockState = context.blockStates.get(blockId)
                  if (blockState?.output) {
                    if (responseFormat && fullContent) {
                      try {
                        const parsedContent = JSON.parse(fullContent)
                        const structuredOutput = {
                          ...parsedContent,
                          tokens: blockState.output.tokens,
                          toolCalls: blockState.output.toolCalls,
                          providerTiming: blockState.output.providerTiming,
                          cost: blockState.output.cost,
                        }
                        blockState.output = structuredOutput

                        const blockLog = context.blockLogs.find((log) => log.blockId === blockId)
                        if (blockLog) {
                          blockLog.output = structuredOutput
                        }
                      } catch (parseError) {
                        blockState.output.content = fullContent
                      }
                    } else {
                      blockState.output.content = fullContent
                    }
                  }
                } catch (readerError: any) {
                  logger.error('Error reading stream for executor:', readerError)
                } finally {
                  try {
                    reader.releaseLock()
                  } catch (releaseError: any) {
                    // Reader might already be released
                  }
                }
              }
            }
          }

          const normalizedOutputs = outputs
            .filter(
              (output) =>
                !(
                  typeof output === 'object' &&
                  output !== null &&
                  'stream' in output &&
                  'execution' in output
                )
            )
            .map((output) => output as NormalizedBlockOutput)

          if (normalizedOutputs.length > 0) {
            finalOutput = normalizedOutputs[normalizedOutputs.length - 1]
          }

          await this.loopManager.processLoopIterations(context)
          await this.parallelManager.processParallelIterations(context)

          const updatedNextLayer = this.getNextExecutionLayer(context)
          if (updatedNextLayer.length === 0) {
            hasMoreLayers = false
          }
        }

        iteration++
      }

      // Handle pause (might be paused again during resume)
      if (this.isPaused) {
        return {
          success: true,
          output: finalOutput,
          metadata: {
            duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
            startTime: context.metadata.startTime!,
            isPaused: true,
            waitBlockInfo: (context as any).waitBlockInfo,
            context: context,
            workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      // Handle cancellation
      if (this.isCancelled) {
        return {
          success: false,
          output: finalOutput,
          error: 'Workflow execution was cancelled',
          metadata: {
            duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
            startTime: context.metadata.startTime!,
            workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()
      const duration = endTime.getTime() - new Date(context.metadata.startTime!).getTime()

      trackWorkflowTelemetry('workflow_execution_completed_from_resume', {
        workflowId,
        duration,
        blockCount: this.actualWorkflow.blocks.length,
        executedBlockCount: context.executedBlocks.size,
        endTime: endTime.toISOString(),
        success: true,
      })

      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: duration,
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Workflow resume failed:', this.sanitizeError(error))

      return {
        success: false,
        output: finalOutput,
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        error: error instanceof Error ? error.message : String(error),
        logs: context.blockLogs,
      }
    } finally {
      if (!this.isChildExecution) {
        setPendingBlocks([])
        setExecutionIdentifiers({ executionId: null, isResuming: false })
        setIsExecuting(false)
      }
    }
  }

  /**
   * Executes the workflow and returns the result.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @param startBlockId - Optional block ID to start execution from (for webhook or schedule triggers)
   * @returns Execution result containing output, logs, and metadata, or a stream, or combined execution and stream
   */
  async execute(
    workflowId: string,
    startBlockId?: string
  ): Promise<ExecutionResult | StreamingExecution> {
    const { setIsExecuting, setIsDebugging, setPendingBlocks, reset } = useExecutionStore.getState()
    const startTime = new Date()
    let finalOutput: NormalizedBlockOutput = {}

    // Track workflow execution start
    trackWorkflowTelemetry('workflow_execution_started', {
      workflowId,
      blockCount: this.actualWorkflow.blocks.length,
      connectionCount: this.actualWorkflow.connections.length,
      startTime: startTime.toISOString(),
    })

    this.validateWorkflow(startBlockId)

    const context = this.createExecutionContext(workflowId, startTime, startBlockId)

    try {
      // Only manage global execution state for parent executions
      if (!this.isChildExecution) {
        setIsExecuting(true)

        if (this.isDebugging) {
          setIsDebugging(true)
        }
      }

      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 500 // Safety limit for infinite loops

      while (hasMoreLayers && iteration < maxIterations && !this.isCancelled && !this.isPaused) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (this.isDebugging) {
          // In debug mode, update the pending blocks and wait for user interaction
          setPendingBlocks(nextLayer)

          // If there are no more blocks, we're done
          if (nextLayer.length === 0) {
            hasMoreLayers = false
          } else {
            // Return early to wait for manual stepping
            // The caller (useWorkflowExecution) will handle resumption
            return {
              success: true,
              output: finalOutput,
              metadata: {
                duration: Date.now() - startTime.getTime(),
                startTime: context.metadata.startTime!,
                pendingBlocks: nextLayer,
                isDebugSession: true,
                context: context, // Include context for resumption
                workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
                  source: conn.source,
                  target: conn.target,
                })),
              },
              logs: context.blockLogs,
            }
          }
        } else {
          // Normal execution without debug mode
          if (nextLayer.length === 0) {
            hasMoreLayers = this.hasMoreParallelWork(context)
          } else {
            const outputs = await this.executeLayer(nextLayer, context)

            for (const output of outputs) {
              if (
                output &&
                typeof output === 'object' &&
                'stream' in output &&
                'execution' in output
              ) {
                if (context.onStream) {
                  const streamingExec = output as StreamingExecution
                  const [streamForClient, streamForExecutor] = streamingExec.stream.tee()

                  // Apply response format processing to the client stream if needed
                  const blockId = (streamingExec.execution as any).blockId

                  // Get response format from initial block states (passed from useWorkflowExecution)
                  // The initialBlockStates contain the subblock values including responseFormat
                  let responseFormat: any
                  if (this.initialBlockStates?.[blockId]) {
                    const blockState = this.initialBlockStates[blockId] as any
                    responseFormat = blockState.responseFormat
                  }

                  const processedClientStream = streamingResponseFormatProcessor.processStream(
                    streamForClient,
                    blockId,
                    context.selectedOutputIds || [],
                    responseFormat
                  )

                  const clientStreamingExec = { ...streamingExec, stream: processedClientStream }

                  try {
                    // Handle client stream with proper error handling
                    await context.onStream(clientStreamingExec)
                  } catch (streamError: any) {
                    logger.error('Error in onStream callback:', streamError)
                    // Continue execution even if stream callback fails
                  }

                  // Process executor stream with proper cleanup
                  const reader = streamForExecutor.getReader()
                  const decoder = new TextDecoder()
                  let fullContent = ''

                  try {
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      fullContent += decoder.decode(value, { stream: true })
                    }

                    const blockId = (streamingExec.execution as any).blockId
                    const blockState = context.blockStates.get(blockId)
                    if (blockState?.output) {
                      // Check if we have response format - if so, preserve structured response
                      let responseFormat: any
                      if (this.initialBlockStates?.[blockId]) {
                        const initialBlockState = this.initialBlockStates[blockId] as any
                        responseFormat = initialBlockState.responseFormat
                      }

                      if (responseFormat && fullContent) {
                        // For structured responses, always try to parse the raw streaming content
                        // The streamForExecutor contains the raw JSON response, not the processed display text
                        try {
                          const parsedContent = JSON.parse(fullContent)
                          // Preserve metadata but spread parsed fields at root level (same as manual execution)
                          const structuredOutput = {
                            ...parsedContent,
                            tokens: blockState.output.tokens,
                            toolCalls: blockState.output.toolCalls,
                            providerTiming: blockState.output.providerTiming,
                            cost: blockState.output.cost,
                          }
                          blockState.output = structuredOutput

                          // Also update the corresponding block log with the structured output
                          const blockLog = context.blockLogs.find((log) => log.blockId === blockId)
                          if (blockLog) {
                            blockLog.output = structuredOutput
                          }
                        } catch (parseError) {
                          // If parsing fails, fall back to setting content
                          blockState.output.content = fullContent
                        }
                      } else {
                        // No response format, use standard content setting
                        blockState.output.content = fullContent
                      }
                    }
                  } catch (readerError: any) {
                    logger.error('Error reading stream for executor:', readerError)
                    // Set partial content if available
                    const blockId = (streamingExec.execution as any).blockId
                    const blockState = context.blockStates.get(blockId)
                    if (blockState?.output && fullContent) {
                      // Check if we have response format for error handling too
                      let responseFormat: any
                      if (this.initialBlockStates?.[blockId]) {
                        const initialBlockState = this.initialBlockStates[blockId] as any
                        responseFormat = initialBlockState.responseFormat
                      }

                      if (responseFormat) {
                        // For structured responses, always try to parse the raw streaming content
                        // The streamForExecutor contains the raw JSON response, not the processed display text
                        try {
                          const parsedContent = JSON.parse(fullContent)
                          const structuredOutput = {
                            ...parsedContent,
                            tokens: blockState.output.tokens,
                            toolCalls: blockState.output.toolCalls,
                            providerTiming: blockState.output.providerTiming,
                            cost: blockState.output.cost,
                          }
                          blockState.output = structuredOutput

                          // Also update the corresponding block log with the structured output
                          const blockLog = context.blockLogs.find((log) => log.blockId === blockId)
                          if (blockLog) {
                            blockLog.output = structuredOutput
                          }
                        } catch (parseError) {
                          // If parsing fails, fall back to setting content
                          blockState.output.content = fullContent
                        }
                      } else {
                        // No response format, use standard content setting
                        blockState.output.content = fullContent
                      }
                    }
                  } finally {
                    try {
                      reader.releaseLock()
                    } catch (releaseError: any) {
                      // Reader might already be released - this is expected and safe to ignore
                    }
                  }
                }
              }
            }

            const normalizedOutputs = outputs
              .filter(
                (output) =>
                  !(
                    typeof output === 'object' &&
                    output !== null &&
                    'stream' in output &&
                    'execution' in output
                  )
              )
              .map((output) => output as NormalizedBlockOutput)

            if (normalizedOutputs.length > 0) {
              finalOutput = normalizedOutputs[normalizedOutputs.length - 1]
            }
            // Process loop iterations - this will activate external paths when loops complete
            await this.loopManager.processLoopIterations(context)

            // Process parallel iterations - similar to loops but conceptually for parallel execution
            await this.parallelManager.processParallelIterations(context)

            // Check if a Wait block has requested a pause
            if ((context as any).shouldPauseAfterBlock) {
              if (context.metadata && !context.metadata.waitBlockInfo) {
                ;(context.metadata as any).waitBlockInfo = (context as any).waitBlockInfo
              }

              logger.info('Wait block detected - pausing workflow execution', {
                workflowId,
                pauseReason: (context as any).pauseReason,
              })

              // Trigger the pause
              this.pause()

              // The pause will be handled in the next section
              // Break out of the execution loop
              break
            }

            // Continue execution for any newly activated paths
            // Only stop execution if there are no more blocks to execute
            const updatedNextLayer = this.getNextExecutionLayer(context)
            if (updatedNextLayer.length === 0) {
              hasMoreLayers = false
            }
          }
        }

        iteration++
      }

      // Handle cancellation
      if (this.isCancelled) {
        trackWorkflowTelemetry('workflow_execution_cancelled', {
          workflowId,
          duration: Date.now() - startTime.getTime(),
          blockCount: this.actualWorkflow.blocks.length,
          executedBlockCount: context.executedBlocks.size,
          startTime: startTime.toISOString(),
        })

        return {
          success: false,
          output: finalOutput,
          error: 'Workflow execution was cancelled',
          metadata: {
            duration: Date.now() - startTime.getTime(),
            startTime: context.metadata.startTime!,
            workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      // Handle pause
      if (this.isPaused) {
        trackWorkflowTelemetry('workflow_execution_paused', {
          workflowId,
          duration: Date.now() - startTime.getTime(),
          blockCount: this.actualWorkflow.blocks.length,
          executedBlockCount: context.executedBlocks.size,
          startTime: startTime.toISOString(),
        })

        return {
          success: true,
          output: finalOutput,
          metadata: {
            duration: Date.now() - startTime.getTime(),
            startTime: context.metadata.startTime!,
            isPaused: true,
            waitBlockInfo: (context as any).waitBlockInfo,
            context: context, // Include context for resumption
            workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      trackWorkflowTelemetry('workflow_execution_completed', {
        workflowId,
        duration,
        blockCount: this.actualWorkflow.blocks.length,
        executedBlockCount: context.executedBlocks.size,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        success: true,
      })

      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: duration,
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Workflow execution failed:', this.sanitizeError(error))

      // Track workflow execution failure
      trackWorkflowTelemetry('workflow_execution_failed', {
        workflowId,
        duration: Date.now() - startTime.getTime(),
        error: this.extractErrorMessage(error),
        executedBlockCount: context.executedBlocks.size,
        blockLogs: context.blockLogs.length,
      })

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        metadata: {
          duration: Date.now() - startTime.getTime(),
          startTime: context.metadata.startTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    } finally {
      // Only reset global state for parent executions
      if (!this.isChildExecution && !this.isDebugging) {
        reset()
      }
    }
  }

  /**
   * Continues execution in debug mode from the current state.
   *
   * @param blockIds - Block IDs to execute in this step
   * @param context - The current execution context
   * @returns Updated execution result
   */
  async continueExecution(blockIds: string[], context: ExecutionContext): Promise<ExecutionResult> {
    const { setPendingBlocks } = useExecutionStore.getState()
    let finalOutput: NormalizedBlockOutput = {}

    // Check for cancellation
    if (this.isCancelled) {
      return {
        success: false,
        output: finalOutput,
        error: 'Workflow execution was cancelled',
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    }

    try {
      // Execute the current layer - using the original context, not a clone
      const outputs = await this.executeLayer(blockIds, context)

      if (outputs.length > 0) {
        const nonStreamingOutputs = outputs.filter(
          (o) => !(o && typeof o === 'object' && 'stream' in o)
        ) as NormalizedBlockOutput[]
        if (nonStreamingOutputs.length > 0) {
          finalOutput = nonStreamingOutputs[nonStreamingOutputs.length - 1]
        }
      }
      await this.loopManager.processLoopIterations(context)
      await this.parallelManager.processParallelIterations(context)
      const nextLayer = this.getNextExecutionLayer(context)
      setPendingBlocks(nextLayer)

      // Check if we've completed execution
      const isComplete = nextLayer.length === 0

      if (isComplete) {
        const endTime = new Date()
        context.metadata.endTime = endTime.toISOString()

        return {
          success: true,
          output: finalOutput,
          metadata: {
            duration: endTime.getTime() - new Date(context.metadata.startTime!).getTime(),
            startTime: context.metadata.startTime!,
            endTime: context.metadata.endTime!,
            pendingBlocks: [],
            isDebugSession: false,
            workflowConnections: this.actualWorkflow.connections.map((conn) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      // Return the updated state for the next step
      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          pendingBlocks: nextLayer,
          isDebugSession: true,
          context: context, // Return the same context object for continuity
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Debug step execution failed:', this.sanitizeError(error))

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    }
  }

  /**
   * Validates that the workflow meets requirements for execution.
   * Checks for starter block, webhook trigger block, or schedule trigger block, connections, and loop configurations.
   *
   * @param startBlockId - Optional specific block to start from
   * @throws Error if workflow validation fails
   */
  private validateWorkflow(startBlockId?: string): void {
    if (startBlockId) {
      const startBlock = this.actualWorkflow.blocks.find((block) => block.id === startBlockId)
      if (!startBlock || !startBlock.enabled) {
        throw new Error(`Start block ${startBlockId} not found or disabled`)
      }
      return
    }

    const starterBlock = this.actualWorkflow.blocks.find(
      (block) => block.metadata?.id === BlockType.STARTER
    )

    // Check for any type of trigger block (dedicated triggers or trigger-mode blocks)
    const hasTriggerBlocks = this.actualWorkflow.blocks.some((block) => {
      // Check if it's a dedicated trigger block (category: 'triggers')
      if (block.metadata?.category === 'triggers') return true
      // Check if it's a block with trigger mode enabled
      if (block.config?.params?.triggerMode === true) return true
      return false
    })

    if (hasTriggerBlocks) {
      // When triggers exist (either dedicated or trigger-mode), we allow execution without a starter block
      // The actual start block will be determined at runtime based on the execution context
    } else {
      // Legacy workflows: require a valid starter block and basic connection checks
      if (!starterBlock || !starterBlock.enabled) {
        throw new Error('Workflow must have an enabled starter block')
      }

      const incomingToStarter = this.actualWorkflow.connections.filter(
        (conn) => conn.target === starterBlock.id
      )
      if (incomingToStarter.length > 0) {
        throw new Error('Starter block cannot have incoming connections')
      }

      const outgoingFromStarter = this.actualWorkflow.connections.filter(
        (conn) => conn.source === starterBlock.id
      )
      if (outgoingFromStarter.length === 0) {
        throw new Error('Starter block must have at least one outgoing connection')
      }
    }

    // General graph validations
    const blockIds = new Set(this.actualWorkflow.blocks.map((block) => block.id))
    for (const conn of this.actualWorkflow.connections) {
      if (!blockIds.has(conn.source)) {
        throw new Error(`Connection references non-existent source block: ${conn.source}`)
      }
      if (!blockIds.has(conn.target)) {
        throw new Error(`Connection references non-existent target block: ${conn.target}`)
      }
    }

    for (const [loopId, loop] of Object.entries(this.actualWorkflow.loops || {})) {
      for (const nodeId of loop.nodes) {
        if (!blockIds.has(nodeId)) {
          throw new Error(`Loop ${loopId} references non-existent block: ${nodeId}`)
        }
      }

      if (loop.iterations <= 0) {
        throw new Error(`Loop ${loopId} must have a positive iterations value`)
      }

      if (loop.loopType === 'forEach') {
        if (
          !loop.forEachItems ||
          (typeof loop.forEachItems === 'string' && loop.forEachItems.trim() === '')
        ) {
          throw new Error(`forEach loop ${loopId} requires a collection to iterate over`)
        }
      }
    }
  }

  /**
   * Creates the initial execution context with predefined states.
   * Sets up the starter block, webhook trigger block, or schedule trigger block and its connections in the active execution path.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @param startTime - Execution start time
   * @param startBlockId - Optional specific block to start from
   * @returns Initialized execution context
   */
  private createExecutionContext(
    workflowId: string,
    startTime: Date,
    startBlockId?: string
  ): ExecutionContext {
    const context: ExecutionContext = {
      workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      isDeployedContext: this.contextExtensions.isDeployedContext || false,
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
        duration: 0, // Initialize with zero, will be updated throughout execution
      },
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: this.actualWorkflow,
      // Add streaming context from contextExtensions
      stream: this.contextExtensions.stream || false,
      selectedOutputIds: this.contextExtensions.selectedOutputIds || [],
      edges: this.contextExtensions.edges || [],
      onStream: this.contextExtensions.onStream,
    }

    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, {
        output: output as NormalizedBlockOutput,
        executed: true,
        executionTime: 0,
      })
    })

    // Initialize loop iterations
    if (this.actualWorkflow.loops) {
      for (const loopId of Object.keys(this.actualWorkflow.loops)) {
        // Start all loops at iteration 0
        context.loopIterations.set(loopId, 0)
      }
    }

    // Determine which block to initialize as the starting point
    let initBlock: SerializedBlock | undefined
    if (startBlockId) {
      // Starting from a specific block (webhook trigger, schedule trigger, or new trigger blocks)
      initBlock = this.actualWorkflow.blocks.find((block) => block.id === startBlockId)
    } else {
      // Default to starter block (legacy) or find any trigger block
      initBlock = this.actualWorkflow.blocks.find(
        (block) => block.metadata?.id === BlockType.STARTER
      )

      // If no starter block, look for appropriate trigger block based on context
      if (!initBlock) {
        if (this.isChildExecution) {
          const inputTriggerBlocks = this.actualWorkflow.blocks.filter(
            (block) => block.metadata?.id === 'input_trigger'
          )
          if (inputTriggerBlocks.length === 1) {
            initBlock = inputTriggerBlocks[0]
          } else if (inputTriggerBlocks.length > 1) {
            throw new Error('Child workflow has multiple Input Trigger blocks. Keep only one.')
          }
        } else {
          // Parent workflows can use any trigger block (dedicated or trigger-mode)
          const triggerBlocks = this.actualWorkflow.blocks.filter(
            (block) =>
              block.metadata?.id === 'input_trigger' ||
              block.metadata?.id === 'api_trigger' ||
              block.metadata?.id === 'chat_trigger' ||
              block.metadata?.category === 'triggers' ||
              block.config?.params?.triggerMode === true
          )
          if (triggerBlocks.length > 0) {
            initBlock = triggerBlocks[0]
          }
        }
      }
    }

    if (initBlock) {
      // Initialize the starting block with the workflow input
      try {
        // Get inputFormat from either old location (config.params) or new location (metadata.subBlocks)
        const blockParams = initBlock.config.params
        let inputFormat = blockParams?.inputFormat

        // For new trigger blocks (api_trigger, etc), inputFormat is in metadata.subBlocks
        const metadataWithSubBlocks = initBlock.metadata as any
        if (!inputFormat && metadataWithSubBlocks?.subBlocks?.inputFormat?.value) {
          inputFormat = metadataWithSubBlocks.subBlocks.inputFormat.value
        }

        // If input format is defined, structure the input according to the schema
        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          // Create structured input based on input format
          const structuredInput: Record<string, any> = {}

          // Process each field in the input format
          for (const field of inputFormat) {
            if (field.name && field.type) {
              // Get the field value from workflow input if available
              // First try to access via input.field, then directly from field
              // This handles both input formats: { input: { field: value } } and { field: value }
              let inputValue =
                this.workflowInput?.input?.[field.name] !== undefined
                  ? this.workflowInput.input[field.name] // Try to get from input.field
                  : this.workflowInput?.[field.name] // Fallback to direct field access

              if (inputValue === undefined || inputValue === null) {
                if (Object.hasOwn(field, 'value')) {
                  inputValue = (field as any).value
                }
              }

              let typedValue = inputValue
              if (inputValue !== undefined && inputValue !== null) {
                if (field.type === 'string' && typeof inputValue !== 'string') {
                  typedValue = String(inputValue)
                } else if (field.type === 'number' && typeof inputValue !== 'number') {
                  const num = Number(inputValue)
                  typedValue = Number.isNaN(num) ? inputValue : num
                } else if (field.type === 'boolean' && typeof inputValue !== 'boolean') {
                  typedValue =
                    inputValue === 'true' ||
                    inputValue === true ||
                    inputValue === 1 ||
                    inputValue === '1'
                } else if (
                  (field.type === 'object' || field.type === 'array') &&
                  typeof inputValue === 'string'
                ) {
                  try {
                    typedValue = JSON.parse(inputValue)
                  } catch (e) {
                    logger.warn(`Failed to parse ${field.type} input for field ${field.name}:`, e)
                  }
                }
              }

              // Add the field to structured input
              structuredInput[field.name] = typedValue
            }
          }

          // Check if we managed to process any fields - if not, use the raw input
          const hasProcessedFields = Object.keys(structuredInput).length > 0

          // If no fields matched the input format, extract the raw input to use instead
          const rawInputData =
            this.workflowInput?.input !== undefined
              ? this.workflowInput.input // Use the input value
              : this.workflowInput // Fallback to direct input

          // Use the structured input if we processed fields, otherwise use raw input
          const finalInput = hasProcessedFields ? structuredInput : rawInputData

          // Initialize the starting block with structured input
          let blockOutput: any

          // For API/Input triggers, normalize primitives and mirror objects under input
          if (
            initBlock.metadata?.id === 'api_trigger' ||
            initBlock.metadata?.id === 'input_trigger'
          ) {
            const isObject =
              finalInput !== null && typeof finalInput === 'object' && !Array.isArray(finalInput)
            if (isObject) {
              blockOutput = { ...finalInput }
              // Provide a mirrored input object for universal <start.input> references
              blockOutput.input = { ...finalInput }
            } else {
              // Primitive input: only expose under input
              blockOutput = { input: finalInput }
            }
          } else {
            // For legacy starter blocks, keep the old behavior
            blockOutput = {
              input: finalInput,
              conversationId: this.workflowInput?.conversationId, // Add conversationId to root
              ...finalInput, // Add input fields directly at top level
            }
          }

          // Add files if present (for all trigger types)
          if (this.workflowInput?.files && Array.isArray(this.workflowInput.files)) {
            blockOutput.files = this.workflowInput.files
          }

          context.blockStates.set(initBlock.id, {
            output: blockOutput,
            executed: true,
            executionTime: 0,
          })

          // Create a block log for the starter block if it has files
          // This ensures files are captured in trace spans and execution logs
          this.createStartedBlockWithFilesLog(initBlock, blockOutput, context)
        } else {
          // Handle triggers without inputFormat
          let starterOutput: any

          // Handle different trigger types
          if (initBlock.metadata?.id === 'chat_trigger') {
            // Chat trigger: extract input, conversationId, and files
            starterOutput = {
              input: this.workflowInput?.input || '',
              conversationId: this.workflowInput?.conversationId || '',
            }

            if (this.workflowInput?.files && Array.isArray(this.workflowInput.files)) {
              starterOutput.files = this.workflowInput.files
            }
          } else if (
            initBlock.metadata?.id === 'api_trigger' ||
            initBlock.metadata?.id === 'input_trigger'
          ) {
            // API/Input trigger without inputFormat: normalize primitives and mirror objects under input
            const rawCandidate =
              this.workflowInput?.input !== undefined
                ? this.workflowInput.input
                : this.workflowInput
            const isObject =
              rawCandidate !== null &&
              typeof rawCandidate === 'object' &&
              !Array.isArray(rawCandidate)
            if (isObject) {
              starterOutput = {
                ...(rawCandidate as Record<string, any>),
                input: { ...(rawCandidate as Record<string, any>) },
              }
            } else {
              starterOutput = { input: rawCandidate }
            }
          } else {
            // Legacy starter block handling
            if (this.workflowInput && typeof this.workflowInput === 'object') {
              // Check if this is a chat workflow input (has both input and conversationId)
              if (
                Object.hasOwn(this.workflowInput, 'input') &&
                Object.hasOwn(this.workflowInput, 'conversationId')
              ) {
                // Chat workflow: extract input, conversationId, and files to root level
                starterOutput = {
                  input: this.workflowInput.input,
                  conversationId: this.workflowInput.conversationId,
                }

                // Add files if present
                if (this.workflowInput.files && Array.isArray(this.workflowInput.files)) {
                  starterOutput.files = this.workflowInput.files
                }
              } else {
                // API workflow: spread the raw data directly (no wrapping)
                starterOutput = { ...this.workflowInput }
              }
            } else {
              // Fallback for primitive input values
              starterOutput = {
                input: this.workflowInput,
              }
            }
          }

          context.blockStates.set(initBlock.id, {
            output: starterOutput,
            executed: true,
            executionTime: 0,
          })

          // Create a block log for the starter block if it has files
          // This ensures files are captured in trace spans and execution logs
          if (starterOutput.files) {
            this.createStartedBlockWithFilesLog(initBlock, starterOutput, context)
          }
        }
      } catch (e) {
        logger.warn('Error processing starter block input format:', e)

        // Error handler fallback - use appropriate structure
        let blockOutput: any
        if (this.workflowInput && typeof this.workflowInput === 'object') {
          // Check if this is a chat workflow input (has both input and conversationId)
          if (
            Object.hasOwn(this.workflowInput, 'input') &&
            Object.hasOwn(this.workflowInput, 'conversationId')
          ) {
            // Chat workflow: extract input, conversationId, and files to root level
            blockOutput = {
              input: this.workflowInput.input,
              conversationId: this.workflowInput.conversationId,
            }

            // Add files if present
            if (this.workflowInput.files && Array.isArray(this.workflowInput.files)) {
              blockOutput.files = this.workflowInput.files
            }
          } else {
            // API workflow: spread the raw data directly (no wrapping)
            blockOutput = { ...this.workflowInput }
          }
        } else {
          // Primitive input
          blockOutput = {
            input: this.workflowInput,
          }
        }

        context.blockStates.set(initBlock.id, {
          output: blockOutput,
          executed: true,
          executionTime: 0,
        })
        this.createStartedBlockWithFilesLog(initBlock, blockOutput, context)
      }
      // Ensure the starting block is in the active execution path
      context.activeExecutionPath.add(initBlock.id)
      // Mark the starting block as executed
      context.executedBlocks.add(initBlock.id)

      // Add all blocks connected to the starting block to the active execution path
      const connectedToStartBlock = this.actualWorkflow.connections
        .filter((conn) => conn.source === initBlock.id)
        .map((conn) => conn.target)

      connectedToStartBlock.forEach((blockId) => {
        context.activeExecutionPath.add(blockId)
      })
    }

    return context
  }

  /**
   * Determines the next layer of blocks to execute based on dependencies and execution path.
   * Handles special cases for blocks in loops, condition blocks, and router blocks.
   * For blocks inside parallel executions, creates multiple virtual instances.
   *
   * @param context - Current execution context
   * @returns Array of block IDs that are ready to be executed
   */
  private getNextExecutionLayer(context: ExecutionContext): string[] {
    const executedBlocks = context.executedBlocks
    const pendingBlocks = new Set<string>()

    // Check if we have any active parallel executions
    const activeParallels = new Map<string, any>()
    if (context.parallelExecutions) {
      for (const [parallelId, state] of context.parallelExecutions) {
        if (
          state.currentIteration > 0 &&
          state.currentIteration <= state.parallelCount &&
          !context.completedLoops.has(parallelId)
        ) {
          activeParallels.set(parallelId, state)
        }
      }
    }

    for (const block of this.actualWorkflow.blocks) {
      if (executedBlocks.has(block.id) || block.enabled === false) {
        continue
      }

      // Check if this block is inside an active parallel
      let insideParallel: string | null = null
      for (const [parallelId, parallel] of Object.entries(this.actualWorkflow.parallels || {})) {
        if (parallel.nodes.includes(block.id)) {
          insideParallel = parallelId
          break
        }
      }

      // If block is inside a parallel, handle multiple instances
      if (insideParallel && activeParallels.has(insideParallel)) {
      } else if (insideParallel) {
        // Block is inside a parallel but the parallel is not active
        // Check if all virtual instances have been executed
        const parallelState = context.parallelExecutions?.get(insideParallel)
        if (parallelState) {
          let allVirtualInstancesExecuted = true
          for (let i = 0; i < parallelState.parallelCount; i++) {
            const virtualBlockId = VirtualBlockUtils.generateParallelId(block.id, insideParallel, i)
            if (!executedBlocks.has(virtualBlockId)) {
              allVirtualInstancesExecuted = false
              break
            }
          }

          // If all virtual instances have been executed, skip this block
          // It should not be executed as a regular block
          if (allVirtualInstancesExecuted) {
            continue
          }
        }

        // If we reach here, the parallel hasn't been initialized yet
        // Allow normal execution flow
        if (!context.activeExecutionPath.has(block.id)) {
          continue
        }

        const incomingConnections = this.actualWorkflow.connections.filter(
          (conn) => conn.target === block.id
        )

        const allDependenciesMet = this.checkDependencies(
          incomingConnections,
          executedBlocks,
          context
        )

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      } else {
        // Regular block handling (not inside a parallel)
        // Only consider blocks in the active execution path
        if (!context.activeExecutionPath.has(block.id)) {
          continue
        }

        const incomingConnections = this.actualWorkflow.connections.filter(
          (conn) => conn.target === block.id
        )

        const allDependenciesMet = this.checkDependencies(
          incomingConnections,
          executedBlocks,
          context
        )

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      }
    }

    this.processParallelBlocks(activeParallels, context, pendingBlocks)

    return Array.from(pendingBlocks)
  }

  /**
   * Process all active parallel blocks with proper dependency ordering within iterations.
   * This ensures that blocks with dependencies within the same iteration are executed
   * in the correct order, preventing race conditions. Only processes one iteration at a time
   * to maintain proper execution order.
   *
   * @param activeParallels - Map of active parallel executions
   * @param context - Execution context
   * @param pendingBlocks - Set to add ready blocks to
   */
  private processParallelBlocks(
    activeParallels: Map<string, any>,
    context: ExecutionContext,
    pendingBlocks: Set<string>
  ): void {
    for (const [parallelId, parallelState] of activeParallels) {
      const parallel = this.actualWorkflow.parallels?.[parallelId]
      if (!parallel) continue

      // Process all incomplete iterations concurrently
      // Each iteration maintains proper dependency order internally
      for (let iteration = 0; iteration < parallelState.parallelCount; iteration++) {
        if (this.isIterationComplete(parallelId, iteration, parallel, context)) {
          continue // This iteration is already complete
        }

        // Process this iteration - all iterations run concurrently
        this.processParallelIteration(parallelId, iteration, parallel, context, pendingBlocks)
      }
    }
  }

  /**
   * Check if a specific parallel iteration is complete (all blocks that should execute have executed).
   * This method now considers conditional execution paths - only blocks in the active execution
   * path are expected to execute.
   *
   * @param parallelId - ID of the parallel block
   * @param iteration - Iteration index to check
   * @param parallel - Parallel configuration
   * @param context - Execution context
   * @returns Whether the iteration is complete
   */
  private isIterationComplete(
    parallelId: string,
    iteration: number,
    parallel: any,
    context: ExecutionContext
  ): boolean {
    if (!parallel || !parallel.nodes) {
      return true
    }

    const expectedBlocks = this.getExpectedBlocksForIteration(
      parallelId,
      iteration,
      parallel,
      context
    )

    // Check if all expected blocks have been executed
    for (const nodeId of expectedBlocks) {
      const virtualBlockId = VirtualBlockUtils.generateParallelId(nodeId, parallelId, iteration)
      if (!context.executedBlocks.has(virtualBlockId)) {
        return false
      }
    }
    return true
  }

  /**
   * Get the blocks that are expected to execute in a parallel iteration based on
   * the active execution path. This handles conditional logic where some blocks
   * may not execute due to condition or router blocks.
   *
   * @param parallelId - ID of the parallel block
   * @param iteration - Iteration index
   * @param parallel - Parallel configuration
   * @param context - Execution context
   * @returns Array of node IDs that should execute in this iteration
   */
  private getExpectedBlocksForIteration(
    parallelId: string,
    iteration: number,
    parallel: any,
    context: ExecutionContext
  ): string[] {
    if (!parallel || !parallel.nodes) {
      return []
    }

    const expectedBlocks: string[] = []

    for (const nodeId of parallel.nodes) {
      const block = this.actualWorkflow.blocks.find((b) => b.id === nodeId)

      // If block doesn't exist in workflow, fall back to original behavior (assume it should execute)
      // This maintains compatibility with tests and edge cases
      if (!block) {
        expectedBlocks.push(nodeId)
        continue
      }

      if (!block.enabled) {
        continue
      }

      const virtualBlockId = VirtualBlockUtils.generateParallelId(nodeId, parallelId, iteration)

      // Skip blocks that have already been executed
      if (context.executedBlocks.has(virtualBlockId)) {
        expectedBlocks.push(nodeId)
        continue
      }

      // Check if this block should execute based on the active execution path
      // We need to check if the original block is reachable based on current routing decisions
      try {
        const shouldExecute = this.shouldBlockExecuteInParallelIteration(
          nodeId,
          parallelId,
          iteration,
          context
        )

        if (shouldExecute) {
          expectedBlocks.push(nodeId)
        }
      } catch (error) {
        // If path checking fails, default to including the block to maintain existing behavior
        logger.warn(
          `Path check failed for block ${nodeId} in parallel ${parallelId}, iteration ${iteration}:`,
          error
        )
        expectedBlocks.push(nodeId)
      }
    }

    return expectedBlocks
  }

  /**
   * Determines if a block should execute in a specific parallel iteration
   * based on conditional routing and active execution paths.
   *
   * Blocks are excluded from execution if they are completely unconnected (no incoming connections).
   * Starting blocks (with external connections only) and conditionally routed blocks execute as expected.
   *
   * @param nodeId - ID of the block to check
   * @param parallelId - ID of the parallel block
   * @param iteration - Current iteration index
   * @param context - Execution context
   * @returns Whether the block should execute
   */
  private shouldBlockExecuteInParallelIteration(
    nodeId: string,
    parallelId: string,
    iteration: number,
    context: ExecutionContext
  ): boolean {
    const parallel = this.actualWorkflow.parallels?.[parallelId]
    if (!parallel) return false

    return ParallelRoutingUtils.shouldBlockExecuteInParallelIteration(
      nodeId,
      parallel,
      iteration,
      context
    )
  }

  /**
   * Check if there are more parallel iterations to process.
   * This ensures the execution loop continues when iterations are being processed sequentially.
   */
  private hasMoreParallelWork(context: ExecutionContext): boolean {
    if (!context.parallelExecutions) {
      return false
    }

    for (const [parallelId, parallelState] of context.parallelExecutions) {
      // Skip completed parallels
      if (context.completedLoops.has(parallelId)) {
        continue
      }

      // Check if this parallel is active
      if (
        parallelState.currentIteration > 0 &&
        parallelState.currentIteration <= parallelState.parallelCount
      ) {
        const parallel = this.actualWorkflow.parallels?.[parallelId]
        if (!parallel) continue

        // Check if there are incomplete iterations
        for (let iteration = 0; iteration < parallelState.parallelCount; iteration++) {
          if (!this.isIterationComplete(parallelId, iteration, parallel, context)) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Process a single parallel iteration with topological ordering of dependencies.
   * Now includes conditional execution logic - only processes blocks that should execute
   * based on the active execution path (handles conditions, routers, etc.).
   *
   * @param parallelId - ID of the parallel block
   * @param iteration - Current iteration index
   * @param parallel - Parallel configuration
   * @param context - Execution context
   * @param pendingBlocks - Set to add ready blocks to
   */
  private processParallelIteration(
    parallelId: string,
    iteration: number,
    parallel: any,
    context: ExecutionContext,
    pendingBlocks: Set<string>
  ): void {
    const iterationBlocks = new Map<
      string,
      {
        virtualBlockId: string
        originalBlockId: string
        dependencies: string[]
        isExecuted: boolean
      }
    >()

    // Build dependency graph for this iteration - only include blocks that should execute
    for (const nodeId of parallel.nodes) {
      const virtualBlockId = VirtualBlockUtils.generateParallelId(nodeId, parallelId, iteration)
      const isExecuted = context.executedBlocks.has(virtualBlockId)

      if (isExecuted) {
        continue // Skip already executed blocks
      }

      const block = this.actualWorkflow.blocks.find((b) => b.id === nodeId)
      if (!block || !block.enabled) continue

      // Check if this block should execute in this iteration based on conditional paths
      try {
        const shouldExecute = this.shouldBlockExecuteInParallelIteration(
          nodeId,
          parallelId,
          iteration,
          context
        )

        if (!shouldExecute) {
          continue
        }
      } catch (error) {
        // If path checking fails, default to processing the block to maintain existing behavior
        logger.warn(
          `Path check failed for block ${nodeId} in parallel ${parallelId}, iteration ${iteration}:`,
          error
        )
      }

      // Find dependencies within this iteration
      const incomingConnections = this.actualWorkflow.connections.filter(
        (conn) => conn.target === nodeId
      )

      const dependencies: string[] = []
      for (const conn of incomingConnections) {
        // Check if the source is within the same parallel
        if (parallel.nodes.includes(conn.source)) {
          const sourceDependencyId = VirtualBlockUtils.generateParallelId(
            conn.source,
            parallelId,
            iteration
          )
          dependencies.push(sourceDependencyId)
        } else {
          // External dependency - check if it's met
          const isExternalDepMet = this.checkDependencies([conn], context.executedBlocks, context)
          if (!isExternalDepMet) {
            // External dependency not met, skip this block for now
            return
          }
        }
      }

      iterationBlocks.set(virtualBlockId, {
        virtualBlockId,
        originalBlockId: nodeId,
        dependencies,
        isExecuted,
      })
    }

    // Find blocks with no unmet dependencies within this iteration
    for (const [virtualBlockId, blockInfo] of iterationBlocks) {
      const unmetDependencies = blockInfo.dependencies.filter((depId) => {
        // Check if dependency is executed OR not in this iteration (external)
        return !context.executedBlocks.has(depId) && iterationBlocks.has(depId)
      })

      if (unmetDependencies.length === 0) {
        // All dependencies within this iteration are met
        pendingBlocks.add(virtualBlockId)

        // Store mapping for virtual block
        if (!context.parallelBlockMapping) {
          context.parallelBlockMapping = new Map()
        }
        context.parallelBlockMapping.set(virtualBlockId, {
          originalBlockId: blockInfo.originalBlockId,
          parallelId: parallelId,
          iterationIndex: iteration,
        })
      }
    }
  }

  /**
   * Checks if all dependencies for a block are met.
   * Handles special cases for different connection types.
   *
   * @param incomingConnections - Connections coming into the block
   * @param executedBlocks - Set of executed block IDs
   * @param context - Execution context
   * @param insideParallel - ID of parallel block if this block is inside one
   * @param iterationIndex - Index of the parallel iteration if applicable
   * @returns Whether all dependencies are met
   */
  private checkDependencies(
    incomingConnections: any[],
    executedBlocks: Set<string>,
    context: ExecutionContext,
    insideParallel?: string,
    iterationIndex?: number
  ): boolean {
    if (incomingConnections.length === 0) {
      return true
    }
    // Check if this is a loop block
    const isLoopBlock = incomingConnections.some((conn) => {
      const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
      return sourceBlock?.metadata?.id === BlockType.LOOP
    })

    if (isLoopBlock) {
      // Loop blocks are treated as regular blocks with standard dependency checking
      return incomingConnections.every((conn) => {
        const sourceExecuted = executedBlocks.has(conn.source)
        const sourceBlockState = context.blockStates.get(conn.source)
        const hasSourceError = sourceBlockState?.output?.error !== undefined

        // For error connections, check if the source had an error
        if (conn.sourceHandle === 'error') {
          return sourceExecuted && hasSourceError
        }

        // For regular connections, check if the source was executed without error
        if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
          return sourceExecuted && !hasSourceError
        }

        // If source is not in active path, consider this dependency met
        if (!context.activeExecutionPath.has(conn.source)) {
          return true
        }

        // For regular blocks, dependency is met if source is executed
        return sourceExecuted
      })
    }
    // Regular non-loop block handling
    return incomingConnections.every((conn) => {
      // For virtual blocks inside parallels, check the source appropriately
      let sourceId = conn.source
      if (insideParallel !== undefined && iterationIndex !== undefined) {
        // If the source is also inside the same parallel, use virtual ID
        const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
        if (
          sourceBlock &&
          this.actualWorkflow.parallels?.[insideParallel]?.nodes.includes(conn.source)
        ) {
          sourceId = VirtualBlockUtils.generateParallelId(
            conn.source,
            insideParallel,
            iterationIndex
          )
        }
      }

      const sourceExecuted = executedBlocks.has(sourceId)
      const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
      const sourceBlockState =
        context.blockStates.get(sourceId) || context.blockStates.get(conn.source)
      const hasSourceError = sourceBlockState?.output?.error !== undefined

      // Special handling for loop-start-source connections
      if (conn.sourceHandle === 'loop-start-source') {
        // This block is connected to a loop's start output
        // It should be activated when the loop block executes
        return sourceExecuted
      }

      // Special handling for loop-end-source connections
      if (conn.sourceHandle === 'loop-end-source') {
        // This block is connected to a loop's end output
        // It should only be activated when the loop completes
        const loopCompleted = context.completedLoops.has(conn.source)
        return loopCompleted
      }

      // Special handling for parallel-start-source connections
      if (conn.sourceHandle === 'parallel-start-source') {
        // This block is connected to a parallel's start output
        // It should be activated when the parallel block executes
        return executedBlocks.has(conn.source)
      }

      // Special handling for parallel-end-source connections
      if (conn.sourceHandle === 'parallel-end-source') {
        // This block is connected to a parallel's end output
        // It should only be activated when the parallel completes
        const parallelCompleted = context.completedLoops.has(conn.source)
        return parallelCompleted
      }

      // For condition blocks, check if this is the selected path
      if (conn.sourceHandle?.startsWith('condition-')) {
        const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
        if (sourceBlock?.metadata?.id === BlockType.CONDITION) {
          const conditionId = conn.sourceHandle.replace('condition-', '')
          const selectedCondition = context.decisions.condition.get(conn.source)

          // If source is executed and this is not the selected path, treat as "not applicable"
          // This allows blocks with multiple condition paths to execute via any selected path
          if (sourceExecuted && selectedCondition && conditionId !== selectedCondition) {
            return true // Changed from false to true - unselected paths don't block execution
          }

          // This dependency is met only if source is executed and this is the selected path
          return sourceExecuted && conditionId === selectedCondition
        }
      }

      // For router blocks, check if this is the selected target
      if (sourceBlock?.metadata?.id === BlockType.ROUTER) {
        const selectedTarget = context.decisions.router.get(conn.source)

        // If source is executed and this is not the selected target, dependency is NOT met
        if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
          return false
        }

        // Otherwise, this dependency is met only if source is executed and this is the selected target
        return sourceExecuted && conn.target === selectedTarget
      }

      // If source is not in active path, consider this dependency met
      // This allows blocks with multiple inputs to execute even if some inputs are from inactive paths
      if (!context.activeExecutionPath.has(conn.source)) {
        return true
      }

      // For error connections, check if the source had an error
      if (conn.sourceHandle === 'error') {
        return sourceExecuted && hasSourceError
      }

      // For regular connections, check if the source was executed without error
      if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
        return sourceExecuted && !hasSourceError
      }

      // For regular blocks, dependency is met if source is executed
      return sourceExecuted
    })
  }

  /**
   * Executes a layer of blocks in parallel.
   * Updates execution paths based on router and condition decisions.
   *
   * @param blockIds - IDs of blocks to execute
   * @param context - Current execution context
   * @returns Array of block outputs
   */
  private async executeLayer(
    blockIds: string[],
    context: ExecutionContext
  ): Promise<(NormalizedBlockOutput | StreamingExecution)[]> {
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      // Set all blocks in this layer as active
      const activeBlockIds = new Set(blockIds)

      // For virtual block IDs (parallel execution), also add the actual block ID so it appears as executing as well in the UI
      blockIds.forEach((blockId) => {
        if (context.parallelBlockMapping?.has(blockId)) {
          const parallelInfo = context.parallelBlockMapping.get(blockId)
          if (parallelInfo) {
            activeBlockIds.add(parallelInfo.originalBlockId)
          }
        }
      })

      // Only manage active blocks for parent executions
      if (!this.isChildExecution) {
        setActiveBlocks(activeBlockIds)
      }

      const settledResults = await Promise.allSettled(
        blockIds.map((blockId) => this.executeBlock(blockId, context))
      )

      // Extract successful results and collect any errors
      const results: (NormalizedBlockOutput | StreamingExecution)[] = []
      const errors: Error[] = []

      settledResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          errors.push(result.reason)
          // For failed blocks, we still need to add a placeholder result
          // so the results array matches the blockIds array length
          results.push({
            error: result.reason?.message || 'Block execution failed',
            status: 500,
          })
        }
      })

      // If there were any errors, log them but don't throw immediately
      // This allows successful blocks to complete their streaming
      if (errors.length > 0) {
        logger.warn(
          `Layer execution completed with ${errors.length} failed blocks out of ${blockIds.length} total`
        )

        // Only throw if ALL blocks failed
        if (errors.length === blockIds.length) {
          throw errors[0] // Throw the first error if all blocks failed
        }
      }

      blockIds.forEach((blockId) => {
        context.executedBlocks.add(blockId)
      })

      this.pathTracker.updateExecutionPaths(blockIds, context)

      return results
    } catch (error) {
      // If there's an uncaught error, clear all active blocks as a safety measure
      // Only manage active blocks for parent executions
      if (!this.isChildExecution) {
        setActiveBlocks(new Set())
      }
      throw error
    }
  }

  /**
   * Executes a single block with error handling and logging.
   * Handles virtual block IDs for parallel iterations.
   *
   * @param blockId - ID of the block to execute (may be a virtual ID)
   * @param context - Current execution context
   * @returns Normalized block output
   * @throws Error if block execution fails
   */
  private async executeBlock(
    blockId: string,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput | StreamingExecution> {
    // Check if this is a virtual block ID for parallel execution
    let actualBlockId = blockId
    let parallelInfo:
      | { originalBlockId: string; parallelId: string; iterationIndex: number }
      | undefined

    if (context.parallelBlockMapping?.has(blockId)) {
      parallelInfo = context.parallelBlockMapping.get(blockId)
      actualBlockId = parallelInfo!.originalBlockId

      // Set the current virtual block ID in context so resolver can access it
      context.currentVirtualBlockId = blockId

      // Set up iteration-specific context BEFORE resolving inputs
      if (parallelInfo) {
        this.parallelManager.setupIterationContext(context, parallelInfo)
      }
    } else {
      // Clear currentVirtualBlockId for non-virtual blocks
      context.currentVirtualBlockId = undefined
    }

    const block = this.actualWorkflow.blocks.find((b) => b.id === actualBlockId)
    if (!block) {
      throw new Error(`Block ${actualBlockId} not found`)
    }

    // Special case for starter block - it's already been initialized in createExecutionContext
    // This ensures we don't re-execute the starter block and just return its existing state
    if (block.metadata?.id === BlockType.STARTER) {
      const starterState = context.blockStates.get(actualBlockId)
      if (starterState) {
        return starterState.output as NormalizedBlockOutput
      }
    }

    const blockLog = this.createBlockLog(block)
    // Use virtual block ID in logs if applicable
    if (parallelInfo) {
      blockLog.blockId = blockId
      blockLog.blockName = `${block.metadata?.name || ''} (iteration ${parallelInfo.iterationIndex + 1})`
    } else {
      const containingLoopId = this.resolver.getContainingLoopId(block.id)
      if (containingLoopId) {
        const currentIteration = context.loopIterations.get(containingLoopId)
        if (currentIteration !== undefined) {
          blockLog.blockName = `${block.metadata?.name || ''} (iteration ${currentIteration})`
        }
      }
    }

    const addConsole = useConsoleStore.getState().addConsole

    try {
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      // Check if this block needs the starter block's output
      // This is especially relevant for API, function, and conditions that might reference <start.input>
      const starterBlock = this.actualWorkflow.blocks.find(
        (b) => b.metadata?.id === BlockType.STARTER
      )
      if (starterBlock) {
        const starterState = context.blockStates.get(starterBlock.id)
        if (!starterState) {
          logger.warn(
            `Starter block state not found when executing ${block.metadata?.name || actualBlockId}. This may cause reference errors.`
          )
        }
      }

      // Store raw input configuration first for error debugging
      blockLog.input = block.config.params

      // Resolve inputs (which will look up references to other blocks including starter)
      const inputs = this.resolver.resolveInputs(block, context)

      // Store input data in the block log
      blockLog.input = inputs

      // Track block execution start
      trackWorkflowTelemetry('block_execution_start', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        inputSize: Object.keys(inputs).length,
        startTime: new Date().toISOString(),
      })

      // Find the appropriate handler
      const handler = this.blockHandlers.find((h) => h.canHandle(block))
      if (!handler) {
        throw new Error(`No handler found for block type: ${block.metadata?.id}`)
      }
      logger.info(`Using handler ${handler.constructor.name} for block ${block.metadata?.id}`)
      
      if (block.metadata?.id === 'wait') {
        logger.info('Wait block configuration:', {
          tool: block.config.tool,
          params: block.config.params,
          metadata: block.metadata
        })
      }

      // Execute the block
      const startTime = performance.now()
      let rawOutput
      try {
        rawOutput = await handler.execute(block, inputs, context)
      } catch (handlerError) {
        logger.error(`Handler error for ${block.metadata?.id}:`, handlerError)
        throw handlerError
      }
      const executionTime = performance.now() - startTime

      // Remove this block from active blocks immediately after execution
      // This ensures the pulse effect stops as soon as the block completes
      // Only manage active blocks for parent executions
      if (!this.isChildExecution) {
        useExecutionStore.setState((state) => {
          const updatedActiveBlockIds = new Set(state.activeBlockIds)
          updatedActiveBlockIds.delete(blockId)

          // For virtual blocks, also check if we should remove the actual block ID
          if (parallelInfo) {
            // Check if there are any other virtual blocks for the same actual block still active
            const hasOtherVirtualBlocks = Array.from(state.activeBlockIds).some((activeId) => {
              if (activeId === blockId) return false // Skip the current block we're removing
              const mapping = context.parallelBlockMapping?.get(activeId)
              return mapping && mapping.originalBlockId === parallelInfo.originalBlockId
            })

            // If no other virtual blocks are active for this actual block, remove the actual block ID too
            if (!hasOtherVirtualBlocks) {
              updatedActiveBlockIds.delete(parallelInfo.originalBlockId)
            }
          }

          return { activeBlockIds: updatedActiveBlockIds }
        })
      }

      if (
        rawOutput &&
        typeof rawOutput === 'object' &&
        'stream' in rawOutput &&
        'execution' in rawOutput
      ) {
        const streamingExec = rawOutput as StreamingExecution
        const output = (streamingExec.execution as any).output as NormalizedBlockOutput

        context.blockStates.set(blockId, {
          output,
          executed: true,
          executionTime,
        })

        // Also store under the actual block ID for reference
        if (parallelInfo) {
          // Store iteration result in parallel state
          this.parallelManager.storeIterationResult(
            context,
            parallelInfo.parallelId,
            parallelInfo.iterationIndex,
            output
          )
        }

        // Store result for loops (IDENTICAL to parallel logic)
        const containingLoopId = this.resolver.getContainingLoopId(block.id)
        if (containingLoopId && !parallelInfo) {
          // Only store for loops if not already in a parallel (avoid double storage)
          const currentIteration = context.loopIterations.get(containingLoopId)
          if (currentIteration !== undefined) {
            this.loopManager.storeIterationResult(
              context,
              containingLoopId,
              currentIteration - 1, // Convert to 0-based index
              output
            )
          }
        }

        // Update the execution log
        blockLog.success = true
        blockLog.output = output
        blockLog.durationMs = Math.round(executionTime)
        blockLog.endedAt = new Date().toISOString()

        // Handle child workflow logs integration
        this.integrateChildWorkflowLogs(block, output)

        context.blockLogs.push(blockLog)

        // Skip console logging for infrastructure blocks and trigger blocks
        // For streaming blocks, we'll add the console entry after stream processing
        const blockConfig = getBlock(block.metadata?.id || '')
        const isTriggerBlock =
          blockConfig?.category === 'triggers' || block.metadata?.id === BlockType.STARTER
        if (
          block.metadata?.id !== BlockType.LOOP &&
          block.metadata?.id !== BlockType.PARALLEL &&
          !isTriggerBlock
        ) {
          // Determine iteration context for this block
          let iterationCurrent: number | undefined
          let iterationTotal: number | undefined
          let iterationType: 'loop' | 'parallel' | undefined
          const blockName = block.metadata?.name || 'Unnamed Block'

          if (parallelInfo) {
            // This is a parallel iteration
            const parallelState = context.parallelExecutions?.get(parallelInfo.parallelId)
            iterationCurrent = parallelInfo.iterationIndex + 1
            iterationTotal = parallelState?.parallelCount
            iterationType = 'parallel'
          } else {
            // Check if this block is inside a loop
            const containingLoopId = this.resolver.getContainingLoopId(block.id)
            if (containingLoopId) {
              const currentIteration = context.loopIterations.get(containingLoopId)
              const loop = context.workflow?.loops?.[containingLoopId]
              if (currentIteration !== undefined && loop) {
                iterationCurrent = currentIteration
                if (loop.loopType === 'forEach') {
                  // For forEach loops, get the total from the items
                  const forEachItems = context.loopItems.get(`${containingLoopId}_items`)
                  if (forEachItems) {
                    iterationTotal = Array.isArray(forEachItems)
                      ? forEachItems.length
                      : Object.keys(forEachItems).length
                  }
                } else {
                  // For regular loops, use the iterations count
                  iterationTotal = loop.iterations || 5
                }
                iterationType = 'loop'
              }
            }
          }

          addConsole({
            input: blockLog.input,
            output: blockLog.output,
            success: true,
            durationMs: blockLog.durationMs,
            startedAt: blockLog.startedAt,
            endedAt: blockLog.endedAt,
            workflowId: context.workflowId,
            blockId: parallelInfo ? blockId : block.id,
            executionId: this.contextExtensions.executionId,
            blockName,
            blockType: block.metadata?.id || 'unknown',
            iterationCurrent,
            iterationTotal,
            iterationType,
          })
        }

        trackWorkflowTelemetry('block_execution', {
          workflowId: context.workflowId,
          blockId: block.id,
          virtualBlockId: parallelInfo ? blockId : undefined,
          iterationIndex: parallelInfo?.iterationIndex,
          blockType: block.metadata?.id || 'unknown',
          blockName: block.metadata?.name || 'Unnamed Block',
          durationMs: Math.round(executionTime),
          success: true,
        })

        return streamingExec
      }

      // Handle error outputs and ensure object structure
      const output: NormalizedBlockOutput =
        rawOutput && typeof rawOutput === 'object' && rawOutput.error
          ? { error: rawOutput.error, status: rawOutput.status || 500 }
          : typeof rawOutput === 'object' && rawOutput !== null
            ? rawOutput
            : { result: rawOutput }

      // Update the context with the execution result
      // Use virtual block ID for parallel executions
      context.blockStates.set(blockId, {
        output,
        executed: true,
        executionTime,
      })

      // Also store under the actual block ID for reference
      if (parallelInfo) {
        // Store iteration result in parallel state
        this.parallelManager.storeIterationResult(
          context,
          parallelInfo.parallelId,
          parallelInfo.iterationIndex,
          output
        )
      }

      // Store result for loops (IDENTICAL to parallel logic)
      const containingLoopId = this.resolver.getContainingLoopId(block.id)
      if (containingLoopId && !parallelInfo) {
        // Only store for loops if not already in a parallel (avoid double storage)
        const currentIteration = context.loopIterations.get(containingLoopId)
        if (currentIteration !== undefined) {
          this.loopManager.storeIterationResult(
            context,
            containingLoopId,
            currentIteration - 1, // Convert to 0-based index
            output
          )
        }
      }

      // Update the execution log
      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()

      // Handle child workflow logs integration
      this.integrateChildWorkflowLogs(block, output)

      context.blockLogs.push(blockLog)

      // Skip console logging for infrastructure blocks and trigger blocks
      const nonStreamBlockConfig = getBlock(block.metadata?.id || '')
      const isNonStreamTriggerBlock =
        nonStreamBlockConfig?.category === 'triggers' || block.metadata?.id === BlockType.STARTER
      if (
        block.metadata?.id !== BlockType.LOOP &&
        block.metadata?.id !== BlockType.PARALLEL &&
        !isNonStreamTriggerBlock
      ) {
        // Determine iteration context for this block
        let iterationCurrent: number | undefined
        let iterationTotal: number | undefined
        let iterationType: 'loop' | 'parallel' | undefined
        const blockName = block.metadata?.name || 'Unnamed Block'

        if (parallelInfo) {
          // This is a parallel iteration
          const parallelState = context.parallelExecutions?.get(parallelInfo.parallelId)
          iterationCurrent = parallelInfo.iterationIndex + 1
          iterationTotal = parallelState?.parallelCount
          iterationType = 'parallel'
        } else {
          // Check if this block is inside a loop
          const containingLoopId = this.resolver.getContainingLoopId(block.id)
          if (containingLoopId) {
            const currentIteration = context.loopIterations.get(containingLoopId)
            const loop = context.workflow?.loops?.[containingLoopId]
            if (currentIteration !== undefined && loop) {
              iterationCurrent = currentIteration
              if (loop.loopType === 'forEach') {
                // For forEach loops, get the total from the items
                const forEachItems = context.loopItems.get(`${containingLoopId}_items`)
                if (forEachItems) {
                  iterationTotal = Array.isArray(forEachItems)
                    ? forEachItems.length
                    : Object.keys(forEachItems).length
                }
              } else {
                // For regular loops, use the iterations count
                iterationTotal = loop.iterations || 5
              }
              iterationType = 'loop'
            }
          }
        }

        addConsole({
          input: blockLog.input,
          output: blockLog.output,
          success: true,
          durationMs: blockLog.durationMs,
          startedAt: blockLog.startedAt,
          endedAt: blockLog.endedAt,
          workflowId: context.workflowId,
          blockId: parallelInfo ? blockId : block.id,
          executionId: this.contextExtensions.executionId,
          blockName,
          blockType: block.metadata?.id || 'unknown',
          iterationCurrent,
          iterationTotal,
          iterationType,
        })
      }

      trackWorkflowTelemetry('block_execution', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        durationMs: Math.round(executionTime),
        success: true,
      })

      return output
    } catch (error: any) {
      // Remove this block from active blocks if there's an error
      // Only manage active blocks for parent executions
      if (!this.isChildExecution) {
        useExecutionStore.setState((state) => {
          const updatedActiveBlockIds = new Set(state.activeBlockIds)
          updatedActiveBlockIds.delete(blockId)

          // For virtual blocks, also check if we should remove the actual block ID
          if (parallelInfo) {
            // Check if there are any other virtual blocks for the same actual block still active
            const hasOtherVirtualBlocks = Array.from(state.activeBlockIds).some((activeId) => {
              if (activeId === blockId) return false // Skip the current block we're removing
              const mapping = context.parallelBlockMapping?.get(activeId)
              return mapping && mapping.originalBlockId === parallelInfo.originalBlockId
            })

            // If no other virtual blocks are active for this actual block, remove the actual block ID too
            if (!hasOtherVirtualBlocks) {
              updatedActiveBlockIds.delete(parallelInfo.originalBlockId)
            }
          }

          return { activeBlockIds: updatedActiveBlockIds }
        })
      }

      blockLog.success = false
      blockLog.error =
        error.message ||
        `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs =
        new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()

      // If this error came from a child workflow execution, persist its trace spans on the log
      if (block.metadata?.id === BlockType.WORKFLOW) {
        this.attachChildWorkflowSpansToLog(blockLog, error)
      }

      // Log the error even if we'll continue execution through error path
      context.blockLogs.push(blockLog)

      // Skip console logging for infrastructure blocks and trigger blocks
      const errorBlockConfig = getBlock(block.metadata?.id || '')
      const isErrorTriggerBlock =
        errorBlockConfig?.category === 'triggers' || block.metadata?.id === BlockType.STARTER
      if (
        block.metadata?.id !== BlockType.LOOP &&
        block.metadata?.id !== BlockType.PARALLEL &&
        !isErrorTriggerBlock
      ) {
        // Determine iteration context for this block
        let iterationCurrent: number | undefined
        let iterationTotal: number | undefined
        let iterationType: 'loop' | 'parallel' | undefined
        const blockName = block.metadata?.name || 'Unnamed Block'

        if (parallelInfo) {
          // This is a parallel iteration
          const parallelState = context.parallelExecutions?.get(parallelInfo.parallelId)
          iterationCurrent = parallelInfo.iterationIndex + 1
          iterationTotal = parallelState?.parallelCount
          iterationType = 'parallel'
        } else {
          // Check if this block is inside a loop
          const containingLoopId = this.resolver.getContainingLoopId(block.id)
          if (containingLoopId) {
            const currentIteration = context.loopIterations.get(containingLoopId)
            const loop = context.workflow?.loops?.[containingLoopId]
            if (currentIteration !== undefined && loop) {
              iterationCurrent = currentIteration
              if (loop.loopType === 'forEach') {
                // For forEach loops, get the total from the items
                const forEachItems = context.loopItems.get(`${containingLoopId}_items`)
                if (forEachItems) {
                  iterationTotal = Array.isArray(forEachItems)
                    ? forEachItems.length
                    : Object.keys(forEachItems).length
                }
              } else {
                // For regular loops, use the iterations count
                iterationTotal = loop.iterations || 5
              }
              iterationType = 'loop'
            }
          }
        }

        addConsole({
          input: blockLog.input,
          output: {},
          success: false,
          error:
            error.message ||
            `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`,
          durationMs: blockLog.durationMs,
          startedAt: blockLog.startedAt,
          endedAt: blockLog.endedAt,
          workflowId: context.workflowId,
          blockId: parallelInfo ? blockId : block.id,
          executionId: this.contextExtensions.executionId,
          blockName,
          blockType: block.metadata?.id || 'unknown',
          iterationCurrent,
          iterationTotal,
          iterationType,
        })
      }

      // Check for error connections and follow them if they exist
      const hasErrorPath = this.activateErrorPath(actualBlockId, context)

      // Log the error for visibility
      logger.error(
        `Error executing block ${block.metadata?.name || actualBlockId}:`,
        this.sanitizeError(error)
      )

      // Create error output with appropriate structure
      const errorOutput: NormalizedBlockOutput = {
        error: this.extractErrorMessage(error),
        status: error.status || 500,
      }

      // Preserve child workflow spans on the block state so downstream logging can render them
      if (block.metadata?.id === BlockType.WORKFLOW) {
        this.attachChildWorkflowSpansToOutput(errorOutput, error)
      }

      // Set block state with error output
      context.blockStates.set(blockId, {
        output: errorOutput,
        executed: true,
        executionTime: blockLog.durationMs,
      })

      // If there are error paths to follow, return error output instead of throwing
      if (hasErrorPath) {
        // Return the error output to allow execution to continue along error path
        return errorOutput
      }

      // Create a proper error message that is never undefined
      let errorMessage = error.message

      // Handle the specific "undefined (undefined)" case
      if (!errorMessage || errorMessage === 'undefined (undefined)') {
        errorMessage = `Error executing ${block.metadata?.id || 'unknown'} block: ${block.metadata?.name || 'Unnamed Block'}`

        // Try to get more details if possible
        if (error && typeof error === 'object') {
          if (error.code) errorMessage += ` (code: ${error.code})`
          if (error.status) errorMessage += ` (status: ${error.status})`
          if (error.type) errorMessage += ` (type: ${error.type})`
        }
      }

      trackWorkflowTelemetry('block_execution_error', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        durationMs: blockLog.durationMs,
        errorType: error.name || 'Error',
        errorMessage: this.extractErrorMessage(error),
      })

      throw new Error(errorMessage)
    }
  }

  /**
   * Copies child workflow trace spans from an error object into a block log.
   * Ensures consistent structure and avoids duplication of inline guards.
   */
  private attachChildWorkflowSpansToLog(blockLog: BlockLog, error: unknown): void {
    const spans = (
      error as { childTraceSpans?: TraceSpan[]; childWorkflowName?: string } | null | undefined
    )?.childTraceSpans
    if (Array.isArray(spans) && spans.length > 0) {
      blockLog.output = {
        ...(blockLog.output || {}),
        childTraceSpans: spans,
        childWorkflowName: (error as { childWorkflowName?: string } | null | undefined)
          ?.childWorkflowName,
      }
    }
  }

  /**
   * Copies child workflow trace spans from an error object into a normalized output.
   */
  private attachChildWorkflowSpansToOutput(output: NormalizedBlockOutput, error: unknown): void {
    const spans = (
      error as { childTraceSpans?: TraceSpan[]; childWorkflowName?: string } | null | undefined
    )?.childTraceSpans
    if (Array.isArray(spans) && spans.length > 0) {
      output.childTraceSpans = spans
      output.childWorkflowName = (
        error as { childWorkflowName?: string } | null | undefined
      )?.childWorkflowName
    }
  }

  /**
   * Activates error paths from a block that had an error.
   * Checks for connections from the block's "error" handle and adds them to the active execution path.
   *
   * @param blockId - ID of the block that had an error
   * @param context - Current execution context
   * @returns Whether there was an error path to follow
   */
  private activateErrorPath(blockId: string, context: ExecutionContext): boolean {
    // Skip for starter blocks which don't have error handles
    const block = this.actualWorkflow.blocks.find((b) => b.id === blockId)
    if (
      block?.metadata?.id === BlockType.STARTER ||
      block?.metadata?.id === BlockType.CONDITION ||
      block?.metadata?.id === BlockType.LOOP ||
      block?.metadata?.id === BlockType.PARALLEL
    ) {
      return false
    }

    // Look for connections from this block's error handle
    const errorConnections = this.actualWorkflow.connections.filter(
      (conn) => conn.source === blockId && conn.sourceHandle === 'error'
    )

    if (errorConnections.length === 0) {
      return false
    }

    // Add all error connection targets to the active execution path
    for (const conn of errorConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.info(`Activated error path from ${blockId} to ${conn.target}`)
    }

    return true
  }

  /**
   * Creates a new block log entry with initial values.
   *
   * @param block - Block to create log for
   * @returns Initialized block log
   */
  private createBlockLog(block: SerializedBlock): BlockLog {
    return {
      blockId: block.id,
      blockName: block.metadata?.name || '',
      blockType: block.metadata?.id || '',
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }
  }

  /**
   * Extracts a meaningful error message from any error object structure.
   * Handles nested error objects, undefined messages, and various error formats.
   *
   * @param error - The error object to extract a message from
   * @returns A meaningful error message string
   */
  private extractErrorMessage(error: any): string {
    // If it's already a string, return it
    if (typeof error === 'string') {
      return error
    }

    // If it has a message property, use that
    if (error.message) {
      return error.message
    }

    // If it's an object with response data, include that
    if (error.response?.data) {
      const data = error.response.data
      if (typeof data === 'string') {
        return data
      }
      if (data.message) {
        return data.message
      }
      return JSON.stringify(data)
    }

    // If it's an object, stringify it
    if (typeof error === 'object') {
      return JSON.stringify(error)
    }

    // Fallback to string conversion
    return String(error)
  }

  /**
   * Sanitizes an error object for logging purposes.
   * Ensures the error is in a format that won't cause "undefined" to appear in logs.
   *
   * @param error - The error object to sanitize
   * @returns A sanitized version of the error for logging
   */
  private sanitizeError(error: any): any {
    // If it's already a string, return it
    if (typeof error === 'string') {
      return error
    }

    // If it has a message property, return that
    if (error.message) {
      return error.message
    }

    // If it's an object with response data, include that
    if (error.response?.data) {
      const data = error.response.data
      if (typeof data === 'string') {
        return data
      }
      if (data.message) {
        return data.message
      }
      return JSON.stringify(data)
    }

    // If it's an object, stringify it
    if (typeof error === 'object') {
      return JSON.stringify(error)
    }

    // Fallback to string conversion
    return String(error)
  }

  /**
   * Creates a block log for the starter block if it contains files.
   * This ensures files are captured in trace spans and execution logs.
   */
  private createStartedBlockWithFilesLog(
    initBlock: SerializedBlock,
    blockOutput: any,
    context: ExecutionContext
  ): void {
    if (blockOutput.files && Array.isArray(blockOutput.files) && blockOutput.files.length > 0) {
      const starterBlockLog: BlockLog = {
        blockId: initBlock.id,
        blockName: initBlock.metadata?.name || 'Start',
        blockType: initBlock.metadata?.id || 'start',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        success: true,
        input: this.workflowInput,
        output: blockOutput,
        durationMs: 0,
      }
      context.blockLogs.push(starterBlockLog)
    }
  }

  /**
   * Preserves child workflow trace spans for proper nesting
   */
  private integrateChildWorkflowLogs(block: SerializedBlock, output: NormalizedBlockOutput): void {
    if (block.metadata?.id !== BlockType.WORKFLOW) {
      return
    }

    if (!output || typeof output !== 'object' || !output.childTraceSpans) {
      return
    }

    const childTraceSpans = output.childTraceSpans as TraceSpan[]
    if (!Array.isArray(childTraceSpans) || childTraceSpans.length === 0) {
      return
    }
  }
}
