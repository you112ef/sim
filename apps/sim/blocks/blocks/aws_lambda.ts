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
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter AWS Secret Access Key',
      password: true,
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
    },
    {
      id: 'role',
      title: 'Role ARN',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the IAM Role ARN for Lambda execution',
      password: false,
    },
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Lambda function name',
    },
    {
      id: 'runtime',
      title: 'Runtime',
      type: 'dropdown',
      layout: 'full',
      options: [
        'nodejs18.x',
        'nodejs16.x',
        'nodejs14.x',
        'python3.11',
        'python3.10',
        'python3.9',
        'python3.8',
        'java11',
        'java8.al2',
        'dotnet6',
        'dotnetcore3.1',
        'go1.x',
        'ruby2.7',
        'provided.al2',
        'provided',
      ],
    },
    {
      id: 'handler',
      title: 'Handler',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., index.handler',
      condition: {
        field: 'runtime',
        value: [
          'nodejs18.x',
          'nodejs16.x',
          'nodejs14.x',
          'python3.11',
          'python3.10',
          'python3.9',
          'python3.8',
          'java11',
          'java8.al2',
          'dotnet6',
          'dotnetcore3.1',
          'ruby2.7',
        ],
      },
    },
    {
      id: 'code',
      title: 'Function Code',
      type: 'code',
      layout: 'full',
      language: 'javascript',
      generationType: 'javascript-function-body',
      placeholder: '// Enter your Lambda function code here',
    },
    {
      id: 'requirements',
      title: 'Requirements (Python)',
      type: 'code',
      layout: 'full',
      language: 'javascript',
      placeholder:
        '// Enter Python dependencies (requirements.txt format)\n// e.g., requests==2.31.0\n// boto3==1.34.0',
      condition: {
        field: 'runtime',
        value: ['python3.11', 'python3.10', 'python3.9', 'python3.8'],
      },
    },
    {
      id: 'packageJson',
      title: 'Package.json (Node.js)',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder:
        '{\n  "name": "lambda-function",\n  "version": "1.0.0",\n  "dependencies": {\n    "axios": "^1.6.0",\n    "lodash": "^4.17.21"\n  }\n}',
      condition: {
        field: 'runtime',
        value: ['nodejs18.x', 'nodejs16.x', 'nodejs14.x'],
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'slider',
      layout: 'full',
      min: 1,
      max: 900,
      step: 1,
      integer: true,
    },
    {
      id: 'memorySize',
      title: 'Memory (MB)',
      type: 'slider',
      layout: 'half',
      min: 128,
      max: 10240,
      step: 64,
      integer: true,
    },
    {
      id: 'environmentVariables',
      title: 'Environment Variables',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      placeholder: 'Add environment variables as key-value pairs',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      placeholder: 'Add tags as key-value pairs',
    },
  ],
  tools: {
    access: ['aws_lambda_deploy', 'aws_lambda_update', 'aws_lambda_invoke'],
  },
  inputs: {
    accessKeyId: { type: 'string', required: true },
    secretAccessKey: { type: 'string', required: true },
    region: { type: 'string', required: true },
    role: { type: 'string', required: true },
    functionName: { type: 'string', required: true },
    handler: { type: 'string', required: false },
    runtime: { type: 'string', required: true },
    code: { type: 'string', required: true },
    requirements: { type: 'string', required: false },
    packageJson: { type: 'string', required: false },
    timeout: { type: 'number', required: true },
    memorySize: { type: 'number', required: true },
    environmentVariables: { type: 'json', required: true },
    tags: { type: 'json', required: true },
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
  },
}
