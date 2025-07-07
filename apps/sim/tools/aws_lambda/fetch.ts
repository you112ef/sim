import type { ToolConfig } from '../types'

interface AWSLambdaFetchParams {
  accessKeyId: string
  secretAccessKey: string
  region: string
  functionName: string
}

interface AWSLambdaFetchResponse {
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

export const awsLambdaFetchTool: ToolConfig<AWSLambdaFetchParams, AWSLambdaFetchResponse> = {
  id: 'aws_lambda_fetch',
  name: 'AWS Lambda Fetch',
  description: 'Fetch AWS Lambda function details and code',
  version: '1.0.0',

  params: {
    // Common AWS parameters (always at the top)
    accessKeyId: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'AWS Access Key ID for authentication',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'AWS Secret Access Key for authentication',
    },
    region: {
      type: 'string',
      required: true,
      description: 'AWS region where the Lambda function is located',
    },
    // Operation-specific parameters
    functionName: {
      type: 'string',
      required: true,
      description: 'Name of the Lambda function to fetch',
    },

  },

  request: {
    url: '/api/tools/aws-lambda/fetch',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: AWSLambdaFetchParams) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      functionName: params.functionName,
    }),
  },
}
