import { DEFAULT_SIZE, descendantsOf, makeEdge, makeNode } from './model.js'

export const MINDSPACE_CLIPBOARD_TYPE = 'application/x-mindspace-branch+json'

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
    if (!label.trim() && !item.data?.image) continue
    originalIds.add(item.id)
    sourceNodes.push(makeNode(label, {
      x: Number.isFinite(item.position?.x) ? item.position.x : 0,
      y: Number.isFinite(item.position?.y) ? item.position.y : 0,
    }, { id: item.id, ...item.data }))
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
