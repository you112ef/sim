import type { ToolConfig } from '../types'

interface AWSLambdaFetchParams {
  accessKeyId: string
  secretAccessKey: string
  region: string
  functionName: string
  role: string
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
  description:
    'Fetch AWS Lambda function details, configuration, and code files. Use this to retrieve information about an existing Lambda function including its runtime, handler, timeout, memory settings, environment variables, tags, and actual code files. This is used to understand the current state of a function before making changes. The fetch operation is read-only and does not modify the function.',
  version: '1.0.0',

  params: {
    // Common AWS parameters (always at the top)
    accessKeyId: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'AWS Access Key ID for authentication. This is required to access AWS services.',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'AWS Secret Access Key for authentication. This is required to access AWS services.',
    },
    region: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'AWS region where the Lambda function is located. Examples: us-east-1, eu-west-1, ap-southeast-2',
    },
    role: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'IAM Role ARN that the Lambda function will assume during execution. This role must have appropriate permissions for the function to operate correctly.',
    },
    // Operation-specific parameters
    functionName: {
      type: 'string',
      required: true,
      optionalToolInput: true,
      description:
        'Name of the existing Lambda function to fetch and understand. This must be the exact name of a function that already exists in the specified region. Use this to retrieve the current state before making changes.',
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
      role: params.role,
    }),
  },
}
