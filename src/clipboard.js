import { DEFAULT_SIZE, descendantsOf, makeEdge, makeNode } from './model.js'

export const MINDSPACE_CLIPBOARD_TYPE = 'application/x-mindspace-branch+json'

export class ClipboardPayloadError extends Error {}

export const isEditableClipboardTarget = (target) => Boolean(target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])'))

export function assertClipboardCapacity(currentCount, incomingCount, limit = 5000) {
  if (currentCount + incomingCount > limit) throw new ClipboardPayloadError('A map can contain up to 5,000 blocks')
}

export function assertClipboardAssetCapacity(existingIds, incomingIds, limit = 100) {
  const combined = new Set(existingIds)
  for (const id of incomingIds) combined.add(id)
  if (combined.size > limit) throw new ClipboardPayloadError('A map can contain up to 100 images')
}

export const clipboardImageFiles = (data) => Array.from(data?.items ?? [])
  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
  .map((item) => item.getAsFile())
  .filter(Boolean)

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

const cleanNode = (node) => ({
  id: node.id,
  type: 'mind',
  position: { x: node.position.x, y: node.position.y },
  data: {
    label: node.data.label,
    note: node.data.note || '',
    color: node.data.color,
    style: node.data.style || '',
    manualColor: Boolean(node.data.manualColor),
    collapsed: Boolean(node.data.collapsed),
    root: Boolean(node.data.root),
    side: node.data.side,
    ...(node.data.image ? { image: { ...node.data.image } } : {}),
  },
})

const cleanEdge = (edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  data: { kind: edge.data?.kind === 'link' ? 'link' : 'tree' },
  ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
  ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
})

function outlineText(nodes, edges, roots) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map()
  for (const edge of edges) {
    if (edge.data.kind !== 'tree') continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(edge.target)
  }
  const visited = new Set()
  const lines = []
  const walk = (id, depth) => {
    if (visited.has(id)) return
    const node = byId.get(id)
    if (!node) return
    visited.add(id)
    lines.push(`${'\t'.repeat(depth)}${node.data.label || (node.data.image ? '[Image]' : 'Untitled')}`)
    for (const child of children.get(id) ?? []) walk(child, depth + 1)
  }
  roots.forEach((root) => walk(root, 0))
  return lines.join('\n')
}

export function serializeClipboardBranches(nodes, edges, selectedIds) {
  const existing = new Set(nodes.map((node) => node.id))
  const selected = [...new Set(selectedIds)].filter((id) => existing.has(id))
  const parent = new Map(edges
    .filter((edge) => edge.data?.kind === 'tree')
    .map((edge) => [edge.target, edge.source]))
  const roots = selected.filter((id) => {
    const seen = new Set([id])
    for (let ancestor = parent.get(id); ancestor && !seen.has(ancestor); ancestor = parent.get(ancestor)) {
      if (selected.includes(ancestor)) return false
      seen.add(ancestor)
    }
    return true
  })
  const included = new Set(roots.flatMap((id) => [id, ...descendantsOf(id, edges)]))
  const copiedNodes = nodes.filter((node) => included.has(node.id)).map(cleanNode)
  const copiedEdges = edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .map(cleanEdge)
  const payload = { version: 1, roots, nodes: copiedNodes, edges: copiedEdges }
  return {
    custom: JSON.stringify(payload),
    text: outlineText(copiedNodes, copiedEdges, roots),
    count: copiedNodes.length,
  }
}

function normalizedEdges(input, ids) {
  const edges = []
  const parent = new Map()
  for (const edge of input) {
    if (!ids.has(edge?.source) || !ids.has(edge?.target) || edge.source === edge.target) continue
    const kind = edge.data?.kind === 'link' ? 'link' : 'tree'
    if (kind === 'tree') {
      if (parent.has(edge.target)) continue
      let cyclic = false
      const seen = new Set()
      for (let ancestor = edge.source; ancestor && !seen.has(ancestor); ancestor = parent.get(ancestor)) {
        if (ancestor === edge.target) {
          cyclic = true
          break
        }
        seen.add(ancestor)
      }
      if (cyclic) continue
      parent.set(edge.target, edge.source)
    }
    edges.push({ ...edge, data: { kind } })
  }
  return edges
}

export function parseMindspaceClipboard(json, createId = uid) {
  let input
  try {
    input = JSON.parse(json)
  } catch {
    throw new Error('The copied Mindspace branch is invalid')
  }
  if (input?.version !== 1 || !Array.isArray(input.nodes) || !input.nodes.length
    || input.nodes.length > 5000 || !Array.isArray(input.edges) || input.edges.length > 10000) {
    throw new Error('The copied Mindspace branch is invalid')
  }
  const originalIds = new Set()
  const sourceNodes = []
  for (const item of input.nodes) {
    if (typeof item?.id !== 'string' || !item.id || originalIds.has(item.id)) continue
    const label = typeof item.data?.label === 'string' ? item.data.label.slice(0, 500) : ''
    const node = makeNode(label, {
      x: Number.isFinite(item.position?.x) ? item.position.x : 0,
      y: Number.isFinite(item.position?.y) ? item.position.y : 0,
    }, { id: item.id, ...item.data })
    if (!node.data.label.trim() && !node.data.image) continue
    originalIds.add(item.id)
    sourceNodes.push(node)
  }
  if (!sourceNodes.length) throw new Error('The copied Mindspace branch is invalid')
  const sourceEdges = normalizedEdges(input.edges, originalIds)
  const childIds = new Set(sourceEdges.filter((edge) => edge.data.kind === 'tree').map((edge) => edge.target))
  const idMap = new Map(sourceNodes.map((node) => [node.id, createId()]))
  const nodes = sourceNodes.map((node) => makeNode(node.data.label, node.position, {
    id: idMap.get(node.id),
    ...node.data,
    root: !childIds.has(node.id),
  }))
  const edges = sourceEdges.map((edge) => {
    const copy = makeEdge(idMap.get(edge.source), idMap.get(edge.target), edge.data.kind, createId())
    if (edge.data.kind === 'link') {
      copy.sourceHandle = edge.sourceHandle
      copy.targetHandle = edge.targetHandle
    }
    return copy
  })
  return {
    source: 'mindspace',
    roots: sourceNodes.filter((node) => !childIds.has(node.id)).map((node) => idMap.get(node.id)),
    nodes,
    edges,
  }
}

export function translateClipboardFragment(fragment, center) {
  const bounds = fragment.nodes.reduce((result, node) => {
    const width = node.dimensions?.width || (node.data.root ? DEFAULT_SIZE.rootWidth : DEFAULT_SIZE.width)
    const height = node.dimensions?.height || (node.data.root ? DEFAULT_SIZE.rootHeight : DEFAULT_SIZE.height)
    return {
      minX: Math.min(result.minX, node.position.x),
      minY: Math.min(result.minY, node.position.y),
      maxX: Math.max(result.maxX, node.position.x + width),
      maxY: Math.max(result.maxY, node.position.y + height),
    }
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
  const dx = center.x - (bounds.minX + bounds.maxX) / 2
  const dy = center.y - (bounds.minY + bounds.maxY) / 2
  return {
    ...fragment,
    nodes: fragment.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + dx, y: node.position.y + dy },
    })),
  }
}

const decodeEntities = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  if (entity[0] === '#') {
    const code = Number.parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()]
})

const cleanLabel = (value) => decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, 500)

function fragmentFromItems(items, source, createId) {
  const usable = items.map((item) => ({ label: cleanLabel(item.label), depth: Math.max(0, item.depth || 0) }))
    .filter((item) => item.label)
  if (!usable.length) throw new ClipboardPayloadError('The copied outline has no blocks')
  const ids = usable.map(() => createId())
  const parents = []
  const roots = []
  const nodes = usable.map((item, index) => {
    const depth = Math.min(item.depth, parents.length)
    const parent = depth ? parents[depth - 1] : null
    parents.splice(depth)
    parents[depth] = index
    if (parent === null) roots.push(ids[index])
    return makeNode(item.label, { x: depth * 280, y: index * 64 }, { id: ids[index], root: parent === null })
  })
  const edges = []
  parents.length = 0
  usable.forEach((item, index) => {
    const depth = Math.min(item.depth, parents.length)
    const parent = depth ? parents[depth - 1] : null
    parents.splice(depth)
    parents[depth] = index
    if (parent !== null) edges.push(makeEdge(ids[parent], ids[index], 'tree', createId()))
  })
  return { source, roots, nodes, edges }
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2] ?? ''
}

function parseOpmlItems(xml) {
  if (!/<opml\b/i.test(xml) || !/<body\b/i.test(xml)) throw new ClipboardPayloadError('The copied OPML is invalid')
  const items = []
  let depth = 0
  for (const tag of xml.match(/<\/?outline\b[^>]*>/gi) ?? []) {
    if (/^<\/outline/i.test(tag)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    items.push({ label: attribute(tag, 'text') || attribute(tag, 'title'), depth })
    if (!/\/\s*>$/.test(tag)) depth += 1
  }
  return items
}

function parseHtmlItems(html) {
  if (!/<li\b/i.test(html)) return null
  const items = []
  const active = []
  let listDepth = 0
  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (/^<(?:ul|ol)\b/i.test(token)) listDepth += 1
    else if (/^<\/(?:ul|ol)\b/i.test(token)) listDepth = Math.max(0, listDepth - 1)
    else if (/^<li\b/i.test(token)) {
      const item = { label: '', depth: Math.max(0, listDepth - 1) }
      items.push(item)
      active.push(item)
    } else if (/^<\/li\b/i.test(token)) active.pop()
    else if (/^<br\b/i.test(token)) {
      if (active.length) active.at(-1).label += ' '
    } else if (!token.startsWith('<') && active.length) active.at(-1).label += token
  }
  return items
}

function depthsFromIndents(lines) {
  const levels = []
  return lines.map(({ label, indent }) => {
    while (levels.length && levels.at(-1) >= indent) levels.pop()
    const depth = indent > 0 ? levels.length : 0
    levels.push(indent)
    return { label, depth }
  })
}

function parseTextItems(text) {
  const lines = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .split('\n').filter((line) => line.trim())
  const markdown = lines.map((line) => line.match(/^([\t ]*)(?:[-+*]|\d+[.)])[\t ]+(.+?)\s*$/))
  if (lines.length && markdown.every(Boolean)) {
    return depthsFromIndents(markdown.map((match) => ({
      indent: match[1].replaceAll('\t', '    ').length,
      label: match[2],
    })))
  }
  const indented = lines.map((line) => line.match(/^([\t ]*)(\S.*)$/))
  if (lines.length > 1 && indented.every(Boolean) && indented.some((match) => /\t| {2,}/.test(match[1]))) {
    return depthsFromIndents(indented.map((match) => ({
      indent: match[1].replaceAll('\t', '    ').length,
      label: match[2],
    })))
  }
  return null
}

export function parseClipboardData(data, createId = uid) {
  const types = new Set(Array.from(data?.types ?? []))
  if (types.has(MINDSPACE_CLIPBOARD_TYPE)) {
    try {
      return parseMindspaceClipboard(data.getData(MINDSPACE_CLIPBOARD_TYPE), createId)
    } catch (error) {
      throw new ClipboardPayloadError(error instanceof Error ? error.message : 'The copied Mindspace branch is invalid')
    }
  }

  const xmlType = ['text/x-opml', 'application/xml', 'text/xml'].find((type) => types.has(type))
  const text = String(data?.getData?.('text/plain') ?? '')
  const xml = xmlType ? data.getData(xmlType) : /^\s*(?:<\?xml[^>]*>\s*)?<opml\b/i.test(text) ? text : ''
  if (xml) return fragmentFromItems(parseOpmlItems(xml), 'opml', createId)

  const html = types.has('text/html') ? data.getData('text/html') : ''
  const htmlItems = html && parseHtmlItems(html)
  if (htmlItems?.length) return fragmentFromItems(htmlItems, 'html', createId)

  const trimmed = text.trim()
  if (!trimmed) return null
  const outline = parseTextItems(trimmed)
  if (outline) return fragmentFromItems(outline, 'outline', createId)
  const node = makeNode(trimmed.slice(0, 500), { x: 0, y: 0 }, { id: createId(), root: true })
  return { source: 'text', roots: [node.id], nodes: [node], edges: [] }
}
