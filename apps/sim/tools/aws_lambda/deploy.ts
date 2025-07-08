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
  description:
    'Make sure to satisfy the user request.Deploy or update an AWS Lambda function with the specified configuration. This tool can create a new Lambda function or update an existing one with any changes you specify. It accepts function code as a JSON object where keys are file paths and values are file contents. For Node.js functions, typically include an index.js file with the handler function. The tool will package and deploy the code to AWS Lambda with the specified runtime, memory, timeout, and environment variables. When updating an existing function, this tool can make whatever changes you want to the function configuration and code.',
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
        'AWS region where the Lambda function will be deployed. Examples: us-east-1, eu-west-1, ap-southeast-2',
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
        'Name of the Lambda function to create or update. If the function already exists, it will be updated with any changes you specify to the configuration and code.',
    },
    handler: {
      type: 'string',
      required: true,
      optionalToolInput: true,
      description:
        'Function handler that Lambda calls to start execution. Format varies by runtime: index.handler (Node.js), lambda_function.lambda_handler (Python), etc. If not provided, a default will be used based on the runtime.',
    },
    runtime: {
      type: 'string',
      required: true,
      optionalToolInput: true,
      description:
        'Lambda runtime environment. Common values: nodejs18.x, python3.11, java11, go1.x, dotnet6, ruby2.7. This determines the execution environment for your function.',
    },
    code: {
      type: 'json',
      required: true,
      description:
        'Function code files as JSON object with file paths as keys and code content as values. For Node.js, typically include {"index.js": "exports.handler = async (event) => { return { statusCode: 200, body: JSON.stringify({ message: \"Hello World\" }) }; };"}. For Python, include {"lambda_function.py": "def lambda_handler(event, context): return { \"statusCode\": 200, \"body\": \"Hello World\" }"}. The code object must contain at least one file with non-empty string content.',
    },

    timeout: {
      type: 'number',
      required: true,
      optionalToolInput: true,
      description:
        'Function timeout in seconds. Must be between 1 and 900 seconds (15 minutes). Default is 3 seconds.',
      default: 3,
    },
    memorySize: {
      type: 'number',
      required: true,
      optionalToolInput: true,
      description:
        'Function memory size in MB. Must be between 128 and 10240 MB. More memory also means more CPU power. Default is 128 MB.',
      default: 128,
    },
    environmentVariables: {
      type: 'object',
      required: false,
      description:
        'Environment variables for the function. These will be available to your function during execution. Example: {"API_KEY": "your-api-key", "ENVIRONMENT": "production"}.',
      default: {},
    },
    tags: {
      type: 'object',
      required: false,
      description:
        'Tags for the function. Useful for organization and cost tracking. Example: {"Environment": "production", "Project": "my-app"}.',
      default: {},
    },
    endpointName: {
      type: 'string',
      required: true,
      optionalToolInput: true,
      description:
        'Name of the API Gateway endpoint to create or update. This will be used to create the API Gateway and will appear in the endpoint URL.',
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
      code: typeof params.code === 'string' ? params.code : JSON.stringify(params.code),

      timeout: params.timeout || 30,
      memorySize: params.memorySize || 128,
      environmentVariables: params.environmentVariables || {},
      tags: params.tags || {},
    }),
  },
}
