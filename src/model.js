export const STORAGE_KEY = 'mindspace-map-v1'
export const LIBRARY_STORAGE_KEY = 'mindspace-library-v1'
export const PALETTES = {
  bright: { name: 'Bright', colors: ['#E9A23B', '#3AAA97', '#4F95D9', '#A479D1', '#E0675D', '#5BA35F'] },
  calm: { name: 'Calm', colors: ['#C9A26B', '#7FA89E', '#7E9CBF', '#A495B8', '#C4877F', '#8FA77F'] },
  mono: { name: 'Mono', colors: ['#1F2421', '#3E443F', '#5D635C', '#7C817A', '#9B9F98', '#BABDB6'] },
}
export const COLORS = PALETTES.bright.colors
// Maps store the light palette hex, which is just its palette index; paint() resolves it to the
// --<palette>-<n> variable so the current theme picks the shade. Hex outside the palettes stays as is.
const PALETTE_VARS = new Map(Object.entries(PALETTES)
  .flatMap(([key, palette]) => palette.colors.map((color, index) => [color, `var(--${key}-${index + 1})`])))
export const paint = (color) => PALETTE_VARS.get(color) ?? color

export const DEFAULT_SETTINGS = { layout: 'both', palette: 'bright', lines: 'smooth', density: 'normal' }
const SETTING_VALUES = {
  layout: ['right', 'both', 'tree'],
  palette: Object.keys(PALETTES),
  lines: ['smooth', 'straight'],
  density: ['compact', 'normal', 'loose'],
}
const DENSITY = { compact: 0.75, normal: 1, loose: 1.3 }

export function normalizeSettings(input = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
    .map(([key, fallback]) => [key, SETTING_VALUES[key].includes(input?.[key]) ? input[key] : fallback]))
}

export const paletteColors = (palette) => (PALETTES[palette] ?? PALETTES.bright).colors

// Palette change: automatic colors move to the color with the same index; manually set ones stay untouched.
export function recolorForPalette(nodes, from, to) {
  const source = paletteColors(from)
  const target = paletteColors(to)
  for (const node of nodes) {
    if (node.data.manualColor) continue
    node.data.color = target[Math.max(0, source.indexOf(node.data.color))]
  }
}
// Old pastel palette → new branch colors of the same hue.
const LEGACY_COLORS = {
  '#FFFDF8': COLORS[0],
  '#F6E9D7': COLORS[0],
  '#DDEFE7': COLORS[1],
  '#DEEAF7': COLORS[2],
  '#E9E2F6': COLORS[3],
  '#F6DFE4': COLORS[4],
}

export const branchColor = (index, palette = 'bright') => paletteColors(palette)[index % 6]
const normalizeColor = (color) => (PALETTE_VARS.has(color) ? color : LEGACY_COLORS[color] ?? COLORS[0])

export const NODE_STYLES = ['line', 'card', 'text']
export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
// Default style depends on role: root is a card, a branch is text on a line.
export const nodeStyle = (data) => (NODE_STYLES.includes(data.style) ? data.style : data.root ? 'card' : 'line')
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export function normalizeImageReference(value) {
  if (!value || typeof value !== 'object'
    || typeof value.assetId !== 'string' || !value.assetId.trim()
    || typeof value.name !== 'string' || !value.name.trim()
    || !IMAGE_MIME_TYPES.has(value.mime)
    || !Number.isFinite(value.naturalWidth) || value.naturalWidth <= 0
    || !Number.isFinite(value.naturalHeight) || value.naturalHeight <= 0) return null
  return {
    assetId: value.assetId,
    name: value.name.slice(0, 255),
    mime: value.mime,
    naturalWidth: value.naturalWidth,
    naturalHeight: value.naturalHeight,
  }
}

export function makeNode(label, position = { x: 0, y: 0 }, options = {}) {
  const node = {
    id: options.id ?? uid(),
    type: 'mind',
    position,
    data: {
      label,
      note: typeof options.note === 'string' ? options.note.slice(0, 200) : '',
      color: normalizeColor(options.color),
      style: NODE_STYLES.includes(options.style) ? options.style : '',
      manualColor: Boolean(options.manualColor),
      collapsed: Boolean(options.collapsed),
      root: Boolean(options.root),
      side: options.side === 'left' || options.side === 'right' ? options.side : 'root',
    },
  }
  const image = normalizeImageReference(options.image)
  if (image) node.data.image = image
  return node
}

export function referencedAssetIds(map) {
  return new Set(map?.nodes?.flatMap((node) => node.data?.image?.assetId ? [node.data.image.assetId] : []) ?? [])
}

export function makeEdge(source, target, kind = 'tree', id = uid()) {
  const edgeKind = kind === 'link' ? 'link' : 'tree'
  return { id, source, target, type: edgeKind === 'tree' ? 'branch' : 'smoothstep', class: edgeKind === 'link' ? 'relation-edge' : 'tree-edge', data: { kind: edgeKind } }
}

export function insertTreeEdgeAfter(edges, edge, siblingId) {
  const siblingIndex = edges.findIndex((item) => item.data?.kind === 'tree'
    && item.source === edge.source
    && item.target === siblingId)
  if (siblingIndex < 0) edges.push(edge)
  else edges.splice(siblingIndex + 1, 0, edge)
}

export function orientEdges(nodes, edges, layout = 'both') {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  for (const edge of edges) {
    if (edge.data?.kind !== 'tree') continue
    const target = nodesById.get(edge.target)
    const side = target?.data?.side === 'left' ? 'left' : 'right'
    edge.sourceHandle = layout === 'tree' ? 'source-tree' : `source-${side}`
    edge.targetHandle = `target-${side === 'left' ? 'right' : 'left'}`
    edge.style = { stroke: paint(target?.data?.color ?? COLORS[0]), strokeWidth: 2 }
  }
  return edges
}

export function descendantsOf(id, edges) {
  const children = new Map()
  for (const edge of edges) {
    if (edge.data?.kind !== 'tree') continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(edge.target)
  }

  const found = new Set()
  const queue = [...(children.get(id) ?? [])]
  while (queue.length) {
    const child = queue.shift()
    if (found.has(child)) continue
    found.add(child)
    queue.push(...(children.get(child) ?? []))
  }
  return found
}

export function rigidRootBranch(node, dragged, edges) {
  if (!node?.data?.root || dragged.length !== 1) return null
  const nodeIds = [node.id, ...descendantsOf(node.id, edges)]
  if (nodeIds.length === 1) return null
  const branch = new Set(nodeIds)
  if (edges.some((edge) => branch.has(edge.source) !== branch.has(edge.target))) return null
  return { nodeIds, edgeIds: edges.filter((edge) => branch.has(edge.source)).map((edge) => edge.id) }
}

export function mergeImageNode(nodes, edges, sourceId, targetId) {
  const source = nodes.find((node) => node.id === sourceId)
  const target = nodes.find((node) => node.id === targetId)
  const fail = (error) => ({ nodes, edges, error })
  if (!source?.data?.image || source.data.label?.trim() || !target?.data?.label?.trim()) return fail('invalid-source')
  if (target.data.image) return fail('target-has-image')
  if (descendantsOf(sourceId, edges).has(targetId)) return fail('cycle')

  return {
    error: null,
    nodes: nodes
      .filter((node) => node.id !== sourceId)
      .map((node) => node.id === targetId ? { ...node, data: { ...node.data, image: source.data.image } } : node),
    edges: edges.flatMap((edge) => {
      if (edge.data?.kind === 'link' && (edge.source === sourceId || edge.target === sourceId)) return []
      if (edge.data?.kind === 'tree' && edge.target === sourceId) return []
      if (edge.data?.kind === 'tree' && edge.source === sourceId) return [{ ...edge, source: targetId }]
      return [edge]
    }),
  }
}

// Pick the visually nearest node in an arrow-key direction. This follows the
// current layout on screen, so it also works for manually positioned maps.
export function nodeInDirection(nodes, currentId, direction) {
  const current = nodes.find((node) => node.id === currentId && !node.hidden)
  if (!current) return null
  const center = (node) => ({
    x: node.position.x + (node.dimensions?.width || DEFAULT_SIZE.width) / 2,
    y: node.position.y + (node.dimensions?.height || DEFAULT_SIZE.height) / 2,
  })
  const origin = center(current)
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'left' || direction === 'up' ? -1 : 1
  let best = null
  let bestScore = Infinity
  for (const node of nodes) {
    if (node.id === current.id || node.hidden) continue
    const point = center(node)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    const forward = (horizontal ? dx : dy) * sign
    if (forward <= 0) continue
    const sideways = Math.abs(horizontal ? dy : dx)
    if (forward * 2 < sideways) continue
    const score = forward + sideways * 2
    if (score < bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

const intervalGap = (a0, a1, b0, b1) => Math.max(a0 - b1, b0 - a1, 0)

// Shift-drag smart guides for center alignment and equal gaps.
export function snapNode(rect, candidates, threshold, maxDistance) {
  const options = { x: [], y: [] }
  const axes = { x: ['width', 'y', 'height'], y: ['height', 'x', 'width'] }
  const end = (item, axis) => item[axis] + item[axes[axis][0]]
  const center = (item, axis) => item[axis] + item[axes[axis][0]] / 2
  const gap = (a, b, axis) => intervalGap(a[axis], end(a, axis), b[axis], end(b, axis))
  const alignGuide = (axis, at, from, to) => axis === 'x'
    ? { x1: at, y1: from, x2: at, y2: to }
    : { x1: from, y1: at, x2: to, y2: at }
  const gapGuide = (axis, from, to, at) => axis === 'x'
    ? { x1: (from + to) / 2, y1: at - 8, x2: (from + to) / 2, y2: at + 8 }
    : { x1: at - 8, y1: (from + to) / 2, x2: at + 8, y2: (from + to) / 2 }
  const add = (axis, delta, distance, guides, priority = 1) => {
    if (Math.abs(delta) <= threshold && distance <= maxDistance) options[axis].push({ delta, distance, guides, priority })
  }

  // ponytail: only the nearest 50 blocks participate; use a spatial index if dense maps need more.
  const nearby = candidates
    .filter((candidate) => Math.min(gap(rect, candidate, 'x'), gap(rect, candidate, 'y')) <= maxDistance)
    .sort((a, b) => Math.hypot(center(a, 'x') - center(rect, 'x'), center(a, 'y') - center(rect, 'y'))
      - Math.hypot(center(b, 'x') - center(rect, 'x'), center(b, 'y') - center(rect, 'y')))
    .slice(0, 50)

  for (const axis of ['x', 'y']) {
    const [size, cross, crossSize] = axes[axis]
    for (const candidate of nearby) {
      add(axis, center(candidate, axis) - center(rect, axis), gap(rect, candidate, cross), (moved) => [
        alignGuide(axis, center(candidate, axis), Math.min(moved[cross], candidate[cross]), Math.max(end(moved, cross), end(candidate, cross))),
      ], 0)
    }
    for (let i = 0; i < nearby.length; i += 1) {
      for (let j = i + 1; j < nearby.length; j += 1) {
        const [first, second] = nearby[i][axis] <= nearby[j][axis] ? [nearby[i], nearby[j]] : [nearby[j], nearby[i]]
        if (end(first, axis) > second[axis] || gap(first, second, cross)
          || gap(rect, first, cross) || gap(rect, second, cross)) continue
        const space = second[axis] - end(first, axis)
        const arrangements = space >= rect[size] ? [{
          position: (end(first, axis) + second[axis] - rect[size]) / 2,
          segments: (moved) => [[end(first, axis), moved[axis]], [end(moved, axis), second[axis]]],
        }] : []
        if (space > 0) arrangements.push(
          { position: first[axis] - space - rect[size], segments: (moved) => [[end(moved, axis), first[axis]], [end(first, axis), second[axis]]] },
          { position: end(second, axis) + space, segments: (moved) => [[end(first, axis), second[axis]], [end(second, axis), moved[axis]]] },
        )
        for (const arrangement of arrangements) {
          add(axis, arrangement.position - rect[axis], 0, (moved) => arrangement.segments(moved)
            .map(([from, to]) => gapGuide(axis, from, to, moved[cross] + moved[crossSize] / 2)))
        }
      }
    }
  }

  const best = (axis) => options[axis].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.priority - b.priority || a.distance - b.distance)[0]
  const x = best('x')
  const y = best('y')
  const moved = { ...rect, x: rect.x + (x?.delta ?? 0), y: rect.y + (y?.delta ?? 0) }
  return { x: moved.x, y: moved.y, guides: [...(x?.guides(moved) ?? []), ...(y?.guides(moved) ?? [])] }
}

export const DEFAULT_SIZE = { width: 180, height: 30, rootWidth: 200, rootHeight: 56 }

export function layoutVerticalGap(settings = DEFAULT_SETTINGS) {
  return 18 * DENSITY[normalizeSettings(settings).density]
}

export function shiftNodesBelow(nodes, y, amount, excluded = new Set()) {
  if (amount <= 0) return
  for (const node of nodes) {
    if (excluded.has(node.id) || node.position.y < y - 0.5) continue
    node.position = { ...node.position, y: node.position.y + amount }
  }
}

export function layoutNodes(nodes, edges, sizeOf = () => null, settings = DEFAULT_SETTINGS) {
  const { layout, density } = normalizeSettings(settings)
  const horizontalGap = 100
  const verticalGap = layoutVerticalGap({ density })
  const treeIndent = 36
  const treeGap = 140
  const treeEdges = edges.filter((edge) => edge.data?.kind === 'tree')
  const children = new Map(nodes.map((node) => [node.id, []]))
  const hasParent = new Set()
  for (const edge of treeEdges) {
    if (!children.has(edge.source) || !children.has(edge.target)) continue
    children.get(edge.source).push(edge.target)
    hasParent.add(edge.target)
  }

  const size = (id) => {
    const measured = sizeOf(id)
    const root = !hasParent.has(id)
    return {
      width: measured?.width || (root ? DEFAULT_SIZE.rootWidth : DEFAULT_SIZE.width),
      height: measured?.height || (root ? DEFAULT_SIZE.rootHeight : DEFAULT_SIZE.height),
    }
  }
  const roots = nodes.filter((node) => !hasParent.has(node.id))
  if (!roots.length && nodes[0]) roots.push(nodes[0])
  const spanCache = new Map()
  const stack = (ids, trail) => ids.reduce((sum, id) => sum + span(id, trail), 0) + Math.max(0, ids.length - 1) * verticalGap
  const span = (id, trail = new Set()) => {
    if (spanCache.has(id)) return spanCache.get(id)
    if (trail.has(id)) return size(id).height
    const value = Math.max(size(id).height, stack(children.get(id) ?? [], new Set(trail).add(id)))
    spanCache.set(id, value)
    return value
  }

  const positioned = new Set()
  const trees = roots.map((root) => {
    const rootSize = size(root.id)
    const positions = new Map([[root.id, { x: 0, y: 0, side: 'root', ...rootSize }]])
    positioned.add(root.id)
    const rootChildren = children.get(root.id) ?? []
    if (layout === 'tree') {
      // Tree: each node on its own row, children below and indented to the right.
      let cursor = rootSize.height + verticalGap
      const place = (id, x) => {
        if (positioned.has(id)) return
        positioned.add(id)
        const own = size(id)
        positions.set(id, { x, y: cursor, side: 'right', ...own })
        cursor += own.height + verticalGap
        for (const child of children.get(id) ?? []) place(child, x + treeIndent)
      }
      for (const id of rootChildren) place(id, treeIndent)
      const placed = [...positions.values()]
      const maxX = Math.max(...placed.map((position) => position.x + position.width))
      const maxY = Math.max(...placed.map((position) => position.y + position.height))
      return { positions, minX: 0, minY: 0, width: maxX, height: maxY }
    }
    const total = rootChildren.reduce((sum, child) => sum + span(child), 0)
    let split = 0
    let rightSpan = 0
    while (split < rootChildren.length && (layout === 'right' || rightSpan < total / 2)) rightSpan += span(rootChildren[split++])
    const right = rootChildren.slice(0, split)
    const left = rootChildren.slice(split).reverse()

    const placeSide = (ids, side) => {
      const place = (id, anchorX, top) => {
        if (positioned.has(id)) return
        positioned.add(id)
        const own = size(id)
        const ownSpan = span(id)
        const x = side === 'left' ? anchorX - horizontalGap - own.width : anchorX + horizontalGap
        positions.set(id, { x, y: top + (ownSpan - own.height) / 2, side, ...own })
        const kids = children.get(id) ?? []
        let childTop = top + (ownSpan - stack(kids)) / 2
        for (const child of kids) {
          place(child, side === 'left' ? x : x + own.width, childTop)
          childTop += span(child) + verticalGap
        }
      }
      let top = (rootSize.height - stack(ids)) / 2
      for (const id of ids) {
        place(id, side === 'left' ? 0 : rootSize.width, top)
        top += span(id) + verticalGap
      }
    }

    placeSide(right, 'right')
    placeSide(left, 'left')
    const placed = [...positions.values()]
    const minX = Math.min(...placed.map((position) => position.x))
    const minY = Math.min(...placed.map((position) => position.y))
    const maxX = Math.max(...placed.map((position) => position.x + position.width))
    const maxY = Math.max(...placed.map((position) => position.y + position.height))
    return { positions, minX, minY, width: maxX - minX, height: maxY - minY }
  })

  for (const node of nodes) {
    if (positioned.has(node.id)) continue
    const own = size(node.id)
    trees.push({ positions: new Map([[node.id, { x: 0, y: 0, side: 'root' }]]), minX: 0, minY: 0, ...own })
  }

  const columns = trees.length <= 3 ? trees.length : Math.max(2, Math.round(Math.sqrt(trees.length)))
  const finalPositions = new Map()
  let canvasY = 0
  for (let index = 0; index < trees.length; index += columns) {
    const row = trees.slice(index, index + columns)
    const rowHeight = Math.max(...row.map((tree) => tree.height))
    let canvasX = 0
    for (const tree of row) {
      const offsetX = canvasX - tree.minX
      const offsetY = canvasY + (rowHeight - tree.height) / 2 - tree.minY
      for (const [id, position] of tree.positions) {
        finalPositions.set(id, { x: position.x + offsetX, y: position.y + offsetY, side: position.side })
      }
      canvasX += tree.width + treeGap
    }
    canvasY += rowHeight + treeGap
  }

  const laidOut = nodes.map((node) => {
    const position = finalPositions.get(node.id) ?? { ...node.position, side: node.data?.side ?? 'root' }
    return {
      ...node,
      position: { x: position.x, y: position.y },
      data: { ...node.data, root: !hasParent.has(node.id), side: position.side },
    }
  })
  orientEdges(laidOut, edges, layout)
  return laidOut
}

export function normalizeMap(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new Error('This file is not a Mindspace map')
  }
  if (!input.nodes.length || input.nodes.length > 5000 || input.edges.length > 10000) {
    throw new Error('The map is empty or too large')
  }

  const ids = new Set()
  const nodes = input.nodes.map((node, index) => {
    const id = typeof node?.id === 'string' && node.id && !ids.has(node.id) ? node.id : uid()
    ids.add(id)
    const image = normalizeImageReference(node?.data?.image)
    const label = typeof node?.data?.label === 'string'
      ? node.data.label.slice(0, 500)
      : input.version === 3 && image ? '' : `Idea ${index + 1}`
    if (input.version === 3 && !label.trim() && !image) throw new Error('The map contains an empty block')
    return makeNode(
      label,
      {
        x: Number.isFinite(node?.position?.x) ? node.position.x : 0,
        y: Number.isFinite(node?.position?.y) ? node.position.y : index * 112,
      },
      { id, ...node.data, image },
    )
  })
  const edges = input.edges
    .filter((edge) => ids.has(edge?.source) && ids.has(edge?.target) && edge.source !== edge.target)
    .map((edge) => {
      const normalized = makeEdge(edge.source, edge.target, edge.data?.kind, typeof edge.id === 'string' ? edge.id : undefined)
      if (normalized.data.kind === 'link') {
        normalized.sourceHandle = edge.sourceHandle
        normalized.targetHandle = edge.targetHandle
      }
      return normalized
    })

  const childIds = new Set(edges.filter((edge) => edge.data.kind === 'tree').map((edge) => edge.target))
  nodes.forEach((node) => (node.data.root = !childIds.has(node.id)))
  const settings = normalizeSettings(input.settings)
  orientEdges(nodes, edges, settings.layout)
  const map = {
    version: nodes.some((node) => node.data.image) ? 3 : 2,
    title: typeof input.title === 'string' ? input.title.slice(0, 100) : 'Untitled',
    autoLayout: Boolean(input.autoLayout),
    settings,
    nodes,
    edges,
  }
  // Positions from pre-redesign maps assume fixed-width nodes — they need a one-time re-layout.
  if (input.version !== 2 && input.version !== 3) Object.defineProperty(map, 'needsLayout', { value: true })
  return map
}

export function normalizeLibrary(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.documents)) {
    throw new Error('Local maps are corrupted')
  }
  const ids = new Set()
  const documents = []
  for (const document of input.documents) {
    if (typeof document?.id !== 'string' || !document.id || ids.has(document.id)) continue
    try {
      const entry = { id: document.id, map: normalizeMap(document.map) }
      if (Number.isFinite(document.updatedAt)) entry.updatedAt = document.updatedAt
      documents.push(entry)
      ids.add(document.id)
    } catch {
      // One corrupted map must not block the rest.
    }
  }
  if (!documents.length) throw new Error('No local maps available')
  return {
    version: 1,
    activeId: ids.has(input.activeId) ? input.activeId : documents[0].id,
    documents,
  }
}

const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`)

export function toOpml(map) {
  const children = new Map()
  const childIds = new Set()
  for (const edge of map.edges) {
    if (edge.data?.kind !== 'tree') continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(edge.target)
    childIds.add(edge.target)
  }
  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const visited = new Set()
  const outline = (id, depth) => {
    const node = byId.get(id)
    if (!node || visited.has(id)) return ''
    visited.add(id)
    const pad = '  '.repeat(depth)
    const inner = (children.get(id) ?? []).map((child) => outline(child, depth + 1)).join('')
    const attributes = `text="${escapeXml(node.data.label || (node.data.image ? '[Image]' : 'Untitled'))}"${node.data.note ? ` _note="${escapeXml(node.data.note)}"` : ''}`
    return inner ? `${pad}<outline ${attributes}>\n${inner}${pad}</outline>\n` : `${pad}<outline ${attributes}/>\n`
  }
  const body = map.nodes.filter((node) => !childIds.has(node.id)).map((node) => outline(node.id, 2)).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${escapeXml(map.title)}</title>\n  </head>\n  <body>\n${body}  </body>\n</opml>\n`
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

export const pluralNodes = (count) => plural(count, 'node', 'nodes')

export function relativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.floor((now - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const date = new Date(timestamp)
  const today = new Date(now)
  const days = Math.round((new Date(today.toDateString()) - new Date(date.toDateString())) / 86400000)
  if (days === 0) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

export function parseOpml(text) {
  const document = new DOMParser().parseFromString(text, 'text/xml')
  if (document.querySelector('parsererror')) throw new Error('Could not read the OPML file')
  const outlines = [...(document.querySelector('body')?.children ?? [])].filter((element) => element.tagName === 'outline')
  if (!outlines.length) throw new Error('The OPML file has no outline elements')

  const nodes = []
  const edges = []
  const addOutline = (element, parentId = null, color = COLORS[0]) => {
    if (nodes.length >= 5000) throw new Error('The OPML file has more than 5000 nodes')
    const label = element.getAttribute('text') || element.getAttribute('title') || 'Untitled'
    const node = makeNode(label, undefined, { color, note: element.getAttribute('_note') ?? '' })
    nodes.push(node)
    if (parentId) edges.push(makeEdge(parentId, node.id))
    const outlineChildren = [...element.children].filter((child) => child.tagName === 'outline')
    outlineChildren.forEach((child, index) => addOutline(child, node.id, parentId ? color : branchColor(index)))
    return node
  }

  const roots = outlines.map((outline, index) => {
    const root = addOutline(outline, null, branchColor(index))
    root.data.root = true
    return root
  })
  return {
    version: 2,
    title: document.querySelector('head > title')?.textContent || roots[0].data.label,
    autoLayout: true,
    nodes: layoutNodes(nodes, edges),
    edges,
  }
}

// First-run map: a short tour where each node demonstrates what it describes.
export function starterMap() {
  const nodes = []
  const edges = []
  const add = (parent, label, options = {}) => {
    const node = makeNode(label, {}, { color: parent?.data.color, ...options })
    nodes.push(node)
    if (parent) edges.push(makeEdge(parent.id, node.id))
    return node
  }
  const root = add(null, 'Welcome to Mindspace', { root: true, color: COLORS[0], note: 'A quick tour — edit or delete anything' })

  const build = add(root, 'Build your map', { color: COLORS[0] })
  add(build, 'Tab adds a child idea')
  add(build, 'Enter adds a sibling')
  add(build, 'Double-click to edit', { note: 'Shift + Enter adds a second line, like this' })

  const organize = add(root, 'Organize', { color: COLORS[1] })
  add(organize, 'Drag a node onto another to move it')
  add(organize, 'Drag from a node’s edge to link ideas')
  const collapsed = add(organize, 'This branch is collapsed', { collapsed: true, note: 'Click the counter to expand it' })
  add(collapsed, 'Hidden ideas stay out of the way')
  add(collapsed, 'until you need them')

  const style = add(root, 'Make it yours', { color: COLORS[2] })
  add(style, 'Line', { note: 'The default node style' })
  add(style, 'Card', { style: 'card', note: 'Stands out a little more' })
  add(style, 'Plain text', { style: 'text' })
  add(style, 'Open the side panel to change colors and layout')

  const maps = add(root, 'Your maps', { color: COLORS[3] })
  add(maps, 'Saved in this browser', { note: 'Nothing leaves your device' })
  add(maps, 'Export to .mindmap or OPML')
  add(maps, 'Press ? to see every shortcut')

  const map = { version: 2, title: 'Welcome to Mindspace', autoLayout: true, nodes, edges }
  map.nodes = layoutNodes(map.nodes, map.edges)
  return map
}

// Map search: case-insensitive, ё matches е. Both keep string length, so match offsets map back to the original text.
export const normalizeSearch = (text) => text.toLowerCase().replaceAll('ё', 'е')

// Depth-first in visual order: roots top to bottom (then left to right), children top to bottom.
export function searchOrder(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map()
  const hasParent = new Set()
  for (const edge of edges) {
    if (edge.data?.kind !== 'tree' || !byId.has(edge.source) || !byId.has(edge.target)) continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(byId.get(edge.target))
    hasParent.add(edge.target)
  }
  const visual = (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
  const order = []
  const seen = new Set()
  const visit = (node) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    order.push(node.id)
    ;[...(children.get(node.id) ?? [])].sort(visual).forEach(visit)
  }
  nodes.filter((node) => !hasParent.has(node.id)).sort(visual).forEach(visit)
  nodes.forEach(visit)
  return order
}

// The first match after anchorId in search order, wrapping around.
export function nextMatch(order, matches, anchorId) {
  const position = new Map(order.map((id, at) => [id, at]))
  const from = position.get(anchorId) ?? -1
  return matches.find((id) => position.get(id) > from) ?? matches[0] ?? null
}

// Splits text into plain and matched parts; no empty parts.
export function highlightParts(text, term) {
  const haystack = normalizeSearch(text)
  if (!term || haystack.length !== text.length) return [{ text, match: false }]
  const parts = []
  let from = 0
  for (let at = haystack.indexOf(term); at >= 0; at = haystack.indexOf(term, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    from = at + term.length
    parts.push({ text: text.slice(at, from), match: true })
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}
