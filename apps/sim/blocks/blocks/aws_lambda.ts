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
    'Create, update, and manage AWS Lambda functions with automatic deployment. Configure runtime environments, memory allocation, timeout settings, and environment variables for serverless function execution.',
  docsLink: 'https://docs.simstudio.ai/tools/aws-lambda',
  category: 'tools',
  bgColor: '#FF9900',
  icon: S3Icon,
  subBlocks: [
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter AWS Access Key ID',
      password: true,
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
      condition: {
        field: 'operation',
        value: ['fetch', 'create/update'],
      },
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'dropdown',
      layout: 'half',
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
      condition: {
        field: 'operation',
        value: ['create/update'],
      },
    },
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
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Lambda function name',
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
      placeholder:
        '{\n  "index.js": "exports.handler = async (event) => {\n    return {\n      statusCode: 200,\n      body: JSON.stringify({\n        message: \"Hello from Lambda!\"\n      })\n    };\n  };"\n}',
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
        const operation = String(params.operation || '').trim();
        // Only map user-facing names; pass through tool IDs as-is
        const operationMap: Record<string, string> = {
          'fetch': 'aws_lambda_fetch',
          'create/update': 'aws_lambda_deploy',
          'getPrompts': 'aws_lambda_get_prompts',
        };
        if (operationMap[operation]) {
          return operationMap[operation];
        }
        // If already a tool ID, return as-is
        if (
          operation === 'aws_lambda_fetch' ||
          operation === 'aws_lambda_deploy' ||
          operation === 'aws_lambda_get_prompts'
        ) {
          return operation;
        }
        // Default fallback
        console.warn(`Unknown operation: "${operation}", defaulting to aws_lambda_fetch`);
        return 'aws_lambda_fetch';
      },
    },
  },
  inputs: {
    accessKeyId: { type: 'string', required: false },
    secretAccessKey: { type: 'string', required: false },
    region: { type: 'string', required: false },
    role: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    functionName: { type: 'string', required: false },
    handler: { type: 'string', required: false },
    runtime: { type: 'string', required: false },
    code: { type: 'json', required: false },
    timeout: { type: 'number', required: false },
    memorySize: { type: 'number', required: false },
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
