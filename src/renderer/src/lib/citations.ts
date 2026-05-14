export type CitationStyle = 'APA' | 'MLA' | 'Chicago'

export interface CitationSource {
  title: string
  author: string | null
  publication_year: number | null
  publisher: string | null
  edition: string | null
}

export function formatCitation(
  source: CitationSource,
  page: number,
  style: CitationStyle
): string {
  const author = source.author?.trim() || 'Unknown Author'
  const year = source.publication_year ?? 'n.d.'
  const title = source.title
  const publisher = source.publisher?.trim() || 'n.p.'
  const edStr = source.edition ? ` (${source.edition} ed.)` : ''

  switch (style) {
    case 'APA':
      return `${author} (${year}). ${title}${edStr}. ${publisher}. p. ${page}.`
    case 'MLA':
      return `${author}. ${title}${edStr}. ${publisher}, ${year}. p. ${page}.`
    case 'Chicago':
      return `${author}. ${title}${edStr}. ${publisher}, ${year}. ${page}.`
  }
}

export const CITATION_STYLES: CitationStyle[] = ['APA', 'MLA', 'Chicago']
