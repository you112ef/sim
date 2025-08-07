import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'
import { BaseCopilotTool } from '../base'

const logger = createLogger('[GBMF] GetBlockMetadataAPI')

interface GetBlocksMetadataParams {
  blockIds: string[]
}

interface BlocksMetadataResult {
  success: boolean
  data?: Record<string, any>
  error?: string
}

class GetBlocksMetadataTool extends BaseCopilotTool<GetBlocksMetadataParams, BlocksMetadataResult> {
  readonly id = 'get_blocks_metadata'
  readonly displayName = 'Getting block metadata'

  protected async executeImpl(params: GetBlocksMetadataParams): Promise<BlocksMetadataResult> {
    return getBlocksMetadata(params)
  }
}

// Export the tool instance
export const getBlocksMetadataTool = new GetBlocksMetadataTool()

/**
 * Safely resolve subblock options, handling both static arrays and functions
 */
function resolveSubBlockOptions(options: any): any[] {
  logger.debug('[GBMF] Resolving subblock options', { 
    optionsType: typeof options,
    isFunction: typeof options === 'function',
    isArray: Array.isArray(options)
  })
  
  try {
    if (typeof options === 'function') {
      logger.debug('[GBMF] Executing options function to resolve dynamic options')
      const resolved = options()
      const isResolvedArray = Array.isArray(resolved)
      logger.debug('[GBMF] Options function executed', {
        resolvedType: typeof resolved,
        isArray: isResolvedArray,
        length: isResolvedArray ? resolved.length : 0
      })
      return isResolvedArray ? resolved : []
    }
    
    if (Array.isArray(options)) {
      logger.debug('[GBMF] Options is static array', { length: options.length })
      return options
    }
    
    logger.warn('[GBMF] Options is neither function nor array', { actualType: typeof options })
    return []
  } catch (error) {
    logger.error('[GBMF] Failed to resolve subblock options:', { 
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined 
    })
    return []
  }
}

/**
 * Process subBlocks configuration to include all UI metadata
 */
function processSubBlocks(subBlocks: any[]): any[] {
  logger.debug('[GBMF] Starting processSubBlocks', { 
    isArray: Array.isArray(subBlocks),
    length: Array.isArray(subBlocks) ? subBlocks.length : 0 
  })
  
  if (!Array.isArray(subBlocks)) {
    logger.warn('[GBMF] subBlocks is not an array, returning empty array')
    return []
  }

  return subBlocks.map((subBlock, index) => {
    logger.debug(`[GBMF] Processing subBlock [${index}]`, {
      id: subBlock.id,
      type: subBlock.type,
      title: subBlock.title,
      hasOptions: !!subBlock.options,
      hasCondition: !!subBlock.condition
    })
    
    const processedSubBlock: any = {
      id: subBlock.id,
      title: subBlock.title,
      type: subBlock.type,
      layout: subBlock.layout,
      mode: subBlock.mode,
      required: subBlock.required,
      placeholder: subBlock.placeholder,
      description: subBlock.description,
      hidden: subBlock.hidden,
      condition: subBlock.condition,
      // Slider specific
      min: subBlock.min,
      max: subBlock.max,
      step: subBlock.step,
      integer: subBlock.integer,
      // Input specific
      rows: subBlock.rows,
      password: subBlock.password,
      multiSelect: subBlock.multiSelect,
      // Code specific
      language: subBlock.language,
      generationType: subBlock.generationType,
      // OAuth specific
      provider: subBlock.provider,
      serviceId: subBlock.serviceId,
      requiredScopes: subBlock.requiredScopes,
      // File specific
      mimeType: subBlock.mimeType,
      acceptedTypes: subBlock.acceptedTypes,
      multiple: subBlock.multiple,
      maxSize: subBlock.maxSize,
      // Other properties
      connectionDroppable: subBlock.connectionDroppable,
      columns: subBlock.columns,
      value: typeof subBlock.value === 'function' ? 'function' : undefined, // Don't serialize functions
      wandConfig: subBlock.wandConfig,
    }

    // Resolve options if present
    if (subBlock.options) {
      logger.debug(`[GBMF] Resolving options for subBlock ${subBlock.id}`)
      try {
        const resolvedOptions = resolveSubBlockOptions(subBlock.options)
        logger.debug(`[GBMF] Resolved ${resolvedOptions.length} options for subBlock ${subBlock.id}`)
        
        processedSubBlock.options = resolvedOptions.map((option, optIndex) => {
          logger.debug(`[GBMF] Processing option [${optIndex}] for subBlock ${subBlock.id}`, {
            label: option.label,
            id: option.id,
            hasIcon: !!option.icon
          })
          
          return {
            label: option.label,
            id: option.id,
            // Note: Icons are React components, so we'll just indicate if they exist
            hasIcon: !!option.icon,
          }
        })
        
        logger.debug(`[GBMF] Successfully processed ${processedSubBlock.options.length} options for subBlock ${subBlock.id}`)
      } catch (error) {
        logger.error(`[GBMF] Failed to resolve options for subBlock ${subBlock.id}:`, {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined
        })
        processedSubBlock.options = []
      }
    }

    // Remove undefined properties to keep the response clean
    const filtered = Object.fromEntries(
      Object.entries(processedSubBlock).filter(([key, value]) => value !== undefined)
    )
    
    logger.debug(`[GBMF] Filtered subBlock ${subBlock.id} properties`, {
      originalKeys: Object.keys(processedSubBlock).length,
      filteredKeys: Object.keys(filtered).length,
      removedKeys: Object.keys(processedSubBlock).filter(k => processedSubBlock[k] === undefined)
    })
    
    return filtered
  })
}

// Implementation function
export async function getBlocksMetadata(
  params: GetBlocksMetadataParams
): Promise<BlocksMetadataResult> {
  logger.info('[GBMF] === START GET_BLOCKS_METADATA EXECUTION ===')
  logger.debug('[GBMF] Input params', { params })
  
  const { blockIds } = params

  if (!blockIds || !Array.isArray(blockIds)) {
    logger.error('[GBMF] Invalid blockIds parameter', { 
      blockIds,
      type: typeof blockIds,
      isArray: Array.isArray(blockIds)
    })
    return {
      success: false,
      error: 'blockIds must be an array of block IDs',
    }
  }

  logger.info('[GBMF] Getting block metadata', {
    blockIds,
    blockCount: blockIds.length,
    requestedBlocks: blockIds.join(', '),
  })

  try {
    // Create result object
    const result: Record<string, any> = {}

    logger.info('[GBMF] === GET BLOCKS METADATA DEBUG ===')
    logger.info('[GBMF] Requested block IDs:', blockIds)
    logger.debug('[GBMF] Block registry keys available:', Object.keys(blockRegistry).length)
    logger.debug('[GBMF] Special blocks available:', Object.keys(SPECIAL_BLOCKS_METADATA))

    // Process each requested block ID
    for (const blockId of blockIds) {
      logger.info(`[GBMF] \n--- Processing block: ${blockId} ---`)
      logger.debug(`[GBMF] Starting metadata collection for block: ${blockId}`)
      let metadata: any = {}

      // Check if it's a special block first
      const isSpecialBlock = !!SPECIAL_BLOCKS_METADATA[blockId]
      logger.debug(`[GBMF] Checking special blocks`, { 
        blockId, 
        isSpecialBlock,
        specialBlockKeys: isSpecialBlock ? Object.keys(SPECIAL_BLOCKS_METADATA[blockId]) : []
      })
      
      if (isSpecialBlock) {
        logger.info(`[GBMF] ✓ Found ${blockId} in SPECIAL_BLOCKS_METADATA`)
        // Start with the special block metadata
        metadata = { ...SPECIAL_BLOCKS_METADATA[blockId] }
        logger.debug(`[GBMF] Copied special block metadata`, {
          blockId,
          metadataKeys: Object.keys(metadata),
          hasTools: !!metadata.tools,
          toolsStructure: metadata.tools ? Object.keys(metadata.tools) : []
        })
        
        // Normalize tools structure to match regular blocks
        const originalTools = metadata.tools
        metadata.tools = metadata.tools?.access || []
        logger.debug(`[GBMF] Normalized tools for special block ${blockId}`, {
          originalToolsStructure: originalTools ? Object.keys(originalTools) : null,
          normalizedTools: metadata.tools,
          toolsCount: metadata.tools.length
        })
        
        logger.info(`[GBMF] Initial metadata keys for ${blockId}:`, Object.keys(metadata))
      } else {
        logger.debug(`[GBMF] Checking regular block registry for ${blockId}`)
        
        // Check if the block exists in the registry
        const blockConfig = blockRegistry[blockId]
        const blockExists = !!blockConfig
        
        logger.debug(`[GBMF] Block registry lookup for ${blockId}`, {
          found: blockExists,
          configKeys: blockExists ? Object.keys(blockConfig) : []
        })
        
        if (!blockConfig) {
          logger.warn(`[GBMF] Block not found in registry: ${blockId}`, {
            availableBlocks: Object.keys(blockRegistry).slice(0, 10) // Show first 10 for debugging
          })
          continue
        }

        logger.debug(`[GBMF] Building metadata for regular block ${blockId}`, {
          hasName: !!blockConfig.name,
          hasDescription: !!blockConfig.description,
          hasLongDescription: !!blockConfig.longDescription,
          hasCategory: !!blockConfig.category,
          hasBgColor: !!blockConfig.bgColor,
          hasInputs: !!blockConfig.inputs,
          hasOutputs: !!blockConfig.outputs,
          hasTools: !!blockConfig.tools,
          hasSubBlocks: !!blockConfig.subBlocks,
          inputsCount: blockConfig.inputs ? Object.keys(blockConfig.inputs).length : 0,
          outputsCount: blockConfig.outputs ? Object.keys(blockConfig.outputs).length : 0,
          subBlocksCount: blockConfig.subBlocks ? blockConfig.subBlocks.length : 0
        })

        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.description || '',
          longDescription: blockConfig.longDescription,
          category: blockConfig.category,
          bgColor: blockConfig.bgColor,
          inputs: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          tools: blockConfig.tools?.access || [],
          hideFromToolbar: blockConfig.hideFromToolbar,
        }

        logger.debug(`[GBMF] Basic metadata assembled for ${blockId}`, {
          metadataKeys: Object.keys(metadata),
          toolsCount: metadata.tools.length,
          inputKeys: Object.keys(metadata.inputs),
          outputKeys: Object.keys(metadata.outputs)
        })

        // Process and include subBlocks configuration
        if (blockConfig.subBlocks && Array.isArray(blockConfig.subBlocks)) {
          logger.info(`[GBMF] Processing ${blockConfig.subBlocks.length} subBlocks for ${blockId}`)
          logger.debug(`[GBMF] SubBlocks details for ${blockId}`, {
            count: blockConfig.subBlocks.length,
            subBlockIds: blockConfig.subBlocks.map((sb: any) => sb.id)
          })
          
          metadata.subBlocks = processSubBlocks(blockConfig.subBlocks)
          
          logger.info(`[GBMF] ✓ Processed subBlocks for ${blockId}:`, metadata.subBlocks.length)
          logger.debug(`[GBMF] SubBlocks processing complete for ${blockId}`, {
            processedCount: metadata.subBlocks.length,
            processedIds: metadata.subBlocks.map((sb: any) => sb.id)
          })
        } else {
          logger.info(`[GBMF] No subBlocks found for ${blockId}`)
          metadata.subBlocks = []
        }
      }

      // Read YAML schema from documentation if available (for both regular and special blocks)
      const docFileName = DOCS_FILE_MAPPING[blockId] || blockId
      const isInCoreBlocks = CORE_BLOCKS_WITH_DOCS.includes(blockId)
      
      logger.info(
        `[GBMF] Checking if ${blockId} is in CORE_BLOCKS_WITH_DOCS:`,
        isInCoreBlocks
      )
      logger.debug(`[GBMF] Documentation lookup for ${blockId}`, {
        docFileName,
        isInCoreBlocks,
        mappedFileName: DOCS_FILE_MAPPING[blockId] || 'none'
      })

      if (isInCoreBlocks) {
        logger.debug(`[GBMF] Attempting to load documentation for ${blockId}`)
        try {
          // Updated path to point to the actual YAML documentation location
          // Handle both monorepo root and apps/sim as working directory
          const workingDir = process.cwd()
          const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
          
          logger.debug(`[GBMF] Working directory info`, {
            workingDir,
            isInAppsSim,
            platform: process.platform
          })
          
          const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
          const docPath = join(
            basePath,
            'apps',
            'docs',
            'content',
            'docs',
            'yaml',
            'blocks',
            `${docFileName}.mdx`
          )
          
          logger.info(`[GBMF] Looking for docs at: ${docPath}`)
          const fileExists = existsSync(docPath)
          logger.info(`[GBMF] File exists: ${fileExists}`)

          if (fileExists) {
            logger.debug(`[GBMF] Reading documentation file for ${blockId}`)
            const docContent = readFileSync(docPath, 'utf-8')
            
            logger.info(`[GBMF] Doc content length: ${docContent.length}`)
            logger.debug(`[GBMF] Documentation content preview for ${blockId}`, {
              length: docContent.length,
              firstLine: docContent.split('\n')[0],
              lineCount: docContent.split('\n').length
            })

            // Include the entire YAML documentation content
            metadata.yamlDocumentation = docContent
            logger.info(`[GBMF] ✓ Added full YAML documentation for ${blockId}`)
          } else {
            logger.warn(`[GBMF] Documentation file not found for ${blockId}`, {
              searchedPath: docPath,
              workingDir,
              basePath
            })
          }
        } catch (error) {
          logger.error(`[GBMF] Failed to read documentation for ${blockId}:`, {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined
          })
        }
      } else {
        logger.info(`[GBMF] ${blockId} is NOT in CORE_BLOCKS_WITH_DOCS`, {
          availableCoreBlocks: CORE_BLOCKS_WITH_DOCS
        })
      }

      // Add tool metadata if requested
      if (metadata.tools && metadata.tools.length > 0) {
        logger.debug(`Processing ${metadata.tools.length} tools for block ${blockId}`)
        metadata.toolDetails = {}
        
        for (const toolId of metadata.tools) {
          logger.debug(`Looking up tool: ${toolId}`)
          const tool = toolsRegistry[toolId]
          
          if (tool) {
            logger.debug(`Found tool ${toolId}`, {
              name: tool.name,
              hasDescription: !!tool.description
            })
            
            metadata.toolDetails[toolId] = {
              name: tool.name,
              description: tool.description,
            }
          } else {
            logger.warn(`Tool ${toolId} not found in registry for block ${blockId}`)
          }
        }
        
        logger.debug(`Processed tool details for ${blockId}`, {
          requestedTools: metadata.tools.length,
          foundTools: Object.keys(metadata.toolDetails).length,
          missingTools: metadata.tools.filter((t: string) => !metadata.toolDetails[t])
        })
      } else {
        logger.debug(`No tools to process for block ${blockId}`)
      }

      logger.info(`Final metadata keys for ${blockId}:`, Object.keys(metadata))
      logger.info(`Has YAML documentation: ${!!metadata.yamlDocumentation}`)
      logger.info(`Has subBlocks: ${!!metadata.subBlocks && metadata.subBlocks.length > 0}`)
      
      logger.debug(`Complete metadata summary for ${blockId}`, {
        keys: Object.keys(metadata),
        yamlDocLength: metadata.yamlDocumentation ? metadata.yamlDocumentation.length : 0,
        subBlocksCount: metadata.subBlocks ? metadata.subBlocks.length : 0,
        toolsCount: metadata.tools ? metadata.tools.length : 0,
        toolDetailsCount: metadata.toolDetails ? Object.keys(metadata.toolDetails).length : 0,
        inputsCount: metadata.inputs ? Object.keys(metadata.inputs).length : 0,
        outputsCount: metadata.outputs ? Object.keys(metadata.outputs).length : 0
      })

      result[blockId] = metadata
      logger.debug(`Added ${blockId} to result object`)
    }

    logger.info('\n=== FINAL RESULT ===')
    logger.info(`Successfully retrieved metadata for ${Object.keys(result).length} blocks`)
    logger.info('Result keys:', Object.keys(result))
    
    logger.debug('Final result statistics', {
      totalBlocks: Object.keys(result).length,
      blocksWithYamlDocs: Object.keys(result).filter(k => result[k].yamlDocumentation).length,
      blocksWithSubBlocks: Object.keys(result).filter(k => result[k].subBlocks && result[k].subBlocks.length > 0).length,
      blocksWithTools: Object.keys(result).filter(k => result[k].tools && result[k].tools.length > 0).length
    })

    // Log the full result for parallel block if it's included
    if (result.parallel) {
      logger.info('\nParallel block metadata keys:', Object.keys(result.parallel))
      if (result.parallel.yamlDocumentation) {
        logger.info('YAML documentation length:', result.parallel.yamlDocumentation.length)
      }
      logger.debug('Parallel block details', {
        hasSubBlocks: !!result.parallel.subBlocks,
        subBlocksCount: result.parallel.subBlocks ? result.parallel.subBlocks.length : 0,
        toolsCount: result.parallel.tools ? result.parallel.tools.length : 0
      })
    }

    logger.info('=== END GET_BLOCKS_METADATA EXECUTION (SUCCESS) ===')
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    logger.error('Get block metadata failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      blockIds
    })
    logger.info('=== END GET_BLOCKS_METADATA EXECUTION (FAILURE) ===')
    return {
      success: false,
      error: `Failed to get block metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

// Core blocks that have documentation with YAML schemas
const CORE_BLOCKS_WITH_DOCS = [
  'agent',
  'function',
  'api',
  'condition',
  'loop',
  'parallel',
  'response',
  'router',
  'evaluator',
  'webhook',
]

// Mapping for blocks that have different doc file names
const DOCS_FILE_MAPPING: Record<string, string> = {
  // All core blocks use their registry ID as the doc filename
  // e.g., 'api' block -> 'api.mdx', 'agent' block -> 'agent.mdx'
}

// Special blocks that aren't in the standard registry but need metadata
const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    type: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    inputs: {
      loopType: { type: 'string', required: true, enum: ['for', 'forEach'] },
      iterations: { type: 'number', required: false, minimum: 1, maximum: 1000 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 1, minimum: 1, maximum: 10 },
    },
    outputs: {
      results: 'array',
      currentIndex: 'number',
      currentItem: 'any',
      totalIterations: 'number',
    },
    tools: { access: [] },
    subBlocks: [
      {
        id: 'loopType',
        title: 'Loop Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'For Loop (count)', id: 'for' },
          { label: 'For Each (collection)', id: 'forEach' },
        ],
      },
      {
        id: 'iterations',
        title: 'Iterations',
        type: 'slider',
        min: 1,
        max: 1000,
        integer: true,
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array or object to iterate over...',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 10,
        integer: true,
        default: 1,
      },
    ],
  },
  parallel: {
    type: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    inputs: {
      parallelType: { type: 'string', required: true, enum: ['count', 'collection'] },
      count: { type: 'number', required: false, minimum: 1, maximum: 100 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 10, minimum: 1, maximum: 50 },
    },
    outputs: {
      results: 'array',
      branchId: 'number',
      branchItem: 'any',
      totalBranches: 'number',
    },
    tools: { access: [] },
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Count (number)', id: 'count' },
          { label: 'Collection (array)', id: 'collection' },
        ],
      },
      {
        id: 'count',
        title: 'Count',
        type: 'slider',
        min: 1,
        max: 100,
        integer: true,
        condition: { field: 'parallelType', value: 'count' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array to process in parallel...',
        condition: { field: 'parallelType', value: 'collection' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 50,
        integer: true,
        default: 10,
      },
    ],
  },
}
