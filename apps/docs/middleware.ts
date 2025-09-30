import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware'
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'

const i18nMiddleware = createI18nMiddleware(i18n)

function isMarkdownPreferred(request: NextRequest): boolean {
  const accept = request.headers.get('accept')
  if (!accept) return false

  // Check if text/markdown or text/plain is preferred over text/html
  const markdownIndex = accept.indexOf('text/markdown')
  const plainIndex = accept.indexOf('text/plain')
  const htmlIndex = accept.indexOf('text/html')

  if (markdownIndex === -1 && plainIndex === -1) return false
  if (htmlIndex === -1) return true

  const preferredIndex = markdownIndex !== -1 ? markdownIndex : plainIndex
  return preferredIndex < htmlIndex
}

export function middleware(request: NextRequest, event: NextFetchEvent) {
  // If markdown is preferred by the client (e.g., AI agents), rewrite to MDX endpoint
  if (isMarkdownPreferred(request) && request.nextUrl.pathname.startsWith('/docs/')) {
    const path = request.nextUrl.pathname.replace('/docs/', '')
    const rewriteUrl = new URL(`/llms.mdx/${path}`, request.url)
    return NextResponse.rewrite(rewriteUrl)
  }

  return i18nMiddleware(request, event)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon|static|robots.txt|sitemap.xml|llms-full.txt|llms.mdx).*)',
  ],
}
