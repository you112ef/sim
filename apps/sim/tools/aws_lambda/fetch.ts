import type { ToolConfig } from '../types'

interface AWSLambdaFetchInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  functionName?: string
  fetchFunctionName?: string
}

interface AWSLambdaFetchOutput {
  functionArn: string
  functionName: string
  runtime: string
  region: string
  status: string
  lastModified: string
  codeSize: number
  description: string
  timeout: number
  memorySize: number
  environment: Record<string, string>
  tags: Record<string, string>
  codeFiles: Record<string, string>
  handler: string
  role: string
}

export const awsLambdaFetchTool: ToolConfig<AWSLambdaFetchInput, AWSLambdaFetchOutput> = {
  id: 'aws_lambda_fetch',
  name: 'AWS Lambda Fetch',
  description: 'Fetch AWS Lambda function details and code',
  version: '1.0.0',

  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      description: 'AWS Access Key ID for authentication',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      description: 'AWS Secret Access Key for authentication',
    },
    region: {
      type: 'string',
      required: true,
      description: 'AWS region where the Lambda function is located',
    },
    functionName: {
      type: 'string',
      required: false,
      description: 'Name of the Lambda function to fetch (legacy)',
    },
    fetchFunctionName: {
      type: 'string',
      required: false,
      description: 'Name of the Lambda function to fetch',
    },
  },

  request: {
    url: '/api/tools/aws-lambda/fetch',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: AWSLambdaFetchInput) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      functionName: params.fetchFunctionName || params.functionName,
    }),
  },
} 