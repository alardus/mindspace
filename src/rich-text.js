export const TEXT_STYLES = ['bold', 'italic', 'strike']

const MAX_FORMAT_RANGES = 30_000
const splitsSurrogate = (text, offset) => offset > 0 && offset < text.length
  && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])

export function normalizeTextFormats(text, input) {
  const value = String(text ?? '')
  if (!Array.isArray(input)) return []
  const ranges = input.slice(0, MAX_FORMAT_RANGES).flatMap((range) => {
    if (!TEXT_STYLES.includes(range?.style) || !Number.isInteger(range.from) || !Number.isInteger(range.to)) return []
    const from = Math.max(0, Math.min(value.length, range.from))
    const to = Math.max(0, Math.min(value.length, range.to))
    if (from >= to || splitsSurrogate(value, from) || splitsSurrogate(value, to)) return []
    return [{ from, to, style: range.style }]
  })

  const merged = []
  for (const style of TEXT_STYLES) {
    const matching = ranges.filter((range) => range.style === style)
      .sort((a, b) => a.from - b.from || a.to - b.to)
    for (const range of matching) {
      const previous = merged.at(-1)
      if (previous?.style === style && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
      else merged.push({ ...range })
    }
  }
  return merged.sort((a, b) => a.from - b.from || a.to - b.to
    || TEXT_STYLES.indexOf(a.style) - TEXT_STYLES.indexOf(b.style))
}

export function trimRichText(text, formats, maxLength = Infinity) {
  const value = String(text ?? '')
  const from = value.length - value.trimStart().length
  const trimmedEnd = value.trimEnd().length
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : Infinity
  const to = Math.min(trimmedEnd, from + limit)
  const trimmed = value.slice(from, to)
  const shifted = normalizeTextFormats(value, formats).map((range) => ({
    from: Math.max(range.from, from) - from,
    to: Math.min(range.to, to) - from,
    style: range.style,
  }))
  return { text: trimmed, formats: normalizeTextFormats(trimmed, shifted) }
}

export function toggleTextFormat(text, formats, style, start, end) {
  const value = String(text ?? '')
  const normalized = normalizeTextFormats(value, formats)
  if (!TEXT_STYLES.includes(style) || !Number.isInteger(start) || !Number.isInteger(end)) return normalized
  const from = Math.max(0, Math.min(value.length, Math.min(start, end)))
  const to = Math.max(0, Math.min(value.length, Math.max(start, end)))
  if (from === to || splitsSurrogate(value, from) || splitsSurrogate(value, to)) return normalized
  const covered = normalized.some((range) => range.style === style && range.from <= from && range.to >= to)
  const next = normalized.flatMap((range) => {
    if (!covered || range.style !== style || range.to <= from || range.from >= to) return [range]
    return [
      ...(range.from < from ? [{ from: range.from, to: from, style }] : []),
      ...(range.to > to ? [{ from: to, to: range.to, style }] : []),
    ]
  })
  if (!covered) next.push({ from, to, style })
  return normalizeTextFormats(value, next)
}

export function textRuns(text, formats, annotations = []) {
  const value = String(text ?? '')
  if (!value) return []
  const ranges = normalizeTextFormats(value, formats)
  const notes = (Array.isArray(annotations) ? annotations : []).slice(0, MAX_FORMAT_RANGES).flatMap((note) => {
    if (!Number.isInteger(note?.from) || !Number.isInteger(note?.to)) return []
    const from = Math.max(0, Math.min(value.length, note.from))
    const to = Math.max(0, Math.min(value.length, note.to))
    if (from >= to || splitsSurrogate(value, from) || splitsSurrogate(value, to)) return []
    return [{ from, to, ...(typeof note.href === 'string' ? { href: note.href } : {}), ...(note.match ? { match: true } : {}) }]
  })
  const boundaries = [...new Set([0, value.length,
    ...ranges.flatMap(({ from, to }) => [from, to]),
    ...notes.flatMap(({ from, to }) => [from, to]),
  ])].sort((a, b) => a - b)
  return boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1]
    const styles = TEXT_STYLES.filter((style) => ranges.some((range) => range.style === style
      && range.from <= from && range.to >= to))
    const active = notes.filter((note) => note.from <= from && note.to >= to)
    const href = active.find((note) => note.href)?.href
    return {
      from,
      to,
      text: value.slice(from, to),
      styles,
      ...(href ? { href } : {}),
      ...(active.some((note) => note.match) ? { match: true } : {}),
    }
  })
}
