import type { ToolConfig } from '../types'

interface AWSLambdaDeployEndpointParams {
  accessKeyId: string
  secretAccessKey: string
  region: string
  role: string
  functionName: string
  endpointName: string
}

interface AWSLambdaDeployEndpointResponse {
  functionArn: string
  functionName: string
  endpointName: string
  endpointUrl: string
  region: string
  status: string
  lastModified: string
  apiGatewayId: string
  stageName: string
}

export const awsLambdaDeployEndpointTool: ToolConfig<
  AWSLambdaDeployEndpointParams,
  AWSLambdaDeployEndpointResponse
> = {
  id: 'aws_lambda_deploy_endpoint',
  name: 'AWS Lambda Deploy Endpoint',
  description:
    'Deploy an AWS Lambda function as an HTTP endpoint using API Gateway. This tool creates or updates an API Gateway REST API and connects it to the specified Lambda function, making it accessible via HTTP requests. The endpoint will be publicly accessible and can handle GET, POST, PUT, DELETE, and other HTTP methods. This is useful for creating web APIs, webhooks, or any HTTP-based service using Lambda functions.',
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
        'AWS region where the Lambda function and API Gateway will be deployed. Examples: us-east-1, eu-west-1, ap-southeast-2',
    },
    role: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'IAM Role ARN that the Lambda function will assume during execution. This role must have appropriate permissions for the function to operate correctly and be invoked by API Gateway.',
    },
    // Operation-specific parameters
    functionName: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'Name of the existing Lambda function to deploy as an endpoint. This function must already exist in the specified region and be properly configured to handle HTTP requests.',
    },
    endpointName: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description:
        'Name for the API Gateway endpoint. This will be used to create the API Gateway REST API and will appear in the endpoint URL. Should be descriptive and unique within your AWS account.',
    },
  },

  request: {
    url: '/api/tools/aws-lambda/deploy-endpoint',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: AWSLambdaDeployEndpointParams) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      role: params.role,
      functionName: params.functionName,
      endpointName: params.endpointName,
    }),
  },
}
