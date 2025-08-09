import { ApifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ApifyAllResponse } from '@/tools/apify/types'

export const ApifyBlock: BlockConfig<ApifyAllResponse> = {
  type: 'apify',
  name: 'Apify',
  description: 'Run web scraping and automation actors from Apify platform',
  longDescription:
    'Execute Apify Actors for web scraping, data extraction, and browser automation. Choose between synchronous runs (quick results) or asynchronous runs (for longer tasks with polling).',
  category: 'tools',
  bgColor: '#000000',
  icon: ApifyIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      required: true,
      options: [
        { label: 'Sync Run', id: 'sync_run' },
        { label: 'Sync Run (no input)', id: 'sync_get' },
        { label: 'Async Run', id: 'async_run' },
      ],
      value: () => 'sync_run',
    },
    {
      id: 'actorId',
      title: 'Actor ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., apify/web-scraper or web-scraper',
      required: true,
    },
    {
      id: 'input',
      title: 'Actor Input',
      type: 'code',
      layout: 'full',
      placeholder: '{"startUrls": [{"url": "https://example.com"}]}',
      required: false,
      condition: { field: 'operation', value: ['sync_run', 'async_run'] },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: '300 (max for sync)',
      required: false,
      condition: { field: 'operation', value: ['sync_run', 'sync_get'] },
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Limit results',
      required: false,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Apify API token',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: ['apify_sync_run', 'apify_sync_get', 'apify_async_run'],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'sync_run':
            return 'apify_sync_run'
          case 'sync_get':
            return 'apify_sync_get'
          case 'async_run':
            return 'apify_async_run'
          default:
            throw new Error('Invalid operation selected')
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Type of Actor run operation' },
    actorId: { type: 'string', description: 'Apify Actor ID or name' },
    apiKey: { type: 'string', description: 'Apify API token' },
    input: { type: 'json', description: 'Input data for the Actor' },
    timeout: { type: 'number', description: 'Timeout in seconds' },
    maxItems: { type: 'number', description: 'Maximum number of results' },
  },

  outputs: {
    data: { type: 'json', description: 'Actor output data or results' },
    runId: { type: 'string', description: 'ID of the Actor run' },
    actorId: { type: 'string', description: 'ID of the Actor that was run' },
    status: { type: 'string', description: 'Final status of the Actor run' },
    defaultDatasetId: { type: 'string', description: 'ID of the default dataset' },
    stats: { type: 'json', description: 'Runtime statistics' },
    usage: { type: 'json', description: 'Resource usage details' },
  },
}
