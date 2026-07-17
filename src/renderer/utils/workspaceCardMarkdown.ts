import type { AiSummary, Document } from '../../shared/ipc-types'

export function markdownCardContent(title: string, content: string): string {
  const body = content.trim()
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`
}

export function paperCardMarkdown(doc: Document, summary: AiSummary | null): string {
  const title = doc.title || doc.fileName
  const metadata = [
    ['Authors', doc.authors],
    ['Year', doc.year],
    ['Venue', doc.venue],
    ['DOI', doc.doi],
    ['URL', doc.url],
    ['Source file', doc.fileName]
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  const sections: string[] = [`# ${title}`]

  if (metadata.length > 0) {
    sections.push(metadata.map(([label, value]) => `- **${label}:** ${value}`).join('\n'))
  }
  if (doc.abstract) sections.push(`## Abstract\n\n${doc.abstract}`)
  if (summary?.content) {
    const summarySections = [`## AI Summary\n\n${summary.content.core}`]
    if (summary.content.keyPoints.length > 0) {
      summarySections.push(`### Key Points\n\n${summary.content.keyPoints.map((point) => `- ${point}`).join('\n')}`)
    }
    if (summary.content.methods) summarySections.push(`### Methods\n\n${summary.content.methods}`)
    if (summary.content.contribution) summarySections.push(`### Contribution\n\n${summary.content.contribution}`)
    sections.push(summarySections.join('\n\n'))
  }
  if (doc.note) sections.push(`## Notes\n\n${doc.note}`)

  return `${sections.join('\n\n')}\n`
}
