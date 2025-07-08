import { S3Icon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

// Define the expected response type for AWS Lambda operations
interface AWSLambdaResponse extends ToolResponse {
  output: {
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
  }
}

export const AWSLambdaBlock: BlockConfig<AWSLambdaResponse> = {
  type: 'aws_lambda',
  name: 'AWS Lambda',
  description: 'Deploy and manage AWS Lambda functions',
  longDescription:
    'Create, update, and manage AWS Lambda functions with automatic deployment. Configure runtime environments, memory allocation, timeout settings, and environment variables for serverless function execution. Use fetch to retrieve existing function details and code files to understand the current state, then deploy with any desired changes to the function configuration and code.',
  docsLink: 'https://docs.simstudio.ai/tools/aws-lambda',
  category: 'tools',
  bgColor: '#FF9900',
  icon: S3Icon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Fetch', id: 'fetch' },
        { label: 'Create/Update', id: 'create/update' },
        { label: 'Get Prompts', id: 'getPrompts' },
      ],
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter AWS Access Key ID',
      password: true,
      description: 'AWS Access Key ID for authentication. Required for all operations.',
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter AWS Secret Access Key',
      password: true,
      description: 'AWS Secret Access Key for authentication. Required for all operations.',
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'role',
      title: 'Role ARN',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the IAM Role ARN for Lambda execution',
      password: false,
      description: 'IAM Role ARN that the Lambda function will assume during execution. Must have appropriate permissions.',
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'dropdown',
      layout: 'full',
      options: [
        'us-east-1',
        'us-east-2',
        'us-west-1',
        'us-west-2',
        'af-south-1',
        'ap-east-1',
        'ap-south-1',
        'ap-northeast-1',
        'ap-northeast-2',
        'ap-northeast-3',
        'ap-southeast-1',
        'ap-southeast-2',
        'ca-central-1',
        'eu-central-1',
        'eu-west-1',
        'eu-west-2',
        'eu-west-3',
        'eu-north-1',
        'eu-south-1',
        'me-south-1',
        'sa-east-1',
      ],
      description: 'AWS region where the Lambda function will be deployed or is located.',
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Lambda function name',
      description: 'Name of the Lambda function. For fetch operations, this must be an existing function to understand its current state. For create/update, this will be the name of the new function or the existing function to update with any desired changes.',
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'runtime',
      title: 'Runtime',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., nodejs18.x, python3.11, java11',
      description: 'Lambda runtime environment. Common values: nodejs18.x, python3.11, java11, go1.x, dotnet6, ruby2.7',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'handler',
      title: 'Handler',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., index.handler',
      description: 'Function handler that Lambda calls to start execution. Format varies by runtime: index.handler (Node.js), lambda_function.lambda_handler (Python), etc.',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter timeout in seconds (1-900)',
      description: 'Function timeout in seconds. Must be between 1 and 900 seconds (15 minutes).',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'memorySize',
      title: 'Memory (MB)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter memory in MB (128-10240)',
      description: 'Amount of memory allocated to the function in MB. Must be between 128 and 10240 MB.',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'code',
      title: 'Function Code',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder: '{\n  "index.js": "exports.handler = async (event) => {...};"\n}',
      description: 'Function code files as JSON object. Keys are file paths, values are file contents. For Node.js, typically include index.js with the handler function.',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'environmentVariables',
      title: 'Environment Variables',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      placeholder: 'Add environment variables as key-value pairs',
      description: 'Environment variables that will be available to the Lambda function during execution.',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      placeholder: 'Add tags as key-value pairs',
      description: 'Tags to associate with the Lambda function for organization and cost tracking.',
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
  ],
  tools: {
    access: ['aws_lambda_deploy', 'aws_lambda_fetch', 'aws_lambda_get_prompts'],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = String(params.operation || '').trim()
        // Only map user-facing names; pass through tool IDs as-is
        const operationMap: Record<string, string> = {
          fetch: 'aws_lambda_fetch',
          'create/update': 'aws_lambda_deploy',
          getPrompts: 'aws_lambda_get_prompts',
        }
        if (operationMap[operation]) {
          return operationMap[operation]
        }
        // If already a tool ID, return as-is
        if (
          operation === 'aws_lambda_fetch' ||
          operation === 'aws_lambda_deploy' ||
          operation === 'aws_lambda_get_prompts'
        ) {
          return operation
        }
        // Default fallback
        console.warn(`Unknown operation: "${operation}", defaulting to aws_lambda_fetch`)
        return 'aws_lambda_fetch'
      },
    },
  },
  inputs: {
    accessKeyId: { type: 'string', required: true },
    secretAccessKey: { type: 'string', required: true },
    region: { type: 'string', required: true },
    role: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    functionName: { type: 'string', required: true },
    handler: { type: 'string', required: true },
    runtime: { type: 'string', required: true },
    code: { type: 'json', required: true },
    timeout: { type: 'number', required: true },
    memorySize: { type: 'number', required: true },
    environmentVariables: { type: 'json', required: false },
    tags: { type: 'json', required: false },
  },
  outputs: {
    functionArn: 'string',
    functionName: 'string',
    runtime: 'string',
    region: 'string',
    status: 'string',
    lastModified: 'string',
    codeSize: 'number',
    description: 'string',
    timeout: 'number',
    memorySize: 'number',
    environment: 'json',
    tags: 'json',
    codeFiles: 'json',
    handler: 'string',
  },
}
