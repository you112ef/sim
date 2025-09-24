import type { ToolResponse } from '@/tools/types'

export interface GoogleVaultCommonParams {
  accessToken: string
  matterId: string
}

// Exports
export interface GoogleVaultCreateMattersExportParams extends GoogleVaultCommonParams {}

export interface GoogleVaultListMattersExportParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  exportId?: string // Short input to fetch a specific export
}

export interface GoogleVaultListMattersExportResponse extends ToolResponse {
  output: any
}

// Holds
export type GoogleVaultHoldView = 'HOLD_VIEW_UNSPECIFIED' | 'BASIC_HOLD' | 'FULL_HOLD'

export interface GoogleVaultCreateMattersHoldsParams extends GoogleVaultCommonParams {}

export interface GoogleVaultListMattersHoldsParams extends GoogleVaultCommonParams {
  pageSize?: number
  pageToken?: string
  view?: GoogleVaultHoldView
  holdId?: string // Short input to fetch a specific hold
}

export interface GoogleVaultListMattersHoldsResponse extends ToolResponse {
  output: any
}
