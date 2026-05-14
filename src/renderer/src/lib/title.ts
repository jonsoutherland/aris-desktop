// Derive a human-friendly title from a file path. Strips directory + extension,
// converts dashes / underscores to spaces, and collapses repeated whitespace.
export const titleFromFilePath = (filePath: string): string => {
  const filename = filePath.split(/[/\\]/).pop() ?? ''
  const withoutExt = filename.replace(/\.[^.]+$/, '')
  const cleaned = withoutExt
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Untitled'
}
