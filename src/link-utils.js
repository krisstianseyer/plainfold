export function linkAt(lineText, offset) {
  const pattern = /\[\[([^\[\]\r\n]+)\]\]/g;
  let match;
  while ((match = pattern.exec(lineText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (offset >= from && offset <= to) {
      const path = match[1].trim();
      return path ? { path, from, to } : null;
    }
  }
  return null;
}
