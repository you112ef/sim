import type { ToolConfig } from '../types'

type AWSLambdaGetPromptsParams = {}

interface AWSLambdaGetPromptsResponse {
  systemPrompt: string
  schema: Record<string, any>
}

export const awsLambdaGetPromptsTool: ToolConfig<
  AWSLambdaGetPromptsParams,
  AWSLambdaGetPromptsResponse
> = {
  id: 'aws_lambda_get_prompts',
  name: 'AWS Lambda Get Prompts',
  description: 'Get system prompt and schema for AWS Lambda operations',
  version: '1.0.0',

  params: {
    // No parameters needed for this operation
  },

  request: {
    url: '/api/tools/aws-lambda/get-prompts',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: () => ({}), // No body needed
  },
}
