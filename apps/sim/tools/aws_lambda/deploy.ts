import type { ToolConfig } from '../types'

interface AWSLambdaDeployInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  role: string
  functionName: string
  handler?: string
  runtime: string
  code: Record<string, string>
  timeout?: number
  memorySize?: number
  environmentVariables: Record<string, string>
  tags: Record<string, string>
}

interface AWSLambdaDeployOutput {
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
}

export const awsLambdaDeployTool: ToolConfig<AWSLambdaDeployInput, AWSLambdaDeployOutput> = {
  id: 'aws_lambda_deploy',
  name: 'AWS Lambda Deploy',
  description: 'Deploy or update an AWS Lambda function with the specified configuration',
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
      description: 'AWS region where the Lambda function will be deployed',
    },
    role: {
      type: 'string',
      required: true,
      description: 'IAM Role ARN for Lambda execution',
    },
    // Operation-specific parameters
    functionName: {
      type: 'string',
      required: true,
      description: 'Name of the Lambda function to create or update',
    },
    handler: {
      type: 'string',
      required: false,
      description: 'Function handler (e.g., index.handler)',
    },
    runtime: {
      type: 'string',
      required: true,
      description: 'Lambda runtime (e.g., nodejs18.x, python3.11, java11)',
    },
    code: {
      type: 'object',
      required: true,
      description:
        'Function code files as JSON object with file paths as keys and code content as values',
    },

    timeout: {
      type: 'number',
      required: false,
      description: 'Function timeout in seconds (1-900)',
      default: 3,
    },
    memorySize: {
      type: 'number',
      required: false,
      description: 'Function memory size in MB (128-10240)',
      default: 128,
    },
    environmentVariables: {
      type: 'object',
      required: false,
      description: 'Environment variables for the function',
      default: {},
    },
    tags: {
      type: 'object',
      required: false,
      description: 'Tags for the function',
      default: {},
    },
  },

  request: {
    url: '/api/tools/aws-lambda/deploy',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: AWSLambdaDeployInput) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      role: params.role,
      functionName: params.functionName,
      handler: params.handler,
      runtime: params.runtime,
      code: params.code,

      timeout: params.timeout || 30,
      memorySize: params.memorySize || 128,
      environmentVariables: params.environmentVariables || {},
      tags: params.tags || {},
    }),
  },
}
