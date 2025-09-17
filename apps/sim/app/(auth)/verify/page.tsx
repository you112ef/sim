import { env } from '@/lib/env'
import { VerifyContent } from '@/app/(auth)/verify/verify-content'

export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const hasResendKey = Boolean(env.RESEND_API_KEY && env.RESEND_API_KEY !== 'placeholder')

  return <VerifyContent hasResendKey={hasResendKey} />
}
