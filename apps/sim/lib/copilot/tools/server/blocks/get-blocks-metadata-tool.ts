import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { tools as toolsRegistry } from '@/tools/registry'
import { TRIGGER_REGISTRY } from '@/triggers'

export interface CopilotSubblockMetadata {
  id: string
  type: string
  title?: string
  required?: boolean
  description?: string
}

export interface CopilotToolMetadata {
  id: string
  name: string
  description?: string
  inputs?: any
  outputs?: any
}

export interface CopilotTriggerMetadata {
  id: string
  outputs?: any
}

export interface CopilotBlockMetadata {
  id: string
  name: string
  description: string
  inputs: Record<string, any>
  outputs: Record<string, any>
  triggerAllowed?: boolean
  authType?: 'OAuth' | 'API Key' | 'Bot Token'
  tools: CopilotToolMetadata[]
  triggers: CopilotTriggerMetadata[]
  parameters: CopilotSubblockMetadata[]
  yamlDocumentation?: string
}

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: 'get_blocks_metadata',
  async execute({
    blockIds,
  }: ReturnType<typeof GetBlocksMetadataInput.parse>): Promise<
    ReturnType<typeof GetBlocksMetadataResult.parse>
  > {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockIds?.length })

    const result: Record<string, CopilotBlockMetadata> = {}
    for (const blockId of blockIds || []) {
      let metadata: any

      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        const specialBlock = SPECIAL_BLOCKS_METADATA[blockId]
        metadata = {
          ...specialBlock,
          tools: [],
          triggers: [],
          parameters: specialBlock.subBlocks ? specialBlock.subBlocks.map(simplifySubBlock) : [],
        }(metadata as any).subBlocks = undefined
      } else {
        const blockConfig: BlockConfig | undefined = (blockRegistry as any)[blockId]
        if (!blockConfig) {
          logger.debug('Block not found in registry', { blockId })
          continue
        }

        if (blockConfig.hideFromToolbar) {
          logger.debug('Skipping block hidden from toolbar', { blockId })
          continue
        }
        const tools: CopilotToolMetadata[] = Array.isArray(blockConfig.tools?.access)
          ? blockConfig.tools!.access.map((toolId) => {
              const tool: any = (toolsRegistry as any)[toolId]
              if (!tool) return { id: toolId, name: toolId }
              return {
                id: toolId,
                name: tool.name || toolId,
                description: tool.description || '',
                inputs: tool.params || {},
                outputs: tool.outputs || {},
              }
            })
          : []

        const triggers: CopilotTriggerMetadata[] = []
        const availableTriggerIds = blockConfig.triggers?.available || []
        for (const tid of availableTriggerIds) {
          const trig = TRIGGER_REGISTRY[tid]
          triggers.push({
            id: tid,
            outputs: trig?.outputs || {},
          })
        }

        const parameters: CopilotSubblockMetadata[] = Array.isArray(blockConfig.subBlocks)
          ? blockConfig.subBlocks.map(simplifySubBlock)
          : []

        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.longDescription || blockConfig.description || '',
          inputs: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          triggerAllowed: !!blockConfig.triggerAllowed,
          authType: resolveAuthType(blockConfig.authMode),
          tools,
          triggers,
          parameters,
        }
      }

      try {
        const workingDir = process.cwd()
        const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
        const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
        const docPath = join(
          basePath,
          'apps',
          'docs',
          'content',
          'docs',
          'yaml',
          'blocks',
          `${DOCS_FILE_MAPPING[blockId] || blockId}.mdx`
        )
        if (existsSync(docPath)) {
          metadata.yamlDocumentation = readFileSync(docPath, 'utf-8')
        }
      } catch {}

      if (metadata) {
        result[blockId] = metadata as CopilotBlockMetadata
      }
    }

    return GetBlocksMetadataResult.parse({ metadata: result })
  },
}

function simplifySubBlock(sb: any): CopilotSubblockMetadata {
  const simplified: CopilotSubblockMetadata = {
    id: sb.id,
    type: sb.type,
  }
  if (sb.title) simplified.title = sb.title
  if (sb.required) simplified.required = sb.required
  if (sb.description) simplified.description = sb.description
  return simplified
}

function resolveAuthType(
  authMode: AuthMode | undefined
): 'OAuth' | 'API Key' | 'Bot Token' | undefined {
  if (!authMode) return undefined
  if (authMode === AuthMode.OAuth) return 'OAuth'
  if (authMode === AuthMode.ApiKey) return 'API Key'
  if (authMode === AuthMode.BotToken) return 'Bot Token'
  return undefined
}

const DOCS_FILE_MAPPING: Record<string, string> = {}

const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    id: 'loop',
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
    id: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    inputs: {
      parallelType: { type: 'string', required: true, enum: ['count', 'collection'] },
      count: { type: 'number', required: false, minimum: 1, maximum: 100 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 10, minimum: 1, maximum: 50 },
    },
    outputs: { results: 'array', branchId: 'number', branchItem: 'any', totalBranches: 'number' },
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
