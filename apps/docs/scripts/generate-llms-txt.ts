import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface Page {
  path: string
  title: string
  description?: string
}

function extractFrontmatter(content: string): { title?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const frontmatter = match[1]
  const title = frontmatter.match(/title:\s*(.+)/)?.[1]?.trim()
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim()

  let fallbackDescription = description
  if (!fallbackDescription) {
    const contentAfterFrontmatter = content.split('---')[2]
    if (contentAfterFrontmatter) {
      const withoutImports = contentAfterFrontmatter
        .split('\n')
        .filter((line) => !line.trim().startsWith('import '))
        .join('\n')

      const lines = withoutImports.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (
          trimmed &&
          !trimmed.startsWith('<') &&
          !trimmed.startsWith('#') &&
          !trimmed.startsWith('//') &&
          trimmed.length > 20
        ) {
          fallbackDescription = trimmed
            .replace(/<.*?>/g, '')
            .replace(/\{.*?\}/g, '')
            .trim()
            .substring(0, 150)
          break
        }
      }
    }
  }

  return { title, description: fallbackDescription }
}

function getPages(dir: string, baseDir = ''): Page[] {
  const pages: Page[] = []
  const items = readdirSync(dir, { withFileTypes: true })

  for (const item of items) {
    const fullPath = join(dir, item.name)
    const relativePath = join(baseDir, item.name)

    if (item.isDirectory()) {
      pages.push(...getPages(fullPath, relativePath))
    } else if (item.name.endsWith('.mdx')) {
      const content = readFileSync(fullPath, 'utf-8')
      const { title, description } = extractFrontmatter(content)
      const path = relativePath.replace(/\.mdx$/, '').replace(/\/index$/, '')

      if (title) {
        pages.push({ path, title, description })
      }
    }
  }

  return pages
}

function generateLLMsTxt() {
  const docsDir = join(process.cwd(), 'content/docs/en')
  const allPages = getPages(docsDir)

  const triggers = allPages.filter((p) => p.path.startsWith('triggers/'))
  const blocks = allPages.filter((p) => p.path.startsWith('blocks/'))
  const tools = allPages.filter((p) => p.path.startsWith('tools/'))
  const connections = allPages.filter((p) => p.path.startsWith('connections/'))
  const execution = allPages.filter((p) => p.path.startsWith('execution/'))
  const variables = allPages.filter((p) => p.path.startsWith('variables/'))
  const sdks = allPages.filter((p) => p.path.startsWith('sdks/'))
  const other = allPages.filter(
    (p) =>
      !p.path.includes('/') ||
      (p.path.includes('/') &&
        !triggers.includes(p) &&
        !blocks.includes(p) &&
        !tools.includes(p) &&
        !connections.includes(p) &&
        !execution.includes(p) &&
        !variables.includes(p) &&
        !sdks.includes(p))
  )

  let output = `# Sim Documentation

Sim is a visual workflow builder for AI applications that lets you build AI agent workflows visually. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.

## Getting Started

`

  const intro = allPages.find((p) => p.path === 'introduction')
  const gettingStarted = allPages.find((p) => p.path === 'getting-started')

  if (intro) output += `- [${intro.title}](/${intro.path}): ${intro.description || ''}\n`
  if (gettingStarted)
    output += `- [${gettingStarted.title}](/${gettingStarted.path}): ${gettingStarted.description || ''}\n`

  output += `\n## Triggers\n\n`
  triggers
    .sort((a, b) => {
      if (a.path === 'triggers') return -1
      if (b.path === 'triggers') return 1
      return a.title.localeCompare(b.title)
    })
    .forEach((p) => {
      output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
    })

  output += `\n## Blocks\n\n`
  blocks
    .sort((a, b) => {
      if (a.path === 'blocks') return -1
      if (b.path === 'blocks') return 1
      return a.title.localeCompare(b.title)
    })
    .forEach((p) => {
      output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
    })

  output += `\n## Tools & Integrations\n\n`
  tools
    .sort((a, b) => {
      if (a.path === 'tools') return -1
      if (b.path === 'tools') return 1
      return a.title.localeCompare(b.title)
    })
    .forEach((p) => {
      output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
    })

  if (connections.length > 0) {
    output += `\n## Connections\n\n`
    connections
      .sort((a, b) => {
        if (a.path === 'connections') return -1
        if (b.path === 'connections') return 1
        return a.title.localeCompare(b.title)
      })
      .forEach((p) => {
        output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
      })
  }

  if (variables.length > 0) {
    output += `\n## Variables\n\n`
    variables.forEach((p) => {
      output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
    })
  }

  if (execution.length > 0) {
    output += `\n## Execution\n\n`
    execution
      .sort((a, b) => {
        if (a.path === 'execution') return -1
        if (b.path === 'execution') return 1
        return a.title.localeCompare(b.title)
      })
      .forEach((p) => {
        output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
      })
  }

  if (sdks.length > 0) {
    output += `\n## SDKs\n\n`
    sdks.forEach((p) => {
      output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
    })
  }

  if (other.length > 0) {
    output += `\n## Other Features\n\n`
    other
      .filter((p) => p.path !== 'introduction' && p.path !== 'getting-started' && p.path !== '')
      .forEach((p) => {
        output += `- [${p.title}](/${p.path}): ${p.description || ''}\n`
      })
  }

  output += `
---

For complete documentation with interactive examples and visual guides, visit https://docs.sim.ai
For full machine-readable documentation, see /llms-full.txt
`

  // Write to public directory
  const outputPath = join(process.cwd(), 'public/llms.txt')
  writeFileSync(outputPath, output, 'utf-8')
  console.log(`✅ Generated ${outputPath}`)
  console.log(`📊 Total pages: ${allPages.length}`)
}

generateLLMsTxt()
