<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { BaseEdge, ConnectionMode, Handle, Position, VueFlow, getRectOfNodes, getTransformForBounds, useVueFlow } from '@vue-flow/core'
import {
  DEFAULT_SIZE,
  LIBRARY_STORAGE_KEY,
  PALETTES,
  STORAGE_KEY,
  branchColor,
  descendantsOf,
  highlightParts,
  insertTreeEdgeAfter,
  layoutVerticalGap,
  layoutNodes,
  makeEdge,
  makeNode,
  mergeImageNode,
  nextMatch,
  nodeInDirection,
  normalizeLibrary,
  normalizeMap,
  normalizeSearch,
  normalizeSettings,
  nodeStyle,
  orientEdges,
  paletteColors,
  parseOpml,
  plural,
  pluralNodes,
  recolorForPalette,
  referencedAssetIds,
  relativeTime,
  searchOrder,
  shiftNodesBelow,
  snapNode,
  starterMap,
  toOpml,
} from './model.js'
import { createMindmapFile, readMindmapFile } from './archive.js'
import { createImageAsset, deleteImageAssets, loadImageAsset, pruneImageAssets, saveImageAssets } from './assets.js'
import Logo from './Logo.vue'
import { IS_MAC, MULTI_SELECT_KEY, PAN_KEY, findShortcut, keyLabel, shortcutGroups, shortcutKeys } from './shortcuts.js'

const SEEN_VERSION_KEY = 'mindspace-seen-version'
const SHORTCUTS_TIP_KEY = 'mindspace-shortcuts-tip'
const APP_VERSION = import.meta.env.VITE_APP_VERSION
const REPOSITORY_URL = import.meta.env.VITE_REPOSITORY_URL
const INSPECTOR_KEY = 'mindspace-inspector-open'
const documentId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
let initialLibrary
try {
  const savedLibrary = localStorage.getItem(LIBRARY_STORAGE_KEY)
  if (savedLibrary) initialLibrary = normalizeLibrary(JSON.parse(savedLibrary))
  else {
    const savedMap = localStorage.getItem(STORAGE_KEY)
    const id = documentId()
    initialLibrary = { version: 1, activeId: id, documents: [{ id, map: savedMap ? normalizeMap(JSON.parse(savedMap)) : starterMap() }] }
  }
} catch {
  const id = documentId()
  initialLibrary = { version: 1, activeId: id, documents: [{ id, map: starterMap() }] }
}

const documents = ref(initialLibrary.documents)
const activeId = ref(initialLibrary.activeId)
const initial = documents.value.find((document) => document.id === activeId.value).map
const title = ref(initial.title)
const autoLayout = ref(initial.autoLayout)
const settings = ref(normalizeSettings(initial.settings))
const nodes = ref(initial.nodes)
let pendingLayoutInitial = Boolean(initial.needsLayout)
const edges = ref(initial.edges)
const editingId = ref(null)
const editDraft = ref({ label: '', note: '' })
const dropTargetId = ref(null)
const contextMenu = ref(null)
const fileInput = ref(null)
let savedInspector = false
try {
  savedInspector = localStorage.getItem(INSPECTOR_KEY) === '1'
} catch {
  // Without storage the panel just stays closed.
}
const inspectorOpen = ref(savedInspector)
const inspectorBody = ref(null)
const inheritColor = ref(true)
let panelEditStart = null
const documentsOpen = ref(false)
const exportOpen = ref(false)
const exportBusy = ref(false)
const renaming = ref(false)
const documentQuery = ref('')
const rowMenu = ref(null)
const renamingDocId = ref(null)
const renameDraft = ref('')
const flashDocId = ref(null)
const deletion = ref(null)
const documentMenu = ref(null)
const renameInput = ref(null)
const now = ref(Date.now())
const history = ref([])
const future = ref([])
const saveState = ref('saved')
const toast = ref('')
const toastTip = ref(false)
const appMenuOpen = ref(false)
const appMenu = ref(null)
const brandButton = ref(null)
const versionCopied = ref(false)
let seenVersion = null
try {
  seenVersion = localStorage.getItem(SEEN_VERSION_KEY)
} catch {
  // Without storage the What’s new dot just stays visible.
}
const whatsNewUnseen = ref(seenVersion !== APP_VERSION)
const helpOpen = ref(false)
const helpDialog = ref(null)
const imageDialog = ref(null)
const imagePreview = ref(null)
const imageUrls = reactive(new Map())
const helpGroups = shortcutGroups()
const keysLabel = (id) => shortcutKeys(id).join(' ')
let helpReturnFocus = null
let imageReturnFocus = null
let imageLoadGeneration = 0
let copiedTimer
const { connectionStartHandle, dimensions, getNodes, screenToFlowCoordinate, setCenter, setViewport, viewport, zoomIn, zoomOut, zoomTo } = useVueFlow()
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))
// The panel floats over the canvas: its margin and width don't count as visible area.
const INSPECTOR_SPACE = 12 + 320 + 12
const easeOut = (t) => 1 - (1 - t) ** 3
const canvasElement = ref(null)
const alignmentGuides = ref([])

// A large map fits entirely into the visible area; a small one is zoomed in, but no more than 125%.
function focusMap(duration = 300) {
  const visible = getNodes.value.filter((node) => !node.hidden)
  const { width, height } = dimensions.value
  if (!visible.length || !width || !height) return
  const available = Math.max(200, width - (inspectorOpen.value ? INSPECTOR_SPACE : 0))
  const transform = getTransformForBounds(getRectOfNodes(visible), available, height, 0.2, 1.25, 0.18)
  setViewport(transform, { duration })
}

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2

// Vue Flow zooms on ctrl+wheel only on macOS (trackpad pinch sends such events); on Windows and Linux
// the same gesture pans. Take it over on every platform, zooming toward the cursor like Vue Flow's pinch zoom does.
// Cmd+wheel is the idiomatic macOS zoom, so accept it there as well.
function onCanvasWheel(event) {
  if (!event.ctrlKey && !(IS_MAC && event.metaKey)) return
  event.preventDefault()
  event.stopPropagation()
  const { x: viewX, y: viewY, zoom: current } = viewport.value
  const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * (IS_MAC ? 10 : 1)
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * 2 ** delta))
  const rect = canvasElement.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  // The point under the cursor stays under it at the new zoom.
  setViewport({ x: x - (x - viewX) * (zoom / current), y: y - (y - viewY) * (zoom / current), zoom })
}
let dragStart = null
let editStart = null
let saveTimer
let toastTimer
let initialFitDone = false
let clockTimer
let dirty = false
let dragOrigin = null
let dragBranch = null
let layoutFrame = 0
let pendingLayout = pendingLayoutInitial
let pendingFocus = false
let focusTimer
const measuredNodeHeights = new Map()
let pendingRevealId = null

const selectedNodes = computed(() => nodes.value.filter((node) => node.selected && !node.hidden))
const selectedCount = computed(() => selectedNodes.value.length)
const primaryNode = computed(() => selectedNodes.value.at(-1))
const rootCount = computed(() => nodes.value.filter((node) => node.data.root).length)
const removableSelectedNodes = computed(() => {
  const selectedRoots = selectedNodes.value.filter((node) => node.data.root)
  const protectedId = selectedRoots.length === rootCount.value ? selectedRoots[0]?.id : null
  return selectedNodes.value.filter((node) => node.id !== protectedId)
})
const activeDocument = computed(() => documents.value.find((document) => document.id === activeId.value))
const saveLabel = computed(() => ({ saved: 'Saved on this device', saving: 'Saving…', error: 'Could not save' })[saveState.value])
const documentTitle = (document) => (document.id === activeId.value ? title.value : document.map.title)
// Newest first; maps without a date go last, in their original order.
const sortedDocuments = computed(() => documents.value
  .map((document, index) => ({ document, index }))
  .sort((a, b) => (b.document.updatedAt ?? 0) - (a.document.updatedAt ?? 0) || a.index - b.index)
  .map(({ document }) => document))
const documentItems = computed(() => {
  const query = documentQuery.value.trim().toLowerCase()
  return sortedDocuments.value
    .filter((document) => !query || documentTitle(document).toLowerCase().includes(query))
    .map((document) => {
      const active = document.id === activeId.value
      return {
        id: document.id,
        active,
        title: documentTitle(document),
        meta: [pluralNodes(active ? nodes.value.length : document.map.nodes.length), relativeTime(document.updatedAt, now.value)]
          .filter(Boolean).join(' · '),
      }
    })
})
const nodesById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const parentOf = computed(() => new Map(edges.value
  .filter((edge) => edge.data?.kind === 'tree')
  .map((edge) => [edge.target, edge.source])))
const inspectorMode = computed(() => (selectedCount.value > 1 ? 'multi' : selectedCount.value === 1 ? 'node' : 'map'))
const primaryDescendants = computed(() => (primaryNode.value ? descendantsOf(primaryNode.value.id, edges.value).size : 0))
const primaryLevel = computed(() => (primaryNode.value ? (depths.value.get(primaryNode.value.id) ?? 0) + 1 : 0))
const nodePath = computed(() => {
  const node = primaryNode.value
  if (!node) return ''
  if (node.data.root) return 'Root node'
  const parent = nodesById.value.get(parentOf.value.get(node.id))
  if (!parent) return ''
  return (parentOf.value.has(parent.id) ? '… › ' : '') + `${nodeLabel(parent)} ›`
})
const sharedValue = (read) => {
  const values = new Set(selectedNodes.value.map(read))
  return values.size === 1 ? [...values][0] : null
}
const selectedColor = computed(() => sharedValue((node) => node.data.color))
const selectedStyle = computed(() => sharedValue((node) => nodeStyle(node.data)))
const swatches = computed(() => paletteColors(settings.value.palette))
const topicCount = computed(() => edges.value.filter((edge) => edge.data?.kind === 'tree' && nodesById.value.get(edge.source)?.data.root).length)
const STYLE_OPTIONS = [['line', 'Line'], ['card', 'Card'], ['text', 'Text']]
const LAYOUT_OPTIONS = [['right', 'Right'], ['both', 'Both sides'], ['tree', 'Tree']]
const LINE_OPTIONS = [['smooth', 'Smooth'], ['straight', 'Straight']]
const DENSITY_OPTIONS = [['compact', 'Compact'], ['normal', 'Normal'], ['loose', 'Loose']]
const childNodesLabel = (count) => plural(count, 'child node', 'child nodes')
const nodeLabel = (node) => node?.data?.label || node?.data?.image?.name || 'Untitled'

const depths = computed(() => {
  const children = new Map()
  for (const edge of edges.value) {
    if (edge.data?.kind !== 'tree') continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(edge.target)
  }
  const result = new Map()
  const queue = nodes.value.filter((node) => node.data.root).map((node) => [node.id, 0])
  while (queue.length) {
    const [id, depth] = queue.shift()
    if (result.has(id)) continue
    result.set(id, depth)
    for (const child of children.get(id) ?? []) queue.push([child, depth + 1])
  }
  return result
})
const defaultEdgeOptions = {
  style: { strokeWidth: 2 },
}

// Connector: from the parent's edge to the node's bottom corner — a point on the underline.
// Handles sit exactly at these points, and Vue Flow recomputes their coordinates on any resize.
function branchPath({ sourceX, sourceY, targetX, targetY, sourcePosition }) {
  if (sourcePosition === Position.Bottom) {
    // Tree: down from the parent, then a rounded turn toward the node.
    const radius = Math.max(0, Math.min(8, targetY - sourceY, targetX - sourceX))
    return `M${sourceX},${sourceY} L${sourceX},${targetY - radius} Q${sourceX},${targetY} ${sourceX + radius},${targetY} L${targetX},${targetY}`
  }
  if (settings.value.lines === 'straight') return `M${sourceX},${sourceY} L${targetX},${targetY}`
  const bend = sourcePosition === Position.Left ? -60 : 60
  return `M${sourceX},${sourceY} C${sourceX + bend},${sourceY} ${targetX - bend},${targetY} ${targetX},${targetY}`
}


function cleanMap() {
  return {
    version: nodes.value.some((node) => node.data.image) ? 3 : 2,
    title: title.value.trim() || 'Untitled',
    autoLayout: autoLayout.value,
    settings: { ...settings.value },
    nodes: nodes.value.map((node) => ({
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
        ...(node.data.image ? { image: {
          assetId: node.data.image.assetId,
          name: node.data.image.name,
          mime: node.data.image.mime,
          naturalWidth: node.data.image.naturalWidth,
          naturalHeight: node.data.image.naturalHeight,
        } } : {}),
      },
    })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.kind === 'link' ? 'smoothstep' : 'default',
      class: edge.data?.kind === 'link' ? 'relation-edge' : 'tree-edge',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: { kind: edge.data?.kind === 'link' ? 'link' : 'tree' },
    })),
  }
}

const snapshot = () => JSON.stringify(cleanMap())

function record(before) {
  if (!before || before === snapshot()) return
  history.value.push(before)
  if (history.value.length > 60) history.value.shift()
  future.value = []
}

function openMap(map) {
  const normalized = normalizeMap(map)
  pendingLayout = normalized.needsLayout
  measuredNodeHeights.clear()
  title.value = normalized.title
  autoLayout.value = normalized.autoLayout
  settings.value = normalized.settings
  nodes.value = normalized.nodes
  edges.value = normalized.edges
  editingId.value = null
  contextMenu.value = null
  applyVisibility()
  hydrateImageUrls()
}

function restore(raw) {
  openMap(JSON.parse(raw))
}

function undo() {
  if (!history.value.length) return
  future.value.push(snapshot())
  restore(history.value.pop())
}

function redo() {
  if (!future.value.length) return
  history.value.push(snapshot())
  restore(future.value.pop())
}

function notify(message, { duration = 2600, tip = false } = {}) {
  toast.value = message
  toastTip.value = tip
  clearTimeout(toastTimer)
  clearTimeout(rowClickTimer)
  finalizeDeletion()
  toastTimer = setTimeout(() => (toast.value = ''), duration)
}

function clearImageUrls() {
  imageLoadGeneration += 1
  for (const url of imageUrls.values()) URL.revokeObjectURL(url)
  imageUrls.clear()
}

function pruneImageUrls() {
  const used = new Set(nodes.value.flatMap((node) => node.data.image?.assetId ? [node.data.image.assetId] : []))
  for (const [assetId, url] of imageUrls) {
    if (used.has(assetId)) continue
    URL.revokeObjectURL(url)
    imageUrls.delete(assetId)
  }
}

async function hydrateImageUrls() {
  clearImageUrls()
  const generation = imageLoadGeneration
  const ids = new Set(nodes.value.flatMap((node) => node.data.image?.assetId ? [node.data.image.assetId] : []))
  await Promise.all([...ids].map(async (assetId) => {
    try {
      const record = await loadImageAsset(assetId)
      if (!record || generation !== imageLoadGeneration
        || !nodes.value.some((node) => node.data.image?.assetId === assetId)) return
      const url = URL.createObjectURL(record.blob)
      if (generation !== imageLoadGeneration) URL.revokeObjectURL(url)
      else imageUrls.set(assetId, url)
    } catch {
      // A missing local blob leaves a filename placeholder instead of breaking the map.
    }
  }))
}

const imageOnly = (node) => Boolean(node?.data?.image && !node.data.label?.trim())

async function addImageFile(file, center) {
  const documentAtStart = activeId.value
  if (referencedAssetIds(cleanMap()).size >= 100) return notify('A map can contain up to 100 images.')
  try {
    const asset = await createImageAsset(file)
    if (activeId.value !== documentAtStart) return notify('Image was not added because the map changed.')
    await saveImageAssets([asset])
    if (activeId.value !== documentAtStart || referencedAssetIds(cleanMap()).size >= 100) {
      await deleteImageAssets([asset.image.assetId]).catch(() => {})
      return notify(activeId.value !== documentAtStart
        ? 'Image was not added because the map changed.'
        : 'A map can contain up to 100 images.')
    }
    const before = snapshot()
    const node = makeNode('', { x: center.x - 180, y: center.y - 140 }, {
      root: true,
      color: branchColor(rootCount.value, settings.value.palette),
      image: asset.image,
    })
    nodes.value.push(node)
    imageUrls.set(asset.image.assetId, URL.createObjectURL(asset.blob))
    selectOnly(node.id)
    autoLayout.value = false
    record(before)
    notify('Image added · Auto layout off')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'The image could not be saved on this device.')
  }
}

function onPaste(event) {
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  if (files.length !== 1) return notify('Paste one image at a time.')
  const bounds = canvasElement.value?.getBoundingClientRect()
  if (!bounds) return
  addImageFile(files[0], screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }))
}

function onImageDrop(event) {
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length !== 1) return notify('Drop one image at a time.')
  addImageFile(files[0], screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

function openImagePreview(id) {
  const node = nodes.value.find((item) => item.id === id)
  const src = imageUrls.get(node?.data?.image?.assetId)
  if (!src) return
  imageReturnFocus = document.querySelector(`[data-mind-node="${CSS.escape(id)}"]`)
  imagePreview.value = { src, name: node.data.image.name }
  nextTick(() => imageDialog.value?.showModal())
}

function closeImagePreview() {
  imageDialog.value?.close()
}

function onImagePreviewClosed() {
  imagePreview.value = null
  if (imageReturnFocus instanceof HTMLElement && imageReturnFocus.isConnected) imageReturnFocus.focus()
  imageReturnFocus = null
}

function removeEmbeddedImage(node) {
  if (!node?.data?.image || !node.data.label?.trim()) return
  const before = snapshot()
  delete node.data.image
  pruneImageUrls()
  record(before)
}

function applyVisibility() {
  const hidden = new Set()
  for (const node of nodes.value) {
    if (node.data.collapsed && !searchExpanded.has(node.id)) descendantsOf(node.id, edges.value).forEach((id) => hidden.add(id))
  }
  for (const node of nodes.value) node.hidden = hidden.has(node.id)
  for (const edge of edges.value) edge.hidden = hidden.has(edge.source) || hidden.has(edge.target)
}

function selectOnly(id) {
  for (const node of nodes.value) node.selected = node.id === id
}

function focusEditor(id, initialText = null) {
  const node = nodes.value.find((item) => item.id === id)
  if (imageOnly(node)) return openImagePreview(id)
  for (const ancestor of ancestorsOf(id)) {
    if (searchExpanded.delete(ancestor)) nodesById.value.get(ancestor).data.collapsed = false
  }
  editingId.value = id
  editDraft.value = { label: initialText ?? node?.data.label ?? '', note: node?.data.note ?? '' }
  editStart = snapshot()
  nextTick(() => {
    const editor = document.querySelector(`[data-editor="${CSS.escape(id)}"]`)
    if (initialText === null) editor?.select()
    else {
      editor?.focus()
      editor?.setSelectionRange(initialText.length, initialText.length)
    }
  })
}

function focusNoteEditor(id) {
  nextTick(() => document.querySelector(`[data-note-editor="${CSS.escape(id)}"]`)?.focus())
}

function onEditorFocusOut(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  finishEditing()
}

function finishEditing(save = true) {
  if (!editingId.value) return
  const node = nodes.value.find((item) => item.id === editingId.value)
  const label = editDraft.value.label.trim()
  if (save && node && label) {
    node.data.label = label.slice(0, 500)
    node.data.note = editDraft.value.note.trim().slice(0, 200)
  }
  editingId.value = null
  record(editStart)
  editStart = null
}

function orient() {
  orientEdges(nodes.value, edges.value, settings.value.layout)
}

function measuredSize(id) {
  const node = nodes.value.find((item) => item.id === id)
  return node?.dimensions?.width ? node.dimensions : null
}

let layoutAnimation = 0

// Automatic layout preserves both zoom and the active node's place on screen.
// Fitting to screen happens only on explicit request (enabling auto layout, first layout of an old map).
function relayout(remember = true, fit = false, animate = false, anchorId = primaryNode.value?.id) {
  const before = remember ? snapshot() : null
  const anchor = fit ? null : nodes.value.find((node) => node.id === anchorId)
  const anchorPosition = anchor ? { ...anchor.position } : null
  const camera = { ...viewport.value }
  const keepAnchorStill = () => {
    if (!anchor || !anchorPosition) return
    setViewport({
      x: camera.x + (anchorPosition.x - anchor.position.x) * camera.zoom,
      y: camera.y + (anchorPosition.y - anchor.position.y) * camera.zoom,
      zoom: camera.zoom,
    })
  }
  const laidOut = new Map(layoutNodes(cleanMap().nodes, edges.value, measuredSize, settings.value).map((node) => [node.id, node]))
  cancelAnimationFrame(layoutAnimation)
  const moves = []
  for (const node of nodes.value) {
    const next = laidOut.get(node.id)
    if (!next) continue
    if (animate) moves.push({ node, from: { ...node.position }, to: next.position })
    else node.position = next.position
    node.data.side = next.data.side
    node.data.root = next.data.root
  }
  if (moves.length) {
    // Smooth 250ms re-layout; connectors move along with nodes.
    const start = performance.now()
    const step = (time) => {
      const t = Math.min(1, (time - start) / 250)
      const ease = easeOut(t)
      for (const { node, from, to } of moves) {
        node.position = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease }
      }
      keepAnchorStill()
      if (t < 1) layoutAnimation = requestAnimationFrame(step)
    }
    layoutAnimation = requestAnimationFrame(step)
  } else keepAnchorStill()
  orient()
  applyVisibility()
  record(before)
  if (fit) nextTick(() => focusMap(350))
}

function maybeRelayout(anchorId) {
  if (autoLayout.value) relayout(false, false, false, anchorId)
  else applyVisibility()
}

function manualSiblingPosition(sibling) {
  const branch = new Set([sibling.id, ...descendantsOf(sibling.id, edges.value)])
  const branchNodes = nodes.value.filter((node) => branch.has(node.id))
  const bottom = Math.max(...branchNodes.map((node) => node.position.y + (node.dimensions?.height || DEFAULT_SIZE.height)))
  const gap = layoutVerticalGap(settings.value)
  shiftNodesBelow(nodes.value, bottom, DEFAULT_SIZE.height + gap, branch)
  return { x: sibling.position.x, y: bottom + gap }
}

function addChild(parentId = primaryNode.value?.id, afterSiblingId = null) {
  const parent = nodes.value.find((node) => node.id === parentId)
    ?? nodes.value.find((node) => node.data.root)
  if (!parent) return
  const before = snapshot()
  const childCount = edges.value.filter((edge) => edge.source === parent.id && edge.data?.kind === 'tree').length
  const afterSibling = nodes.value.find((node) => node.id === afterSiblingId)
  const side = afterSibling
    ? (afterSibling.data.side === 'left' ? 'left' : 'right')
    : parent.data.root && childCount % 2 ? 'left' : (parent.data.side === 'left' ? 'left' : 'right')
  const position = !autoLayout.value && afterSibling
    ? manualSiblingPosition(afterSibling)
    : {
    x: side === 'left' ? parent.position.x - 100 - 180 : parent.position.x + (parent.dimensions?.width || 200) + 100,
    y: parent.position.y + childCount * 64,
  }
  const child = makeNode('New idea', position, {
    color: parent.data.root ? branchColor(childCount, settings.value.palette) : parent.data.color,
    manualColor: !parent.data.root && parent.data.manualColor,
    side,
  })
  measuredNodeHeights.set(child.id, DEFAULT_SIZE.height)
  nodes.value.push(child)
  insertTreeEdgeAfter(edges.value, makeEdge(parent.id, child.id), afterSiblingId)
  orient()
  parent.data.collapsed = false
  selectOnly(child.id)
  maybeRelayout(parent.id)
  record(before)
  focusEditor(child.id)
  revealNode(child.id)
  contextMenu.value = null
}

function addSibling() {
  const current = primaryNode.value ?? nodes.value.find((node) => node.data.root)
  if (!current) return
  const parentEdge = edges.value.find((edge) => edge.target === current.id && edge.data?.kind === 'tree')
  if (parentEdge) return addChild(parentEdge.source, current.id)

  const before = snapshot()
  const position = autoLayout.value
    ? { x: current.position.x, y: current.position.y + 112 }
    : manualSiblingPosition(current)
  const sibling = makeNode('New idea', {
    x: position.x,
    y: position.y,
  }, { root: true, color: branchColor(rootCount.value, settings.value.palette) })
  measuredNodeHeights.set(sibling.id, DEFAULT_SIZE.height)
  const currentIndex = nodes.value.findIndex((node) => node.id === current.id)
  nodes.value.splice(currentIndex + 1, 0, sibling)
  selectOnly(sibling.id)
  maybeRelayout(current.id)
  record(before)
  focusEditor(sibling.id)
  revealNode(sibling.id)
  contextMenu.value = null
}

function removeSelected() {
  const nodesToRemove = removableSelectedNodes.value
  const selectedEdges = new Set(edges.value.filter((edge) => edge.selected).map((edge) => edge.id))
  if (!nodesToRemove.length && !selectedEdges.size) return
  const before = snapshot()
  const removed = new Set()
  for (const node of nodesToRemove) {
    removed.add(node.id)
    descendantsOf(node.id, edges.value).forEach((id) => removed.add(id))
  }
  nodes.value = nodes.value.filter((node) => !removed.has(node.id))
  edges.value = edges.value.filter((edge) => !selectedEdges.has(edge.id) && !removed.has(edge.source) && !removed.has(edge.target))
  pruneImageUrls()
  const childIds = new Set(edges.value.filter((edge) => edge.data?.kind === 'tree').map((edge) => edge.target))
  nodes.value.forEach((node) => (node.data.root = !childIds.has(node.id)))
  maybeRelayout()
  record(before)
  contextMenu.value = null
}

function toggleCollapse(id = primaryNode.value?.id) {
  const node = nodes.value.find((item) => item.id === id)
  if (!node || !hasChildren(id)) return
  const before = snapshot()
  node.data.collapsed = !node.data.collapsed
  applyVisibility()
  record(before)
}

function hiddenCount(id) {
  return descendantsOf(id, edges.value).size
}

// Which side of the node its descendants are on: the collapse button goes there.
function childrenSide(id, data) {
  const child = firstChild.value.get(id)
  const side = child ? nodesById.value.get(child)?.data.side : data.side
  return side === 'left' ? 'left' : 'right'
}

// One pass over edges instead of a scan per rendered node: big maps re-render thousands of nodes at once.
const firstChild = computed(() => {
  const result = new Map()
  for (const edge of edges.value) {
    if (edge.data?.kind === 'tree' && !result.has(edge.source)) result.set(edge.source, edge.target)
  }
  return result
})

function hasChildren(id) {
  return firstChild.value.has(id)
}

function setColor(color) {
  if (!selectedNodes.value.length) return
  const before = snapshot()
  const withChildren = inheritColor.value || selectedNodes.value.length > 1
  const branch = new Set(selectedNodes.value.flatMap((node) => [node.id, ...(withChildren ? descendantsOf(node.id, edges.value) : [])]))
  for (const node of nodes.value) {
    if (!branch.has(node.id)) continue
    node.data.color = color
    node.data.manualColor = true
  }
  orient()
  record(before)
}

function setStyle(style) {
  if (!selectedNodes.value.length) return
  const before = snapshot()
  selectedNodes.value.forEach((node) => (node.data.style = style))
  record(before)
}

function setSetting(key, value) {
  if (settings.value[key] === value) return
  const before = snapshot()
  if (key === 'palette') recolorForPalette(nodes.value, settings.value.palette, value)
  settings.value = { ...settings.value, [key]: value }
  orient()
  if (key === 'layout' || key === 'density') relayout(false, false, true)
  record(before)
}

function setCollapsed(ids, collapsed) {
  const targets = nodes.value.filter((node) => ids.includes(node.id) && hasChildren(node.id) && Boolean(node.data.collapsed) !== collapsed)
  if (!targets.length) return
  const before = snapshot()
  targets.forEach((node) => (node.data.collapsed = collapsed))
  applyVisibility()
  if (autoLayout.value) relayout(false, false)
  record(before)
}

// Panel fields: edits show on the node immediately and enter history as a single step.
function beginPanelEdit() {
  panelEditStart ??= snapshot()
}

function endPanelEdit(node) {
  if (node && !node.data.label.trim()) node.data.label = 'Untitled'
  record(panelEditStart)
  panelEditStart = null
}

function onPanelKeydown(event) {
  if (event.key === 'Escape' || event.key === 'Enter') {
    event.preventDefault()
    event.target.blur()
  }
}

function clearSelection() {
  for (const node of nodes.value) node.selected = false
}

// How far to move a [from, to] span into [low, high]; a span too big to fit aligns to low.
const shiftInto = (low, high, from, to) => (to - from > high - low || from < low ? low - from : to > high ? high - to : 0)

function ensureNodeVisible(id) {
  const element = document.querySelector(`[data-mind-node="${CSS.escape(id)}"]`)
  const canvas = canvasElement.value
  if (!element || !canvas) return false
  const bounds = element.getBoundingClientRect()
  const canvasBounds = canvas.getBoundingClientRect()
  const margin = 32
  const left = canvasBounds.left + margin
  const right = canvasBounds.right - (inspectorOpen.value ? INSPECTOR_SPACE : 0) - margin
  const top = canvasBounds.top + margin
  const bottom = canvasBounds.bottom - margin
  const x = shiftInto(left, right, bounds.left, bounds.right)
  const y = shiftInto(top, bottom, bounds.top, bounds.bottom)
  if (x || y) {
    setViewport({ x: viewport.value.x + x, y: viewport.value.y + y, zoom: viewport.value.zoom }, { duration: 180 })
  }
  return true
}

function revealNode(id) {
  pendingRevealId = id
}

function revealAfterMeasurement(id) {
  nextTick(() => requestAnimationFrame(() => {
    if (pendingRevealId !== id) return
    if (ensureNodeVisible(id)) pendingRevealId = null
  }))
}

function navigateNodes(key) {
  const direction = key.replace('Arrow', '').toLowerCase()
  const current = primaryNode.value ?? nodes.value.find((node) => !node.hidden && node.data.root)
  if (!current) return
  const target = primaryNode.value ? nodeInDirection(nodes.value, current.id, direction) : current
  if (!target) return
  selectOnly(target.id)
  nextTick(() => ensureNodeVisible(target.id))
}

// Map search (5a). Lives outside the map: not saved, not in undo history.
const searchOpen = ref(false)
const searchQuery = ref('')
const searchTerm = ref('')
const searchCurrentId = ref(null)
const searchInput = ref(null)
const documentIsland = ref(null)
const topRight = ref(null)
const searchPlacement = ref({ top: 12, width: 440 })
// Collapsed branches temporarily opened to show the current match.
let searchExpanded = new Set()
let searchAnchorId = null
let searchedTerm = ''
let searchTimer
// Camera target while a reveal is still animating: quick steps build on it, not on a mid-flight viewport.
let revealCamera = null
let revealUntil = 0

const searchIndex = computed(() => new Map(nodes.value.map((node) => [node.id, normalizeSearch(`${node.data.label}\n${node.data.note}`)])))
const searchOrderIds = computed(() => searchOrder(nodes.value, edges.value))
const searchMatches = computed(() => {
  const term = searchTerm.value
  if (!searchOpen.value || !term) return []
  return searchOrderIds.value.filter((id) => searchIndex.value.get(id)?.includes(term))
})
// Matches and every node above them: lines along these paths stay bright.
const searchPath = computed(() => {
  const path = new Set()
  for (const id of searchMatches.value) ancestorsOf(id).forEach((ancestor) => path.add(ancestor))
  searchMatches.value.forEach((id) => path.add(id))
  return path
})
const searchCount = computed(() => (searchMatches.value.length
  ? `${searchMatches.value.indexOf(searchCurrentId.value) + 1} of ${searchMatches.value.length}`
  : 'No matches'))

function ancestorsOf(id) {
  const result = []
  for (let parent = parentOf.value.get(id); parent && !result.includes(parent); parent = parentOf.value.get(parent)) result.push(parent)
  return result
}

// Per-node search state: 'path' | 'match' | 'current'. A reactive Map tracks each id separately,
// so a step re-renders only the nodes that changed, not all of them.
const searchMarks = reactive(new Map())
watch([searchPath, searchCurrentId, searchTerm], () => {
  const next = new Map([...searchPath.value].map((id) => [id, 'path']))
  searchMatches.value.forEach((id) => next.set(id, 'match'))
  if (next.has(searchCurrentId.value)) next.set(searchCurrentId.value, 'current')
  for (const id of [...searchMarks.keys()]) if (!next.has(id)) searchMarks.delete(id)
  const term = searchTerm.value
  for (const [id, state] of next) {
    const old = searchMarks.get(id)
    if (old?.state !== state || old.term !== term) searchMarks.set(id, { state, term })
  }
})
const searchState = (id) => searchMarks.get(id)?.state
const searchParts = (id, text) => {
  const mark = searchMarks.get(id)
  return mark && mark.state !== 'path' ? highlightParts(text, mark.term) : [{ text, match: false }]
}

// Centered over the visible canvas; if it would run into the side islands, it moves below the toolbar.
function placeSearch() {
  const visible = window.innerWidth - (inspectorOpen.value ? INSPECTOR_SPACE : 0)
  const side = Math.max(documentIsland.value?.offsetWidth ?? 0, topRight.value?.offsetWidth ?? 0) + 12
  const available = visible - 2 * (side + 24)
  searchPlacement.value = available >= 280 ? { top: 12, width: Math.min(440, available) } : { top: 64, width: Math.min(440, visible - 48) }
}

function openSearch() {
  closeMenus()
  if (!searchOpen.value) {
    searchOpen.value = true
    searchAnchorId = primaryNode.value?.id ?? null
    searchedTerm = null
    placeSearch()
  }
  nextTick(() => searchInput.value?.select())
}

// Selecting is deferred to here: a selection change costs a deep pass over the map (autosave watcher), too slow per step on big maps.
function closeSearch() {
  if (!searchOpen.value) return
  searchOpen.value = false
  if (searchCurrentId.value) selectOnly(searchCurrentId.value)
  searchCurrentId.value = null
  searchExpanded = new Set()
  applyVisibility()
  if (document.activeElement?.closest?.('.search-island, .search-toggle')) document.activeElement.blur()
}

function flushSearch() {
  clearTimeout(searchTimer)
  searchTerm.value = normalizeSearch(searchQuery.value.trim())
}

function setSearchCurrent(id) {
  searchCurrentId.value = id
  if (!id) return
  searchExpanded = new Set(ancestorsOf(id).filter((ancestor) => nodesById.value.get(ancestor)?.data.collapsed))
  applyVisibility()
  revealSearchMatch(id)
}

function stepSearch(step) {
  flushSearch()
  const list = searchMatches.value
  if (!list.length) return
  const index = list.indexOf(searchCurrentId.value)
  setSearchCurrent(list[index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length])
}

// Keeps the match 80px inside the visible canvas, clear of the islands and the panel. Zoom changes only for unreadably small nodes.
// Works from model coordinates: a node just shown from a collapsed branch has no settled DOM position yet.
function revealSearchMatch(id) {
  const node = nodesById.value.get(id)
  const { width: canvasWidth, height: canvasHeight } = dimensions.value
  if (!node || !canvasWidth) return
  const width = node.dimensions?.width || DEFAULT_SIZE.width
  const height = node.dimensions?.height || DEFAULT_SIZE.height
  const transition = { duration: 250, ease: easeOut, interpolate: 'linear' }
  const { x: viewX, y: viewY, zoom } = performance.now() < revealUntil ? revealCamera : viewport.value
  if (height * zoom < 10) {
    revealUntil = 0
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, ...transition })
    return
  }
  const margin = 80
  const left = margin
  const right = canvasWidth - (inspectorOpen.value ? INSPECTOR_SPACE : 0) - margin
  const top = Math.max(margin, searchPlacement.value.top + 44 + 24)
  const bottom = canvasHeight - margin
  const box = { left: node.position.x * zoom + viewX, top: node.position.y * zoom + viewY }
  box.right = box.left + width * zoom
  box.bottom = box.top + height * zoom
  const dx = shiftInto(left, right, box.left, box.right)
  const dy = shiftInto(top, bottom, box.top, box.bottom)
  if (!dx && !dy) return
  revealCamera = { x: viewX + dx, y: viewY + dy, zoom }
  revealUntil = performance.now() + transition.duration
  setViewport(revealCamera, transition)
}

function onSearchKeydown(event) {
  const mod = event.metaKey || event.ctrlKey
  if (event.key === 'Enter' && mod) {
    const id = searchCurrentId.value
    if (id) focusEditor(id)
    closeSearch()
  } else if ((event.key === 'Enter' && event.shiftKey) || event.key === 'ArrowUp') stepSearch(-1)
  else if (event.key === 'Enter' || event.key === 'ArrowDown') stepSearch(1)
  else if (event.key === 'Escape') closeSearch()
  else if (event.key === 'Tab') event.target.blur()
  else if (findShortcut(event)?.id === 'search') event.target.select()
  else return
  event.preventDefault()
}

watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(flushSearch, 80)
})

// New query: start after the anchor node. Edits: keep the current match while it still matches.
watch(searchMatches, (list) => {
  if (!searchOpen.value) return
  const termChanged = searchTerm.value !== searchedTerm
  searchedTerm = searchTerm.value
  if (!termChanged && list.includes(searchCurrentId.value)) return
  setSearchCurrent(nextMatch(searchOrderIds.value, list, termChanged ? searchAnchorId : searchCurrentId.value))
})

// A node picked by the user becomes the new anchor; a matched one becomes current.
watch(() => primaryNode.value?.id, (id) => {
  if (!searchOpen.value || !id || id === searchCurrentId.value) return
  searchAnchorId = id
  if (searchMatches.value.includes(id)) setSearchCurrent(id)
})

// The query belongs to its map.
watch(activeId, () => {
  closeSearch()
  searchQuery.value = ''
  flushSearch()
})
watch(inspectorOpen, placeSearch)

function connectNodes(connection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return
  const exists = edges.value.some((edge) => edge.source === connection.source && edge.target === connection.target)
  if (exists) return
  const before = snapshot()
  const edge = makeEdge(connection.source, connection.target, 'link')
  edge.sourceHandle = connection.sourceHandle
  edge.targetHandle = connection.targetHandle
  edges.value.push(edge)
  record(before)
}

function onNodeDragStart({ node }) {
  alignmentGuides.value = []
  dragStart = snapshot()
  dragOrigin = { ...node.position }
  // The branch moves with its parent; Vue Flow moves selected descendants itself.
  dragBranch = new Map(nodes.value
    .filter((item) => descendantsOf(node.id, edges.value).has(item.id) && !item.selected)
    .map((item) => [item.id, { item, origin: { ...item.position } }]))
}

function moveBranch(node, restore = false) {
  if (!dragBranch || !dragOrigin) return
  const dx = restore ? 0 : node.position.x - dragOrigin.x
  const dy = restore ? 0 : node.position.y - dragOrigin.y
  for (const { item, origin } of dragBranch.values()) item.position = { x: origin.x + dx, y: origin.y + dy }
}

function setAutoLayout(value) {
  if (autoLayout.value === value) return
  const before = snapshot()
  autoLayout.value = value
  if (value) relayout(false, true)
  record(before)
  notify(value ? 'Auto layout on' : 'Auto layout off — nodes stay where you put them')
}

function onNodesInitialized() {
  if (initialFitDone) return
  initialFitDone = true
  nextTick(() => focusMap(0))
}

const ATTACH_RADIUS = 160
// The root pulls harder: distance to it counts as half (attach radius is 320),
// and if the block's line start is brought closer than ROOT_SNAP to the root's edge, the root wins even over the node under the block.
// Bringing a block to the root means making it a first-level branch, not a child of a neighbouring branch.
const ROOT_PULL = 0.5
const ROOT_SNAP = 80

// Where the line would run if the node attached to the candidate: from the candidate's edge to the near end of the node's line.
function attachGeometry(node, candidate) {
  const size = (item) => ({ w: item.dimensions?.width || 180, h: item.dimensions?.height || 30 })
  const own = size(node)
  const other = size(candidate)
  const side = node.position.x + own.w / 2 < candidate.position.x + other.w / 2 ? 'left' : 'right'
  const tree = settings.value.layout === 'tree'
  const candidateOnLine = !candidate.data.root && !imageOnly(candidate) && nodeStyle(candidate.data) === 'line'
  const x0 = tree
    ? candidate.position.x + (candidate.data.root ? 24 : 14)
    : candidate.position.x + (side === 'right' ? other.w : 0)
  const y0 = tree
    ? candidate.position.y + other.h - (candidateOnLine ? 1 : 0)
    : candidate.position.y + (candidateOnLine ? other.h - 1 : other.h / 2)
  const ownOnLine = !imageOnly(node) && nodeStyle({ ...node.data, root: false }) === 'line'
  const x1 = node.position.x + (tree || side === 'right' ? 0 : own.w)
  const y1 = node.position.y + (ownOnLine ? own.h - 1 : own.h / 2)
  const sourcePosition = tree ? Position.Bottom : side === 'right' ? Position.Right : Position.Left
  return { side, distance: Math.hypot(x1 - x0, y1 - y0), path: branchPath({ sourceX: x0, sourceY: y0, targetX: x1, targetY: y1, sourcePosition }) }
}

// The nearest node the dragged one will attach to: the one it was dropped on, or the closest within the radius.
// A text root attaches only on overlap — so moving a whole tree doesn't hang it off a neighbour.
function findAttachTarget(node, dragged = [node]) {
  const excluded = new Set(dragged.flatMap((item) => [item.id, ...descendantsOf(item.id, edges.value)]))
  const center = {
    x: node.position.x + (node.dimensions?.width || 180) / 2,
    y: node.position.y + (node.dimensions?.height || 30) / 2,
  }
  let best = null
  for (const candidate of nodes.value) {
    if (excluded.has(candidate.id) || candidate.hidden) continue
    const width = candidate.dimensions?.width || 180
    const height = candidate.dimensions?.height || 30
    const overlap = center.x >= candidate.position.x && center.x <= candidate.position.x + width
      && center.y >= candidate.position.y && center.y <= candidate.position.y + height
    if (node.data.root && !imageOnly(node) && !overlap) continue
    const geometry = attachGeometry(node, candidate)
    const snapsToRoot = candidate.data.root && geometry.distance <= ROOT_SNAP
    const distance = snapsToRoot ? -1 : overlap ? 0 : geometry.distance * (candidate.data.root ? ROOT_PULL : 1)
    if (distance > ATTACH_RADIUS || (best && best.distance <= distance)) continue
    best = { target: candidate, overlap, ...geometry, distance }
  }
  return best
}

const dragPreview = ref(null)

function findMergeTarget(node, dragged) {
  if (!imageOnly(node)) return null
  const draggedIds = new Set(dragged.map((item) => item.id))
  const center = {
    x: node.position.x + (node.dimensions?.width || 180) / 2,
    y: node.position.y + (node.dimensions?.height || 30) / 2,
  }
  for (const candidate of nodes.value) {
    if (draggedIds.has(candidate.id) || candidate.hidden || !candidate.data.label?.trim()) continue
    const width = candidate.dimensions?.width || 180
    const height = candidate.dimensions?.height || 30
    if (center.x < candidate.position.x || center.x > candidate.position.x + width
      || center.y < candidate.position.y || center.y > candidate.position.y + height) continue
    return { target: candidate, overlap: true, ...attachGeometry(node, candidate), distance: 0 }
  }
  return null
}

function showAttachPreview(node, dragged) {
  const parentId = parentOf.value.get(node.id)
  const parentEdge = edges.value.find((edge) => edge.data?.kind === 'tree' && edge.target === node.id)
  const best = movedFromOrigin(node) ? findMergeTarget(node, dragged) ?? findAttachTarget(node, dragged) : null
  const mode = imageOnly(node) && best?.overlap && best.target.data.label?.trim() ? 'merge' : 'attach'
  const changes = best && (mode === 'merge' || best.target.id !== parentId)
  // Preview only: the real link doesn't change until release.
  dragPreview.value = changes
    ? { mode, targetId: best.target.id, path: best.path, overlap: best.overlap, color: best.target.data.root ? node.data.color : best.target.data.color }
    : null
  dropTargetId.value = changes ? best.target.id : null
  if (parentEdge) parentEdge.hidden = Boolean(changes)
}

const movedFromOrigin = (node) => dragOrigin
  && Math.hypot(node.position.x - dragOrigin.x, node.position.y - dragOrigin.y) > 8

// Without auto layout, place the moved branch next to its new parent, below its last child.
function placeBesideParent(node, parent) {
  const gap = 100
  const width = node.dimensions?.width || 180
  const parentWidth = parent.dimensions?.width || 200
  const siblings = edges.value
    .filter((edge) => edge.data?.kind === 'tree' && edge.source === parent.id && edge.target !== node.id)
    .map((edge) => nodes.value.find((item) => item.id === edge.target))
    .filter((item) => item && !item.hidden && item.data.side === node.data.side)
  const x = node.data.side === 'left' ? parent.position.x - gap - width : parent.position.x + parentWidth + gap
  const y = siblings.length
    ? Math.max(...siblings.map((item) => item.position.y + (item.dimensions?.height || 30))) + 18
    : parent.position.y + (parent.dimensions?.height || 30) - (node.dimensions?.height || 30)
  const dx = x - node.position.x
  const dy = y - node.position.y
  const branch = new Set([node.id, ...descendantsOf(node.id, edges.value)])
  for (const item of nodes.value) {
    if (!branch.has(item.id)) continue
    item.position = { x: item.position.x + dx, y: item.position.y + dy }
    if (item.id !== node.id) item.data.side = node.data.side
  }
}

// A branch was dragged to the other side of its parent — the connector switches to the nearest edges.
function updateSides(ids) {
  if (settings.value.layout === 'tree') return
  const centerX = (item) => item.position.x + (item.dimensions?.width || 180) / 2
  let changed = false
  for (const id of ids) {
    const item = nodesById.value.get(id)
    const parent = nodesById.value.get(parentOf.value.get(id))
    if (!item || !parent) continue
    const side = centerX(item) < centerX(parent) ? 'left' : 'right'
    if (item.data.side === side) continue
    item.data.side = side
    changed = true
  }
  if (changed) orient()
}

function onNodeDrag({ event, node, nodes: dragged = [node] }) {
  alignmentGuides.value = []
  if (event.shiftKey) {
    const excluded = new Set(dragged.flatMap((item) => [item.id, ...descendantsOf(item.id, edges.value)]))
    const rectOf = (item) => ({
      x: item.position.x,
      y: item.position.y,
      width: item.dimensions?.width || (item.data.root ? DEFAULT_SIZE.rootWidth : DEFAULT_SIZE.width),
      height: item.dimensions?.height || (item.data.root ? DEFAULT_SIZE.rootHeight : DEFAULT_SIZE.height),
    })
    const snapped = snapNode(
      rectOf(node),
      nodes.value.filter((item) => !item.hidden && !excluded.has(item.id)).map(rectOf),
      8 / viewport.value.zoom,
      400 / viewport.value.zoom,
    )
    const dx = snapped.x - node.position.x
    const dy = snapped.y - node.position.y
    for (const item of dragged) item.position = { x: item.position.x + dx, y: item.position.y + dy }
    alignmentGuides.value = snapped.guides
  }
  moveBranch(node)
  updateSides(dragged.flatMap((item) => [item.id, ...descendantsOf(item.id, edges.value)]))
  showAttachPreview(node, dragged)
}

function onNodeDragStop(payload) {
  const { node } = payload
  // Vue Flow restores its raw pointer position before stop; apply the active snap once more.
  onNodeDrag(payload)
  alignmentGuides.value = []
  const preview = dragPreview.value
  dragPreview.value = null
  dropTargetId.value = null
  applyVisibility()
  const moved = movedFromOrigin(node)
  const origin = dragOrigin
  dragOrigin = null
  if (!moved) {
    // A click or mouse jitter — put the node back and move nothing.
    if (origin) {
      dragOrigin = origin
      moveBranch(node, true)
      node.position = origin
      updateSides([node.id, ...descendantsOf(node.id, edges.value)])
    }
    dragOrigin = null
    dragBranch = null
    dragStart = null
    return
  }
  const target = preview ? nodesById.value.get(preview.targetId) : null
  if (target && preview.mode === 'merge') {
    const merged = mergeImageNode(nodes.value, edges.value, node.id, target.id)
    if (merged.error) {
      if (origin) {
        dragOrigin = origin
        moveBranch(node, true)
        node.position = origin
        updateSides([node.id, ...descendantsOf(node.id, edges.value)])
        dragOrigin = null
      }
      dragBranch = null
      dragStart = null
      applyVisibility()
      notify(merged.error === 'target-has-image'
        ? 'This block already has an image'
        : merged.error === 'cycle' ? 'This image cannot be merged into its own branch' : 'Image could not be added')
      return
    }
    nodes.value = merged.nodes
    edges.value = merged.edges
    const mergedTarget = nodes.value.find((item) => item.id === target.id)
    mergedTarget.data.collapsed = false
    selectOnly(target.id)
    dragBranch = null
    orient()
    if (autoLayout.value) relayout(false)
    applyVisibility()
    record(dragStart)
    dragStart = null
    notify(`Image added to “${nodeLabel(mergedTarget)}”`)
    return
  }
  dragBranch = null
  if (target) {
    edges.value = edges.value.filter((edge) => edge.data?.kind !== 'tree' || edge.target !== node.id)
    edges.value.push(makeEdge(target.id, node.id))
    node.data.root = false
    node.data.side = attachGeometry(node, target).side
    // Dropped right on a node — nudge it aside; pulled close — leave it where it was released.
    if (!autoLayout.value && preview.overlap) placeBesideParent(node, target)
    else updateSides(descendantsOf(node.id, edges.value))
    if (!target.data.root) {
      const branch = new Set([node.id, ...descendantsOf(node.id, edges.value)])
      for (const item of nodes.value) {
        if (!branch.has(item.id)) continue
        item.data.color = target.data.color
        item.data.manualColor = Boolean(target.data.manualColor)
      }
    }
    orient()
    target.data.collapsed = false
    notify(`Moved “${nodeLabel(node)}” to “${nodeLabel(target)}”`)
  } else if (autoLayout.value) {
    // The node was moved by hand — layout no longer puts it back.
    autoLayout.value = false
    notify('Auto layout off — nodes stay where you put them')
  }
  if (autoLayout.value) relayout(false)
  applyVisibility()
  record(dragStart)
  dragStart = null
}

function showNodeMenu({ event, node }) {
  event.preventDefault()
  if (!node.selected) selectOnly(node.id)
  contextMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 230),
    y: Math.min(event.clientY, window.innerHeight - 230),
    id: node.id,
  }
}

function closeOverlays() {
  contextMenu.value = null
  finishEditing()
}

function persistDocuments(showState = true) {
  const current = activeDocument.value
  if (current) {
    current.map = cleanMap()
    if (dirty || !current.updatedAt) current.updatedAt = Date.now()
  }
  dirty = false
  now.value = Date.now()
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ version: 1, activeId: activeId.value, documents: storedDocuments() }))
    localStorage.removeItem(STORAGE_KEY)
    if (showState) saveState.value = 'saved'
    return true
  } catch {
    if (showState) saveState.value = 'error'
    return false
  }
}

// A deleted map stays in storage while the toast with Undo is visible.
function storedDocuments() {
  const pending = deletion.value
  if (!pending) return documents.value
  const list = [...documents.value]
  list.splice(Math.min(pending.index, list.length), 0, pending.document)
  return list
}

function closeMenus() {
  documentsOpen.value = false
  appMenuOpen.value = false
  exportOpen.value = false
  closeDocumentMenuState()
}

function closeDocumentMenuState() {
  rowMenu.value = null
  documentQuery.value = ''
  if (renamingDocId.value) commitDocumentRename()
}

function toggleDocuments() {
  exportOpen.value = false
  appMenuOpen.value = false
  now.value = Date.now()
  if (documentsOpen.value) return closeMenus()
  documentsOpen.value = true
  nextTick(() => focusDocumentRow(activeId.value))
}

const documentRows = () => [...(documentMenu.value?.querySelectorAll('.document-item') ?? [])]

function focusDocumentRow(id) {
  const rows = documentRows()
  ;(rows.find((row) => row.dataset.id === id) ?? rows[0])?.focus()
}

function moveDocumentFocus(row, step) {
  const rows = documentRows()
  const index = rows.indexOf(row)
  rows[Math.max(0, Math.min(rows.length - 1, index + step))]?.focus()
}

let rowClickTimer
function onDocumentRowClick(id, event) {
  if (renamingDocId.value === id) return
  // A click on the title waits: it may be the first click of a double-click (rename).
  if (event.target.closest('.document-item-title')) {
    clearTimeout(rowClickTimer)
    rowClickTimer = setTimeout(() => switchDocument(id), 220)
  } else switchDocument(id)
}

function onDocumentTitleDblclick(id) {
  clearTimeout(rowClickTimer)
  startDocumentRename(id)
}

function onDocumentRowKeydown(id, event) {
  if (renamingDocId.value === id) return
  const mod = event.metaKey || event.ctrlKey
  const handled = () => {
    event.preventDefault()
    event.stopPropagation()
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    handled()
    moveDocumentFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter') {
    handled()
    switchDocument(id)
  } else if (event.key === 'F2') {
    handled()
    startDocumentRename(id)
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    handled()
    deleteDocument(id)
  } else if (mod && event.key.toLowerCase() === 'd') {
    handled()
    duplicateDocument(id)
  } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    handled()
    openRowMenu(id, event.currentTarget, true)
  }
}

function onDocumentMenuKeydown(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  if (rowMenu.value) {
    // The first Esc closes the submenu, the second closes the menu.
    const id = rowMenu.value.id
    rowMenu.value = null
    nextTick(() => focusDocumentRow(id))
  } else closeMenus()
}

function openRowMenu(id, row, viaKeyboard = false) {
  if (rowMenu.value?.id === id) {
    rowMenu.value = null
    return
  }
  const rect = row.getBoundingClientRect()
  const width = 200
  const fitsRight = rect.right + 4 + width <= window.innerWidth - 8
  rowMenu.value = {
    id,
    left: fitsRight ? rect.right + 4 : rect.left - 4 - width,
    top: Math.min(rect.top, window.innerHeight - 140),
  }
  if (viaKeyboard) nextTick(() => document.querySelector('.row-menu button')?.focus())
}

function onRowMenuKeydown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll('button')]
  const index = items.indexOf(document.activeElement)
  items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

function startDocumentRename(id) {
  const target = documents.value.find((document) => document.id === id)
  if (!target) return
  rowMenu.value = null
  renamingDocId.value = id
  renameDraft.value = documentTitle(target)
  nextTick(() => documentMenu.value?.querySelector('.document-rename')?.select())
}

function commitDocumentRename() {
  const id = renamingDocId.value
  if (!id) return
  renamingDocId.value = null
  const target = documents.value.find((document) => document.id === id)
  const next = renameDraft.value.trim().slice(0, 100)
  // Don't save an empty title — the previous one stays.
  if (!target || !next || next === documentTitle(target)) return
  if (id === activeId.value) title.value = next
  else {
    target.map.title = next
    persistDocuments()
  }
}

function cancelDocumentRename() {
  const id = renamingDocId.value
  renamingDocId.value = null
  nextTick(() => focusDocumentRow(id))
}

function onDocumentRenameKeydown(event) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    const id = renamingDocId.value
    commitDocumentRename()
    nextTick(() => focusDocumentRow(id))
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelDocumentRename()
  }
}

function copyTitle(base) {
  const taken = new Set(documents.value.map(documentTitle))
  let candidate = `${base} copy`
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} copy ${n}`
  return candidate
}

function duplicateDocument(id) {
  rowMenu.value = null
  if (id === activeId.value) persistDocuments(false)
  const index = documents.value.findIndex((document) => document.id === id)
  if (index < 0) return
  const original = documents.value[index]
  const map = JSON.parse(JSON.stringify(original.map))
  map.title = copyTitle(documentTitle(original))
  // One millisecond newer than the original — when sorted by date the copy lands right below it.
  const copy = { id: documentId(), map: normalizeMap(map), updatedAt: (original.updatedAt ?? Date.now()) - 1 }
  documents.value.splice(index + 1, 0, copy)
  persistDocuments(false)
  flashDocId.value = copy.id
  setTimeout(() => flashDocId.value === copy.id && (flashDocId.value = null), 1500)
  nextTick(() => focusDocumentRow(copy.id))
}

function toggleExport() {
  documentsOpen.value = false
  appMenuOpen.value = false
  exportOpen.value = !exportOpen.value
}

function startRename() {
  closeMenus()
  renaming.value = true
  nextTick(() => renameInput.value?.select())
}

function finishRename() {
  if (!renaming.value) return
  renaming.value = false
  title.value = title.value.trim() || 'Untitled'
}

function importFile() {
  closeMenus()
  fileInput.value.click()
}

function switchDocument(id, { keepMenu = false } = {}) {
  if (!keepMenu) closeMenus()
  if (id === activeId.value) return
  const next = documents.value.find((document) => document.id === id)
  if (!next) return
  finishEditing()
  clearTimeout(saveTimer)
  persistDocuments(false)
  activeId.value = id
  openMap(next.map)
  history.value = []
  future.value = []
  persistDocuments()
  requestFocus()
}

function addDocument(map) {
  finishEditing()
  clearTimeout(saveTimer)
  if (!persistDocuments(false)) return false
  const previousId = activeId.value
  const previousHistory = history.value
  const previousFuture = future.value
  const id = documentId()
  documents.value.push({ id, map: normalizeMap(map), updatedAt: Date.now() })
  activeId.value = id
  openMap(map)
  history.value = []
  future.value = []
  if (!persistDocuments()) {
    documents.value = documents.value.filter((document) => document.id !== id)
    activeId.value = previousId
    openMap(documents.value.find((document) => document.id === previousId).map)
    history.value = previousHistory
    future.value = previousFuture
    return false
  }
  requestFocus()
  return true
}

function newMap() {
  closeMenus()
  const root = makeNode('Central idea', { x: 0, y: 0 }, { root: true, color: PALETTES.bright.colors[0] })
  if (!addDocument({ version: 1, title: 'New map', autoLayout: true, nodes: [root], edges: [] })) {
    notify('The map could not be saved on this device.')
    return
  }
  selectOnly(root.id)
  focusEditor(root.id)
}

let deletionTimer
let deletionDeadline = 0
let deletionRemaining = 0

function deleteDocument(id) {
  rowMenu.value = null
  if (renamingDocId.value === id) renamingDocId.value = null
  finalizeDeletion()
  const wasActive = id === activeId.value
  if (wasActive) {
    finishEditing()
    clearTimeout(saveTimer)
    persistDocuments(false)
  }
  const index = documents.value.findIndex((document) => document.id === id)
  if (index < 0) return
  const rows = documentRows()
  const nextFocus = rows[rows.findIndex((row) => row.dataset.id === id) + 1]?.dataset.id
    ?? rows[rows.findIndex((row) => row.dataset.id === id) - 1]?.dataset.id
  const [removed] = documents.value.splice(index, 1)
  let createdId = null
  if (wasActive) {
    const next = sortedDocuments.value[0]
    if (next) switchDocument(next.id, { keepMenu: true })
    else {
      // The last map was deleted — start with an empty one.
      createdId = documentId()
      const root = makeNode('Central idea', { x: 0, y: 0 }, { root: true, color: PALETTES.bright.colors[0] })
      documents.value.push({ id: createdId, map: normalizeMap({ version: 2, title: 'New map', autoLayout: true, nodes: [root], edges: [] }), updatedAt: Date.now() })
      activeId.value = createdId
      openMap(documents.value.at(-1).map)
      history.value = []
      future.value = []
      requestFocus()
    }
  }
  deletion.value = { document: removed, index, wasActive, createdId, title: removed.map.title }
  persistDocuments()
  startDeletionTimer(6000)
  nextTick(() => focusDocumentRow(nextFocus ?? activeId.value))
}

function startDeletionTimer(ms) {
  clearTimeout(deletionTimer)
  deletionRemaining = ms
  deletionDeadline = Date.now() + ms
  deletionTimer = setTimeout(finalizeDeletion, ms)
}

function pauseDeletionTimer() {
  if (!deletion.value) return
  clearTimeout(deletionTimer)
  deletionRemaining = Math.max(0, deletionDeadline - Date.now())
}

function resumeDeletionTimer() {
  if (deletion.value) startDeletionTimer(deletionRemaining)
}

// The toast is gone — now delete from storage for good.
function finalizeDeletion() {
  clearTimeout(deletionTimer)
  if (!deletion.value) return
  deletion.value = null
  persistDocuments(false)
}

function undoDeletion() {
  const pending = deletion.value
  if (!pending) return
  clearTimeout(deletionTimer)
  deletion.value = null
  documents.value.splice(Math.min(pending.index, documents.value.length), 0, pending.document)
  if (pending.wasActive) {
    // Remove the empty map created in place of the deleted last one if it wasn't touched.
    const created = documents.value.find((document) => document.id === pending.createdId)
    const untouched = created && !history.value.length && nodes.value.length === 1
    switchDocument(pending.document.id, { keepMenu: true })
    if (untouched) documents.value.splice(documents.value.indexOf(created), 1)
  }
  persistDocuments()
  flashDocId.value = pending.document.id
  setTimeout(() => flashDocId.value === pending.document.id && (flashDocId.value = null), 1500)
}

function download(blob, extension) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(title.value || 'mind-map').replace(/[^\p{L}\p{N}_-]+/gu, '-')}.${extension}`
  link.click()
  URL.revokeObjectURL(url)
}

async function exportMap(format) {
  if (exportBusy.value) return
  exportOpen.value = false
  const opml = format === 'opml'
  const map = cleanMap()
  if (opml) {
    download(new Blob([toOpml(map)], { type: 'text/x-opml' }), 'opml')
    notify(referencedAssetIds(map).size ? 'OPML saved — images were exported as text only' : 'OPML saved')
    return
  }
  exportBusy.value = true
  try {
    download(await createMindmapFile(map, loadImageAsset), 'mindmap')
    notify('Map file saved')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not export the map')
  } finally {
    exportBusy.value = false
  }
}

async function loadFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  let importedAssetIds = []
  try {
    const imported = await readMindmapFile(file)
    let map
    if (imported.kind === 'archive') {
      const assets = []
      for (const asset of imported.assets) {
        let decoded
        try {
          decoded = await createImageAsset(new File([asset.blob], asset.image.name, { type: asset.image.mime }), asset.image.assetId)
        } catch {
          throw new Error('The map archive is incomplete or corrupted.')
        }
        if (decoded.image.naturalWidth !== asset.image.naturalWidth || decoded.image.naturalHeight !== asset.image.naturalHeight) {
          throw new Error('The map archive is incomplete or corrupted.')
        }
        assets.push(decoded)
      }
      await saveImageAssets(assets)
      importedAssetIds = assets.map((asset) => asset.image.assetId)
      map = imported.map
    } else {
      map = imported.kind === 'opml' ? parseOpml(imported.text) : normalizeMap(JSON.parse(imported.text))
    }
    if (!addDocument(map)) throw new Error('The map could not be saved on this device.')
    importedAssetIds = []
    notify(`Added: ${file.name}`)
  } catch (error) {
    if (importedAssetIds.length) await deleteImageAssets(importedAssetIds).catch(() => {})
    notify(error instanceof Error ? error.message : 'Could not open the file')
  }
}

const appMenuItems = () => [...(appMenu.value?.querySelectorAll('[role="menuitem"]') ?? [])]

function toggleAppMenu() {
  if (appMenuOpen.value) return closeMenus()
  closeMenus()
  appMenuOpen.value = true
  nextTick(() => appMenuItems()[0]?.focus())
}

function closeAppMenu({ refocus = false } = {}) {
  appMenuOpen.value = false
  if (refocus) brandButton.value?.focus()
}

function onAppMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeAppMenu({ refocus: true })
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const items = appMenuItems()
    const index = items.indexOf(document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }
}

async function copyVersion() {
  try {
    await navigator.clipboard.writeText(APP_VERSION)
  } catch {
    return notify('Could not copy the version')
  }
  versionCopied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (versionCopied.value = false), 1200)
}

const releaseUrl = REPOSITORY_URL ? `${REPOSITORY_URL}/releases/tag/v${APP_VERSION}` : ''
const issueUrl = () => `${REPOSITORY_URL}/issues/new?body=${encodeURIComponent(`\n\n---\nVersion: ${APP_VERSION}\nBrowser: ${navigator.userAgent}`)}`

function openWhatsNew() {
  whatsNewUnseen.value = false
  try {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION)
  } catch {
    // Not remembered — the dot will show up again.
  }
  closeAppMenu()
}

function openHelp(returnFocus = document.activeElement) {
  closeMenus()
  contextMenu.value = null
  helpReturnFocus = returnFocus
  helpOpen.value = true
  nextTick(() => helpDialog.value?.focus())
}

function closeHelp() {
  if (!helpOpen.value) return
  helpOpen.value = false
  const target = helpReturnFocus
  helpReturnFocus = null
  if (target instanceof HTMLElement && target.isConnected) target.focus()
}

// Focus stays inside the dialog: Tab from the last element goes to the first, Shift+Tab from the first to the last.
function onHelpKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeHelp()
  } else if (event.key === 'Tab') {
    const focusable = [...helpDialog.value.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
    if (!focusable.length) return event.preventDefault()
    const first = focusable[0]
    const last = focusable.at(-1)
    const inside = focusable.includes(document.activeElement)
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault()
      first.focus()
    }
  }
}

function runShortcut(id, event) {
  switch (id) {
    case 'undo': return undo()
    case 'redo': return redo()
    case 'addChild': return addChild()
    case 'addSibling': return addSibling()
    case 'navigate': return navigateNodes(event.key)
    case 'remove': return removeSelected()
    case 'collapse':
    case 'expand': return setCollapsed(selectedNodes.value.map((node) => node.id), id === 'collapse')
    case 'help': return openHelp(event.target)
    case 'deselect':
      contextMenu.value = null
      closeMenus()
      for (const node of nodes.value) node.selected = false
  }
}

function onKeydown(event) {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  if (target instanceof HTMLElement && target.isContentEditable) return
  const shortcut = findShortcut(event)
  if (helpOpen.value) {
    // While help is open the map gets no keys; the dialog handles Esc and Tab itself.
    if (shortcut?.id === 'help') {
      event.preventDefault()
      closeHelp()
    }
    return
  }
  if (shortcut?.id === 'search') {
    event.preventDefault()
    openSearch()
    return
  }
  if (event.key === 'Escape' && searchOpen.value && !contextMenu.value && !documentsOpen.value && !appMenuOpen.value && !exportOpen.value) {
    event.preventDefault()
    closeSearch()
    return
  }
  if (shortcut?.id === 'undo' && deletion.value) {
    event.preventDefault()
    undoDeletion()
    return
  }
  // Keys inside the menu must not edit the map on the canvas.
  if (event.key !== 'Escape' && target instanceof Element && target.closest('.island, .island-menu, .row-menu, .app-menu, .undo-toast')) return
  if (shortcut) {
    if (shortcut.id !== 'deselect') event.preventDefault()
    // Vue Flow uses arrow keys to move selected nodes. Navigation owns these
    // keys, so do not let the event reach the canvas' node handler.
    if (shortcut.id === 'navigate') event.stopPropagation()
    runShortcut(shortcut.id, event)
  } else if (selectedNodes.value.length === 1 && event.key.length === 1 && !event.altKey && !event.metaKey && !event.ctrlKey && event.key !== ' ') {
    event.preventDefault()
    focusEditor(primaryNode.value.id, event.key)
  }
}

// A node changed size (font loaded, new text, second line) — layout uses the real sizes.
// A new map is open but its nodes aren't measured yet — focus once sizes arrive.
function requestFocus() {
  pendingFocus = true
  clearTimeout(focusTimer)
  // Fallback in case no measurement events come (e.g. sizes matched the previous ones).
  focusTimer = setTimeout(() => flushFocus(), 400)
}

function flushFocus() {
  if (!pendingFocus) return
  pendingFocus = false
  clearTimeout(focusTimer)
  nextTick(() => focusMap())
}

function onNodesChange(changes) {
  const dimensionChanges = changes.filter((change) => change.type === 'dimensions')
  if (!dimensionChanges.length) return
  const revealId = dimensionChanges.some((change) => change.id === pendingRevealId) ? pendingRevealId : null
  // A match shown from a collapsed branch gets its real size only now.
  const searchId = dimensionChanges.some((change) => change.id === searchCurrentId.value) ? searchCurrentId.value : null
  for (const change of dimensionChanges) {
    const node = nodes.value.find((item) => item.id === change.id)
    const height = change.dimensions?.height ?? node?.dimensions?.height
    if (!node || !Number.isFinite(height)) continue
    const previousHeight = measuredNodeHeights.get(node.id)
    measuredNodeHeights.set(node.id, height)
    if (!autoLayout.value && previousHeight && height > previousHeight + 0.5) {
      shiftNodesBelow(nodes.value, node.position.y + previousHeight, height - previousHeight, new Set([node.id]))
    }
  }
  if (!autoLayout.value && !pendingLayout && !pendingFocus) {
    if (revealId) revealAfterMeasurement(revealId)
    if (searchId) revealSearchMatch(searchId)
    return
  }
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(() => {
    if (dragStart) return
    if (autoLayout.value || pendingLayout) {
      const fit = pendingLayout && !pendingFocus
      pendingLayout = false
      relayout(false, fit)
    }
    flushFocus()
    if (revealId) revealAfterMeasurement(revealId)
    if (searchId) revealSearchMatch(searchId)
  })
}

watch(inspectorOpen, (open) => {
  try {
    localStorage.setItem(INSPECTOR_KEY, open ? '1' : '0')
  } catch {
    // Not remembered — no big deal.
  }
})

// New node in the panel — scroll to the top.
watch(() => primaryNode.value?.id, () => {
  if (inspectorBody.value) inspectorBody.value.scrollTop = 0
})

watch([nodes, edges, title, autoLayout, settings], () => {
  dirty = true
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    persistDocuments()
  }, 250)
}, { deep: true })

onMounted(() => {
  applyVisibility()
  persistDocuments()
  hydrateImageUrls()
  const usedAssets = new Set()
  for (const document of documents.value) {
    for (const assetId of referencedAssetIds(document.map)) usedAssets.add(assetId)
  }
  pruneImageAssets(usedAssets).catch(() => {})
  // Capture keyboard navigation before Vue Flow can move the selected node.
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('paste', onPaste)
  window.addEventListener('pagehide', persistDocuments)
  window.addEventListener('resize', placeSearch)
  clockTimer = setInterval(() => (now.value = Date.now()), 60000)
  showShortcutsTip()
})

// Once ever: a hint about “?” instead of the old key hint line at the bottom of the canvas.
function showShortcutsTip() {
  try {
    if (localStorage.getItem(SHORTCUTS_TIP_KEY)) return
    localStorage.setItem(SHORTCUTS_TIP_KEY, '1')
  } catch {
    return
  }
  notify('Press ? to see keyboard shortcuts', { duration: 6000, tip: true })
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('pagehide', persistDocuments)
  window.removeEventListener('resize', placeSearch)
  persistDocuments(false)
  clearTimeout(saveTimer)
  clearTimeout(toastTimer)
  clearTimeout(copiedTimer)
  clearInterval(clockTimer)
  cancelAnimationFrame(layoutFrame)
  clearTimeout(focusTimer)
  clearImageUrls()
})
</script>

<template>
  <div class="app-shell" @click="closeMenus">
    <main class="workspace" :class="{ 'inspector-open': inspectorOpen }">
      <section ref="canvasElement" class="canvas-wrap" :class="{ linking: connectionStartHandle, searching: searchMatches.length }" @wheel.capture="onCanvasWheel" @dragover.prevent @drop.prevent="onImageDrop">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          class="mind-flow"
          :default-edge-options="defaultEdgeOptions"
          :connection-mode="ConnectionMode.Loose"
          :delete-key-code="null"
          :selection-key-code="true"
          :multi-selection-key-code="MULTI_SELECT_KEY"
          :pan-on-drag="[0, 1, 2]"
          :pan-on-scroll="true"
          :pan-on-scroll-speed="1"
          :pan-activation-key-code="PAN_KEY"
          :min-zoom="MIN_ZOOM"
          :max-zoom="MAX_ZOOM"
          :zoom-on-scroll="false"
          :zoom-on-pinch="true"
          :zoom-on-double-click="false"
          :elevate-edges-on-select="true"
          @connect="connectNodes"
          :node-drag-threshold="4"
          @nodes-change="onNodesChange"
          @nodes-initialized="onNodesInitialized"
          @node-drag-start="onNodeDragStart"
          @node-drag="onNodeDrag"
          @node-drag-stop="onNodeDragStop"
          @node-double-click="({ node }) => focusEditor(node.id)"
          @node-context-menu="showNodeMenu"
          @pane-click="closeOverlays"
        >
          <template #edge-branch="edge">
            <g class="branch-edge" :class="{ 'search-path': searchMarks.has(edge.target) }">
              <BaseEdge :id="edge.id" :path="branchPath(edge)" :style="edge.style" :interaction-width="12" />
            </g>
          </template>

          <template #node-mind="{ id, data, selected }">
            <div
              class="mind-node"
              :data-mind-node="id"
              :class="[`style-${nodeStyle(data)}`, `side-${data.side}`, `kids-${childrenSide(id, data)}`, {
                selected,
                root: data.root,
                'image-only': data.image && !data.label,
                deep: (depths.get(id) ?? 0) > 2,
                editing: editingId === id,
                collapsed: data.collapsed,
                'drop-target': dropTargetId === id,
                'merge-target': dropTargetId === id && dragPreview?.mode === 'merge',
                'search-match': searchState(id) === 'match' || searchState(id) === 'current',
                'search-current': searchState(id) === 'current',
              }]"
              :style="{ '--branch': data.color }"
              :aria-current="selected ? 'true' : undefined"
              :aria-label="data.label || data.image?.name"
              tabindex="-1"
            >
              <Handle id="target-left" type="target" :position="Position.Left" class="node-handle target-handle" />
              <Handle id="source-left" type="source" :position="Position.Left" class="node-handle source-handle" title="Drag to link to another node" />
              <img
                v-if="data.image && imageUrls.get(data.image.assetId)"
                class="node-image"
                :src="imageUrls.get(data.image.assetId)"
                :alt="data.label ? '' : data.image.name"
                draggable="false"
                @dblclick.stop="openImagePreview(id)"
              />
              <span v-else-if="data.image" class="image-placeholder">{{ data.image.name }}</span>
              <div
                v-if="editingId === id"
                class="node-editor nodrag nopan"
                @pointerdown.stop
                @focusout="onEditorFocusOut"
              >
                <textarea
                  v-model="editDraft.label"
                  :data-editor="id"
                  class="node-title"
                  name="node-text"
                  rows="1"
                  maxlength="500"
                  aria-label="Node title"
                  @keydown.enter.exact.prevent="finishEditing()"
                  @keydown.shift.enter.prevent="focusNoteEditor(id)"
                  @keydown.tab.exact.prevent="focusNoteEditor(id)"
                  @keydown.esc.prevent="finishEditing(false)"
                ></textarea>
                <input
                  v-model="editDraft.note"
                  :data-note-editor="id"
                  class="node-note"
                  name="node-note"
                  maxlength="200"
                  placeholder="Details"
                  aria-label="Second line"
                  @keydown.enter.prevent="finishEditing()"
                  @keydown.tab.exact.prevent="finishEditing()"
                  @keydown.esc.prevent="finishEditing(false)"
                />
              </div>
              <template v-else>
                <span v-if="data.label" class="node-title"><template v-for="(part, index) in searchParts(id, data.label)" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                <span v-if="data.note" class="node-note"><template v-for="(part, index) in searchParts(id, data.note)" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              </template>
              <button
                v-if="hasChildren(id)"
                class="collapse-button nodrag nopan"
                :title="data.collapsed ? 'Expand branch' : 'Collapse branch'"
                :aria-label="data.collapsed ? `Expand branch, ${hiddenCount(id)} hidden` : 'Collapse branch'"
                @click.stop="toggleCollapse(id)"
              >
                <template v-if="data.collapsed">{{ hiddenCount(id) }}</template>
                <svg v-else viewBox="0 0 10 10"><path d="M2 5h6"/></svg>
              </button>
              <Handle id="target-right" type="target" :position="Position.Right" class="node-handle target-handle" />
              <Handle id="source-right" type="source" :position="Position.Right" class="node-handle source-handle" title="Drag to link to another node" />
              <Handle id="source-tree" type="source" :position="Position.Bottom" class="node-handle tree-handle" :connectable="false" />
            </div>
          </template>
        </VueFlow>

        <div ref="documentIsland" class="island document-island" @click.stop>
          <button
            ref="brandButton"
            class="brand-mark"
            :class="{ open: appMenuOpen }"
            aria-label="App menu"
            aria-haspopup="menu"
            :aria-expanded="appMenuOpen"
            @click="toggleAppMenu"
          ><Logo :size="24" aria-hidden="true" /></button>
          <input
            v-if="renaming"
            ref="renameInput"
            v-model="title"
            class="rename-input"
            name="map-title"
            aria-label="Map title"
            maxlength="100"
            @keydown.enter.prevent="finishRename"
            @keydown.esc.prevent="finishRename"
            @blur="finishRename"
          />
          <button
            v-else
            class="document-button"
            :class="{ active: documentsOpen }"
            :aria-expanded="documentsOpen"
            aria-haspopup="menu"
            @click="toggleDocuments"
            @dblclick="startRename"
          >
            <span class="document-name">{{ title }}</span>
            <span class="save-dot" :class="saveState" :title="saveLabel"></span>
            <svg class="chevron" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
          </button>
        </div>

        <div
          v-if="appMenuOpen"
          ref="appMenu"
          class="app-menu"
          role="menu"
          aria-label="App menu"
          @click.stop
          @keydown="onAppMenuKeydown"
        >
          <button class="app-menu-version" role="menuitem" tabindex="-1" title="Copy version number" @click="copyVersion">
            <strong><Logo :size="20" aria-hidden="true" />mindspace</strong>
            <span aria-live="polite">{{ versionCopied ? 'Copied' : `Version ${APP_VERSION}` }}</span>
          </button>
          <hr />
          <a
            v-if="releaseUrl"
            class="app-menu-item"
            role="menuitem"
            tabindex="-1"
            :href="releaseUrl"
            target="_blank"
            rel="noopener"
            @click="openWhatsNew"
          >
            <span>What’s new</span>
            <i v-if="whatsNewUnseen" class="app-menu-dot" aria-label="New"></i>
          </a>
          <button class="app-menu-item" role="menuitem" tabindex="-1" @click="openHelp(brandButton)">
            <span>Keyboard shortcuts</span>
            <kbd>?</kbd>
          </button>
          <template v-if="REPOSITORY_URL">
            <hr />
            <a class="app-menu-item" role="menuitem" tabindex="-1" :href="REPOSITORY_URL" target="_blank" rel="noopener" @click="closeAppMenu()">
              <span>GitHub</span><i class="app-menu-arrow" aria-hidden="true">↗</i>
            </a>
            <a class="app-menu-item" role="menuitem" tabindex="-1" :href="issueUrl()" target="_blank" rel="noopener" @click="closeAppMenu()">
              <span>Report a problem</span><i class="app-menu-arrow" aria-hidden="true">↗</i>
            </a>
          </template>
        </div>

        <div
          v-if="documentsOpen"
          ref="documentMenu"
          class="island-menu document-menu"
          role="menu"
          aria-label="Maps"
          @click.stop="rowMenu = null"
          @keydown="onDocumentMenuKeydown"
        >
          <div class="menu-status">
            <span><i class="save-dot" :class="saveState"></i>{{ saveLabel }}</span>
            <small>{{ relativeTime(activeDocument?.updatedAt, now) }}</small>
          </div>
          <label v-if="documents.length > 6" class="document-search">
            <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input
              v-model="documentQuery"
              name="document-search"
              placeholder="Find a map"
              aria-label="Find a map"
              @keydown.down.prevent="documentRows()[0]?.focus()"
            />
          </label>
          <TransitionGroup tag="div" name="doc-row" class="document-list">
            <div
              v-for="item in documentItems"
              :key="item.id"
              :data-id="item.id"
              class="document-item"
              :class="{ active: item.active, 'menu-open': rowMenu?.id === item.id, renaming: renamingDocId === item.id, flash: flashDocId === item.id }"
              role="menuitem"
              tabindex="-1"
              @click="onDocumentRowClick(item.id, $event)"
              @contextmenu.prevent="openRowMenu(item.id, $event.currentTarget)"
              @keydown="onDocumentRowKeydown(item.id, $event)"
            >
              <input
                v-if="renamingDocId === item.id"
                v-model="renameDraft"
                class="document-rename"
                name="document-rename"
                maxlength="100"
                :aria-label="`New title for “${item.title}”`"
                @click.stop
                @keydown="onDocumentRenameKeydown"
                @blur="commitDocumentRename"
              />
              <span v-else class="document-item-title" @dblclick.stop="onDocumentTitleDblclick(item.id)">{{ item.title }}</span>
              <small>{{ item.meta }}</small>
              <button
                class="row-more"
                tabindex="-1"
                :aria-label="`Actions for “${item.title}”`"
                aria-haspopup="menu"
                :aria-expanded="rowMenu?.id === item.id"
                @click.stop="openRowMenu(item.id, $event.currentTarget.closest('.document-item'))"
              >
                <svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>
              </button>
              <span class="check">
                <svg v-if="item.active" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>
              </span>
            </div>
          </TransitionGroup>
          <p v-if="!documentItems.length" class="document-empty">Nothing found</p>
          <hr />
          <div class="menu-actions">
            <button class="outline-button" role="menuitem" @click="newMap">
              <svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>New
            </button>
            <button class="outline-button" role="menuitem" @click="importFile">
              <svg viewBox="0 0 16 16"><path d="M8 10V2M5 7l3 3 3-3"/><path d="M2.5 11v2.5h11V11"/></svg>Import
            </button>
          </div>

          <div
            v-if="rowMenu"
            class="row-menu"
            role="menu"
            :style="{ left: `${rowMenu.left}px`, top: `${rowMenu.top}px` }"
            @click.stop
            @keydown="onRowMenuKeydown"
          >
            <button role="menuitem" @click="startDocumentRename(rowMenu.id)"><span>Rename</span><kbd>F2</kbd></button>
            <button role="menuitem" @click="duplicateDocument(rowMenu.id)"><span>Duplicate</span><kbd>{{ keyLabel('Mod') }}D</kbd></button>
            <hr />
            <button class="danger" role="menuitem" @click="deleteDocument(rowMenu.id)"><span>Delete</span><kbd>Del</kbd></button>
          </div>
        </div>

        <Transition name="search">
          <div
            v-if="searchOpen"
            class="island search-island"
            role="search"
            :style="{ top: `${searchPlacement.top}px`, width: `${searchPlacement.width}px` }"
            @click.stop
          >
            <svg class="search-icon" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input
              ref="searchInput"
              v-model="searchQuery"
              name="map-search"
              placeholder="Find on map"
              aria-label="Find on map"
              autocomplete="off"
              @keydown="onSearchKeydown"
            />
            <span v-if="searchTerm" class="search-count" :class="{ empty: !searchMatches.length }" aria-live="polite">{{ searchCount }}</span>
            <button class="search-button" :disabled="!searchMatches.length" :title="`Previous · ${keyLabel('Shift')} Enter`" aria-label="Previous match" @click="stepSearch(-1)">
              <svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>
            </button>
            <button class="search-button" :disabled="!searchMatches.length" title="Next · Enter" aria-label="Next match" @click="stepSearch(1)">
              <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
            </button>
            <span class="divider"></span>
            <button class="search-button" title="Close · Esc" aria-label="Close search" @click="closeSearch">
              <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
        </Transition>

        <div ref="topRight" class="top-right" @click.stop>
          <div class="island action-island">
            <button
              class="island-icon search-toggle"
              :class="{ active: searchOpen }"
              :aria-pressed="searchOpen"
              :title="`Search · ${keysLabel('search')}`"
              aria-label="Search"
              @click="searchOpen ? closeSearch() : openSearch()"
            >
              <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            </button>
            <span class="divider"></span>
            <button class="island-icon" :disabled="!history.length" :title="`Undo (${keysLabel('undo')})`" aria-label="Undo" @click="undo">
              <svg viewBox="0 0 16 16"><path d="M5.5 4L2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 010 8H8"/></svg>
            </button>
            <button class="island-icon" :disabled="!future.length" :title="`Redo (${keysLabel('redo')})`" aria-label="Redo" @click="redo">
              <svg viewBox="0 0 16 16"><path d="M10.5 4l3 3-3 3"/><path d="M13.5 7h-7a4 4 0 000 8H8"/></svg>
            </button>
            <span class="divider"></span>
            <div class="export-wrap">
              <button class="export-button" :disabled="exportBusy" :aria-expanded="exportOpen" aria-haspopup="menu" @click="toggleExport">
                {{ exportBusy ? 'Exporting…' : 'Export' }}
                <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
              </button>
              <div v-if="exportOpen" class="island-menu export-menu" role="menu">
                <button class="menu-item" role="menuitem" @click="exportMap('mindmap')">Mindspace file<small>.mindmap</small></button>
                <button class="menu-item" role="menuitem" @click="exportMap('opml')">OPML outline<small>.opml</small></button>
              </div>
            </div>
          </div>
          <button
            class="island inspector-toggle"
            :class="{ active: inspectorOpen }"
            :aria-pressed="inspectorOpen"
            :title="inspectorOpen ? 'Hide properties panel' : 'Show properties panel'"
            :aria-label="inspectorOpen ? 'Hide properties panel' : 'Show properties panel'"
            @click="inspectorOpen = !inspectorOpen"
          >
            <svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/></svg>
          </button>
        </div>
        <input ref="fileInput" class="visually-hidden" name="map-file" aria-label="Open map file" type="file" accept=".mindmap,.json,.opml,application/json,text/xml" @change="loadFile" />

        <svg v-if="alignmentGuides.length || dragPreview?.mode === 'attach'" class="drag-preview" aria-hidden="true">
          <g :transform="`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`">
            <path v-if="dragPreview?.mode === 'attach'" :d="dragPreview.path" :stroke="dragPreview.color" />
            <line
              v-for="(guide, index) in alignmentGuides"
              :key="index"
              :x1="guide.x1"
              :y1="guide.y1"
              :x2="guide.x2"
              :y2="guide.y2"
            />
          </g>
        </svg>

        <div class="zoom-controls">
          <button
            class="auto-layout-toggle"
            :class="{ active: autoLayout }"
            :aria-pressed="autoLayout"
            :title="autoLayout ? 'Auto layout: on' : 'Auto layout'"
            aria-label="Auto layout"
            @click="setAutoLayout(!autoLayout)"
          >
            <svg viewBox="0 0 24 24"><rect x="3" y="8" width="6" height="8" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 12h3m0 0V6h3m-3 6v6h3"/></svg>
          </button>
          <button title="Zoom out" @click="zoomOut({ duration: 180 })">−</button>
          <button title="Fit map to screen" @click="focusMap()">
            <svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></svg>
          </button>
          <button title="Zoom in" @click="zoomIn({ duration: 180 })">+</button>
          <button class="zoom-value" title="Reset zoom to 100%" @click="zoomTo(1, { duration: 180 })">{{ zoomPercent }}%</button>
        </div>
      </section>

      <aside v-if="inspectorOpen" class="inspector" aria-label="Properties panel">
        <header class="inspector-head">
          <div class="inspector-title">
            <span>{{ inspectorMode === 'map' ? 'Map' : inspectorMode === 'multi' ? 'Selection' : nodePath }}</span>
            <strong>{{ inspectorMode === 'map' ? title : inspectorMode === 'multi' ? pluralNodes(selectedCount) : primaryNode.data.label || primaryNode.data.image?.name }}</strong>
          </div>
          <button v-if="inspectorMode === 'multi'" class="inspector-text-button" @click="clearSelection">Clear</button>
          <button v-else class="inspector-close" title="Close panel" aria-label="Close panel" @click="inspectorOpen = false">
            <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </header>

        <div ref="inspectorBody" class="inspector-body">
          <template v-if="inspectorMode === 'node'">
            <section v-if="primaryNode.data.image" class="panel-section">
              <h3>Image</h3>
              <p class="panel-hint">{{ primaryNode.data.image.name }}</p>
              <button v-if="primaryNode.data.label" class="panel-image-remove" @click="removeEmbeddedImage(primaryNode)">Remove image</button>
            </section>

            <section v-if="primaryNode.data.label" class="panel-section">
              <h3>Text</h3>
              <input
                class="panel-input title-input"
                :value="primaryNode.data.label"
                name="panel-node-title"
                aria-label="Title"
                maxlength="500"
                @focus="beginPanelEdit"
                @input="primaryNode.data.label = $event.target.value"
                @blur="endPanelEdit(primaryNode)"
                @keydown="onPanelKeydown"
              />
              <input
                class="panel-input note-input"
                :value="primaryNode.data.note"
                name="panel-node-note"
                aria-label="Second line"
                placeholder="Second line: price, note"
                maxlength="200"
                @focus="beginPanelEdit"
                @input="primaryNode.data.note = $event.target.value"
                @blur="endPanelEdit()"
                @keydown="onPanelKeydown"
              />
              <p class="panel-hint">The second line appears in gray below the title</p>
            </section>

            <section class="panel-section">
              <h3>Branch color</h3>
              <div class="swatches">
                <button
                  v-for="color in swatches"
                  :key="color"
                  :class="{ active: selectedColor === color }"
                  :style="{ '--swatch': color }"
                  :aria-label="`Color ${color}`"
                  :aria-pressed="selectedColor === color"
                  @click="setColor(color)"
                ></button>
              </div>
              <button
                v-if="primaryDescendants || primaryNode.data.root"
                class="panel-toggle"
                role="switch"
                :aria-checked="inheritColor"
                @click="inheritColor = !inheritColor"
              >
                <span class="toggle-track" :class="{ on: inheritColor }"><span></span></span>
                Apply to child nodes ({{ primaryDescendants }})
              </button>
            </section>

            <section class="panel-section">
              <h3>Style</h3>
              <div class="segmented" role="radiogroup" aria-label="Node style">
                <button v-for="[value, label] in STYLE_OPTIONS" :key="value" role="radio" :aria-checked="selectedStyle === value" :class="{ active: selectedStyle === value }" @click="setStyle(value)">{{ label }}</button>
              </div>
            </section>

            <section class="panel-actions">
              <button @click="addChild(primaryNode.id)"><span>Child node</span><kbd>{{ keysLabel('addChild') }}</kbd></button>
              <button @click="addSibling"><span>Sibling node</span><kbd>{{ keysLabel('addSibling') }}</kbd></button>
              <button v-if="hasChildren(primaryNode.id)" @click="setCollapsed([primaryNode.id], !primaryNode.data.collapsed)">
                <span>{{ primaryNode.data.collapsed ? 'Expand branch' : 'Collapse branch' }}</span><kbd>{{ keysLabel(primaryNode.data.collapsed ? 'expand' : 'collapse') }}</kbd>
              </button>
              <button class="danger" :disabled="!removableSelectedNodes.length" @click="removeSelected"><span>Delete node</span><kbd>{{ keysLabel('remove') }}</kbd></button>
            </section>
          </template>

          <template v-else-if="inspectorMode === 'multi'">
            <section class="panel-section">
              <h3>Branch color</h3>
              <div class="swatches">
                <button
                  v-for="color in swatches"
                  :key="color"
                  :class="{ active: selectedColor === color }"
                  :style="{ '--swatch': color }"
                  :aria-label="`Color ${color}`"
                  :aria-pressed="selectedColor === color"
                  @click="setColor(color)"
                ></button>
              </div>
            </section>
            <section class="panel-section">
              <h3>Style</h3>
              <div class="segmented" role="radiogroup" aria-label="Nodes style">
                <button v-for="[value, label] in STYLE_OPTIONS" :key="value" role="radio" :aria-checked="selectedStyle === value" :class="{ active: selectedStyle === value }" @click="setStyle(value)">{{ label }}</button>
              </div>
            </section>
            <section class="panel-actions">
              <button @click="setCollapsed(selectedNodes.map((node) => node.id), true)"><span>Collapse branches</span></button>
              <button class="danger" :disabled="!removableSelectedNodes.length" @click="removeSelected"><span>Delete {{ pluralNodes(removableSelectedNodes.length) }}</span><kbd>{{ keysLabel('remove') }}</kbd></button>
            </section>
          </template>

          <template v-else>
            <section class="panel-section">
              <h3>Layout</h3>
              <div class="segmented" role="radiogroup" aria-label="Layout">
                <button v-for="[value, label] in LAYOUT_OPTIONS" :key="value" role="radio" :aria-checked="settings.layout === value" :class="{ active: settings.layout === value }" @click="setSetting('layout', value)">{{ label }}</button>
              </div>
            </section>

            <section class="panel-section">
              <h3>Branch palette</h3>
              <div class="palettes">
                <button
                  v-for="(palette, key) in PALETTES"
                  :key="key"
                  :class="{ active: settings.palette === key }"
                  :aria-pressed="settings.palette === key"
                  @click="setSetting('palette', key)"
                >
                  <span class="palette-dots"><i v-for="color in palette.colors" :key="color" :style="{ background: color }"></i></span>
                  <span class="palette-name">{{ palette.name }}</span>
                  <svg v-if="settings.palette === key" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>
                </button>
              </div>
            </section>

            <section class="panel-section">
              <h3>Lines</h3>
              <div class="segmented" role="radiogroup" aria-label="Lines">
                <button v-for="[value, label] in LINE_OPTIONS" :key="value" role="radio" :aria-checked="settings.lines === value" :class="{ active: settings.lines === value }" @click="setSetting('lines', value)">{{ label }}</button>
              </div>
              <h3 class="subheading">Density</h3>
              <div class="segmented" role="radiogroup" aria-label="Density">
                <button v-for="[value, label] in DENSITY_OPTIONS" :key="value" role="radio" :aria-checked="settings.density === value" :class="{ active: settings.density === value }" @click="setSetting('density', value)">{{ label }}</button>
              </div>
            </section>
          </template>
        </div>

        <footer v-if="inspectorMode === 'node'" class="inspector-foot">Level {{ primaryLevel }} · {{ childNodesLabel(primaryDescendants) }}</footer>
        <footer v-else-if="inspectorMode === 'map'" class="inspector-foot">{{ plural(topicCount, 'topic', 'topics') }} · {{ pluralNodes(nodes.length) }}</footer>
      </aside>

      <div v-if="contextMenu" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
        <button @click="addChild(contextMenu.id)"><span>＋</span>Child node <kbd>{{ keysLabel('addChild') }}</kbd></button>
        <button @click="addSibling"><span>↳</span>Sibling node <kbd>{{ keysLabel('addSibling') }}</kbd></button>
        <button @click="focusEditor(contextMenu.id); contextMenu = null"><span>✎</span>{{ imageOnly(nodes.find((node) => node.id === contextMenu.id)) ? 'Preview' : 'Edit' }}</button>
        <button v-if="hasChildren(contextMenu.id)" @click="toggleCollapse(contextMenu.id); contextMenu = null"><span>⌁</span>Collapse / expand</button>
        <hr />
        <button class="danger" :disabled="nodes.find((node) => node.id === contextMenu.id)?.data.root && rootCount === 1" @click="removeSelected"><span>⌫</span>Delete branch</button>
      </div>

      <Transition name="toast">
        <div
          v-if="deletion"
          class="toast undo-toast"
          role="status"
          @mouseenter="pauseDeletionTimer"
          @mouseleave="resumeDeletionTimer"
          @click.stop
        >
          <span>Map “{{ deletion.title }}” deleted</span>
          <button @click="undoDeletion">Undo</button>
        </div>
        <div v-else-if="toast" class="toast" :class="{ 'undo-toast': toastTip }" role="status">{{ toast }}</div>
      </Transition>

      <dialog v-if="imagePreview" ref="imageDialog" class="image-preview" aria-label="Image preview" @close="onImagePreviewClosed" @click.self="closeImagePreview">
        <button class="image-preview-close" aria-label="Close image preview" @click="closeImagePreview">×</button>
        <img :src="imagePreview.src" :alt="imagePreview.name" />
      </dialog>

      <Transition name="help">
        <div v-if="helpOpen" class="help-backdrop" @click="closeHelp">
          <div
            ref="helpDialog"
            class="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            tabindex="-1"
            @click.stop
            @keydown="onHelpKeydown"
          >
            <header class="help-head">
              <h2 id="help-title">Keyboard shortcuts</h2>
              <button class="inspector-close" title="Close · Esc" aria-label="Close" @click="closeHelp">
                <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </header>
            <div class="help-body">
              <section v-for="group in helpGroups" :key="group.title" class="help-group">
                <h3>{{ group.title }}</h3>
                <dl>
                  <div v-for="item in group.items" :key="item.id" class="help-row">
                    <dt>{{ item.label }}</dt>
                    <dd>
                      <template v-for="(binding, index) in item.bindings" :key="binding.join('-')">
                        <span v-if="index" class="help-or">or</span>
                        <span class="help-binding"><kbd v-for="key in binding" :key="key">{{ key }}</kbd></span>
                      </template>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        </div>
      </Transition>
    </main>
  </div>
</template>
