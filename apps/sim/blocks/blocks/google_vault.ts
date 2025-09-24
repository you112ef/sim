import { GoogleVaultIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleVaultBlock: BlockConfig = {
  type: 'google_vault',
  name: 'Google Vault',
  description: 'Search, export, and manage holds/exports for Vault matters',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect Google Vault to create exports, list exports, and manage holds within matters.',
  docsLink: 'https://developers.google.com/vault',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleVaultIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Create Export', id: 'create_matters_export' },
        { label: 'List Exports', id: 'list_matters_export' },
        { label: 'Create Hold', id: 'create_matters_holds' },
        { label: 'List Holds', id: 'list_matters_holds' },
        { label: 'Create Matter', id: 'create_matters' },
        { label: 'List Matters', id: 'list_matters' },
      ],
      value: () => 'list_matters_export',
    },
    {
      id: 'credential',
      title: 'Google Vault Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'google-vault',
      serviceId: 'google-vault',
      requiredScopes: ['https://www.googleapis.com/auth/ediscovery'],
      placeholder: 'Select Google Vault account',
    },
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Matter ID',
      condition: () => ({
        field: 'operation',
        value: [
          'create_matters_export',
          'list_matters_export',
          'create_matters_holds',
          'list_matters_holds',
        ],
      }),
    },
    {
      id: 'exportId',
      title: 'Export ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Export ID (optional to fetch a specific export)',
      condition: { field: 'operation', value: 'list_matters_export' },
    },
    {
      id: 'holdId',
      title: 'Hold ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Hold ID (optional to fetch a specific hold)',
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of items to return',
      condition: { field: 'operation', value: 'list_matters_export' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Pagination token',
      condition: { field: 'operation', value: 'list_matters_export' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of holds to return (0-100)',
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Pagination token',
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    {
      id: 'view',
      title: 'Hold View',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Unspecified', id: 'HOLD_VIEW_UNSPECIFIED' },
        { label: 'Basic', id: 'BASIC_HOLD' },
        { label: 'Full', id: 'FULL_HOLD' },
      ],
      condition: { field: 'operation', value: 'list_matters_holds' },
    },
    // Create Matter fields
    {
      id: 'name',
      title: 'Matter Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Matter name',
      condition: { field: 'operation', value: 'create_matters' },
      required: true,
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional description for the matter',
      condition: { field: 'operation', value: 'create_matters' },
    },
    // List matters filters
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of matters to return',
      condition: { field: 'operation', value: 'list_matters' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Pagination token',
      condition: { field: 'operation', value: 'list_matters' },
    },
    {
      id: 'view',
      title: 'Matter View',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Unspecified', id: 'MATTER_VIEW_UNSPECIFIED' },
        { label: 'Basic', id: 'BASIC' },
        { label: 'Full', id: 'FULL' },
      ],
      condition: { field: 'operation', value: 'list_matters' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'All States', id: 'STATE_UNSPECIFIED' },
        { label: 'Open', id: 'OPEN' },
        { label: 'Closed', id: 'CLOSED' },
        { label: 'Deleted', id: 'DELETED' },
      ],
      condition: { field: 'operation', value: 'list_matters' },
    },
    // Optional get specific matter by ID
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Matter ID (optional to fetch a specific matter)',
      condition: { field: 'operation', value: 'list_matters' },
    },
  ],
  tools: {
    access: [
      'google_vault_create_matters_export',
      'google_vault_list_matters_export',
      'google_vault_create_matters_holds',
      'google_vault_list_matters_holds',
      'google_vault_create_matters',
      'google_vault_list_matters',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_matters_export':
            return 'google_vault_create_matters_export'
          case 'list_matters_export':
            return 'google_vault_list_matters_export'
          case 'create_matters_holds':
            return 'google_vault_create_matters_holds'
          case 'list_matters_holds':
            return 'google_vault_list_matters_holds'
          case 'create_matters':
            return 'google_vault_create_matters'
          case 'list_matters':
            return 'google_vault_list_matters'
          default:
            throw new Error(`Invalid Google Vault operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, ...rest } = params
        return {
          ...rest,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Vault OAuth credential' },
    matterId: { type: 'string', description: 'Matter ID' },
    exportId: { type: 'string', description: 'Export ID (optional for single fetch)' },
    holdId: { type: 'string', description: 'Hold ID (optional for single fetch)' },
    pageSize: { type: 'number', description: 'Page size for list operations' },
    pageToken: { type: 'string', description: 'Page token for pagination' },
    view: { type: 'string', description: 'Hold/Matter view detail level' },
    state: { type: 'string', description: 'Matter state filter' },
    name: { type: 'string', description: 'Matter name (create)' },
    description: { type: 'string', description: 'Matter description (create)' },
  },
  outputs: {
    data: { type: 'json', description: 'Vault API response data' },
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
