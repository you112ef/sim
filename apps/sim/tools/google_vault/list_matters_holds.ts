import type { GoogleVaultListMattersHoldsParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

export const listMattersHoldsTool: ToolConfig<GoogleVaultListMattersHoldsParams> = {
  id: 'list_matters_holds',
  name: 'Vault List Holds (by Matter)',
  description: 'List holds for a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
    additionalScopes: ['https://www.googleapis.com/auth/ediscovery'],
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-or-llm' },
    pageSize: { type: 'number', required: false, visibility: 'user-only' },
    view: { type: 'string', required: false, visibility: 'user-or-llm' },
    holdId: { type: 'string', required: false, visibility: 'user-or-llm' },
  },

  request: {
    url: (params) => {
      if (params.holdId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}/holds/${params.holdId}`
      }
      const url = new URL(`https://vault.googleapis.com/v1/matters/${params.matterId}/holds`)
      if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.view) url.searchParams.set('view', params.view)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list holds')
    }
    return { success: true, output: data }
  },
}
