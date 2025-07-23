import type { ToolResponse } from '../types'

export interface HunterSearchParams {
    apiKey: string
    query: string
    maxResults?: number
    pageToken?: string
    accessToken?: string
}

export interface HunterSearchResponse extends ToolResponse {
    output: {
        items: Array<{
            id: string
            title: string
            description: string
            url: string
            image: string
        }>
        totalResults: number
        nextPageToken?: string
    }
}

export interface HunterLeadsParams {
    apiKey: string
    query: string
    maxResults?: number
    pageToken?: string
    accessToken?: string
}

export interface HunterLeadsResponse extends ToolResponse {
    output: {
        items: Array<{
            id: string
            title: string
            description: string
            url: string
            image: string
        }>
    }
}

export interface HunterFinderParams {
    apiKey: string
    query: string
    maxResults?: number
    pageToken?: string
    accessToken?: string
}

export interface HunterFinderResponse extends ToolResponse {