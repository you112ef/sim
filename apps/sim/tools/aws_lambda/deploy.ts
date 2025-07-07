import type { ToolConfig } from '../types'

interface AWSLambdaDeployInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  role: string
  functionName: string
  handler?: string
  runtime: string
  code: string
  requirements?: string
  packageJson?: string
  timeout: number
  memorySize: number
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
      description: 'Lambda runtime (e.g., nodejs18.x, python3.11)',
    },
    code: {
      type: 'string',
      required: true,
      description: 'Function code to deploy',
    },
    requirements: {
      type: 'string',
      required: false,
      description: 'Python requirements.txt content',
    },
    packageJson: {
      type: 'string',
      required: false,
      description: 'Node.js package.json content',
    },
    timeout: {
      type: 'number',
      required: true,
      description: 'Function timeout in seconds (1-900)',
    },
    memorySize: {
      type: 'number',
      required: true,
      description: 'Function memory size in MB (128-10240)',
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
      requirements: params.requirements,
      packageJson: params.packageJson,
      timeout: params.timeout,
      memorySize: params.memorySize,
      environmentVariables: params.environmentVariables || {},
      tags: params.tags || {},
    }),
  },
}
