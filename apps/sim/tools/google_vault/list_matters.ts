import type { ToolConfig } from '@/tools/types'

export interface GoogleVaultListMattersParams {
  accessToken: string
  pageSize?: number
  pageToken?: string
  view?: 'MATTER_VIEW_UNSPECIFIED' | 'BASIC' | 'FULL'
  state?: 'STATE_UNSPECIFIED' | 'OPEN' | 'CLOSED' | 'DELETED'
  matterId?: string // Optional get for a specific matter
}

// matters.list (and optional matters.get when matterId provided)
// GET https://vault.googleapis.com/v1/matters
export const listMattersTool: ToolConfig<GoogleVaultListMattersParams> = {
  id: 'list_matters',
  name: 'Vault List Matters',
  description: 'List matters, or get a specific matter if matterId is provided',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
    additionalScopes: ['https://www.googleapis.com/auth/ediscovery'],
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    pageSize: { type: 'number', required: false, visibility: 'user-only' },
    pageToken: { type: 'string', required: false, visibility: 'hidden' },
    view: { type: 'string', required: false, visibility: 'user-or-llm' },
    state: { type: 'string', required: false, visibility: 'user-or-llm' },
    matterId: { type: 'string', required: false, visibility: 'user-or-llm' },
  },

  request: {
    url: (params) => {
      if (params.matterId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}`
      }
      const url = new URL('https://vault.googleapis.com/v1/matters')
      if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.view) url.searchParams.set('view', params.view)
      if (params.state) url.searchParams.set('state', params.state)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list matters')
    }
    return { success: true, output: data }
  },
}
