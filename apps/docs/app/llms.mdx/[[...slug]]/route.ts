import { notFound } from 'next/navigation'
import { type NextRequest, NextResponse } from 'next/server'
import { i18n } from '@/lib/i18n'
import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params

  const firstSegment = slug[0]
  const isLanguage = firstSegment && i18n.languages.includes(firstSegment as any)

  const lang = (isLanguage ? firstSegment : i18n.defaultLanguage) as string
  const contentSlug = isLanguage ? slug.slice(1) : slug

  const page = source.getPage(contentSlug, lang)
  if (!page) notFound()

  return new NextResponse(await getLLMText(page))
}

export function generateStaticParams() {
  return source.generateParams()
}
