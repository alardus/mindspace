<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { BaseEdge, Handle, Position, VueFlow, getRectOfNodes, getTransformForBounds, useVueFlow } from '@vue-flow/core'
import {
  DEFAULT_SIZE,
  LIBRARY_STORAGE_KEY,
  LINK_FRAME,
  MARKS,
  MARK_SIZE,
  MAX_LABEL_LENGTH,
  MAX_LINK_LABEL,
  PALETTES,
  STORAGE_KEY,
  allowsAttachTarget,
  blockPreview,
  branchColor,
  branchCurveBend,
  canLink,
  descendantsOf,
  highlightParts,
  insertTreeEdgeAfter,
  layoutVerticalGap,
  layoutNodes,
  linkAnchor,
  linkFrame,
  linkParts,
  linkPath,
  linkSides,
  makeEdge,
  makeNode,
  markName,
  mergeImageNode,
  nearestLinkSide,
  nextMatch,
  nodeInDirection,
  normalizeLibrary,
  normalizeMap,
  normalizeSearch,
  normalizeSettings,
  nodeStyle,
  orientEdges,
  paint,
  paletteColors,
  parseMarkdown,
  parseOpml,
  pointRectDistance,
  plural,
  pluralNodes,
  recolorForPalette,
  referencedAssetIds,
  reparentBranches,
  relativeTime,
  resizeFreeMark,
  rigidRootBranch,
  searchOrder,
  selectedBranchRoots,
  shiftNodesBelow,
  snapNode,
  starterMap,
  toMarkdown,
  toOpml,
  toggleMark,
} from './model.js'
import { createMindmapFile, readMindmapFile } from './archive.js'
import { BACKUP_VIEW, DRIVE_MESSAGES, backupKey, backupUi, createBackup, createBackupQueue, errorKind, linkedDocument, replaceBackup, pushBackup } from './backup.js'
import * as drive from './google-drive.js'
import { createImageAsset, deleteImageAssets, loadImageAsset, pruneImageAssets, saveImageAssets } from './assets.js'
import {
  ClipboardPayloadError,
  MINDSPACE_CLIPBOARD_TYPE,
  assertClipboardAssetCapacity,
  assertClipboardCapacity,
  clipboardImageFiles,
  isEditableClipboardTarget,
  parseClipboardData,
  serializeClipboardBranches,
  translateClipboardFragment,
} from './clipboard.js'
import Logo from './Logo.vue'
import MarkIcon from './MarkIcon.vue'
import { IS_MAC, MULTI_SELECT_KEY, PAN_KEY, findShortcut, hasLinkMod, hasMod, keyLabel, selectAllCanvasNodes, shortcutGroups, shortcutKeys } from './shortcuts.js'

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
const freeMarks = ref(initial.freeMarks ?? [])
const links = ref(initial.links ?? [])
const selectedLinkId = ref(null)
const selectedMarkId = ref(null)
const marksOpen = ref(false)
const marksWrap = ref(null)
const hoveredMark = ref(null)
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
const toastDot = ref('')
const toastAction = ref(null)
// Google Drive backup (10a–10c). The link itself is saved with the map (googleDriveBackup); this is what only the session knows.
const DRIVE_ENABLED = drive.DRIVE_ENABLED
const CLOUD = 'M4.6 12.5h6.9a2.9 2.9 0 00.3-5.8 3.9 3.9 0 00-7.5 1.1 2.4 2.4 0 00.3 4.7z'
// Map id → { status: saving | offline | auth | readonly | failed }. A healthy linked map has no entry.
const driveStatus = reactive({})
// The Drive action the user started and that is still running: create | pick | replace.
const driveBusy = ref('')
const driveDialog = ref(null)
const driveDialogBox = ref(null)
// Map id → the content this session last saw, to tell an edit from a map that was only opened.
const backupKeys = new Map()
// Read out by screen readers when the Drive state of the open map changes.
const announcement = ref('')
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

// Theme: the inline script in index.html applies it before first paint; this keeps it in sync afterwards.
const THEME_KEY = 'mindspace:theme'
const THEMES = { system: 'System', light: 'Light', dark: 'Dark' }
let savedTheme = null
try {
  savedTheme = localStorage.getItem(THEME_KEY)
} catch {
  // Without storage the theme follows the system.
}
const theme = ref(savedTheme in THEMES ? savedTheme : 'system')
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(darkQuery.matches)
const onSystemTheme = (event) => (systemDark.value = event.matches)
watchEffect(() => {
  const root = document.documentElement
  root.classList.add('theme-switching')
  root.dataset.theme = theme.value === 'dark' || (theme.value === 'system' && systemDark.value) ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim())
  requestAnimationFrame(() => root.classList.remove('theme-switching'))
})

function setTheme(value) {
  theme.value = value
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch {
    // The choice still applies for this session.
  }
}

function cycleTheme() {
  setTheme({ light: 'dark', dark: 'system', system: 'light' }[theme.value])
  notify(`Theme: ${THEMES[theme.value]}`)
}
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
const { dimensions, getNodes, screenToFlowCoordinate, setCenter, setViewport, viewport, zoomIn, zoomOut, zoomTo } = useVueFlow()
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
const MAX_ZOOM = 4

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
let dragRoots = []
let rigidDrag = null
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
const documentById = (id) => documents.value.find((document) => document.id === id)
const driveKeyOf = (document) => (DRIVE_ENABLED ? backupUi(document?.googleDriveBackup, driveStatus[document?.id]) : 'off')
const activeDrive = computed(() => {
  const key = driveKeyOf(activeDocument.value)
  const view = BACKUP_VIEW[key]
  const note = key === 'failed' && driveStatus[activeId.value]?.reason === 'quota' ? view.quotaNote : view?.note
  return { key, view, note, backup: activeDocument.value?.googleDriveBackup }
})
const driveFileUrl = (fileId) => `https://drive.google.com/file/d/${fileId}/view`
const driveFileLabel = (backup) => (backup.folder ? `${backup.folder} / ${backup.name}` : backup.name)
// What the ⋯ menu of a map offers for Drive, by the state of that map. A healthy linked map gets nothing.
const rowMenuDrive = computed(() => {
  const id = rowMenu.value?.id
  const key = DRIVE_ENABLED && id ? driveKeyOf(documentById(id)) : ''
  if (key === 'off') return { label: 'Save to Google Drive', run: () => openConnect(id) }
  if (key === 'conflict' || key === 'readonly') return { label: 'Choose a file in Google Drive', run: () => chooseDriveFile(id) }
  if (key === 'auth') return { label: 'Sign in to Google', run: () => signInToDrive(id) }
  return null
})
const driveDialogMap = computed(() => {
  const target = documentById(driveDialog.value?.id)
  return target ? documentTitle(target) : ''
})
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
      // What an inactive map went through this session is not shown in the list: only its saved state.
      const key = !DRIVE_ENABLED ? 'off' : active ? activeDrive.value.key : backupUi(document.googleDriveBackup)
      return {
        id: document.id,
        active,
        title: documentTitle(document),
        cloud: key === 'off' ? '' : BACKUP_VIEW[key].tone === 'warn' ? 'warn' : 'ok',
        meta: [pluralNodes(active ? nodes.value.length : document.map.nodes.length), relativeTime(document.updatedAt, now.value)]
          .filter(Boolean).join(' · '),
      }
    })
})
const nodesById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const parentOf = computed(() => new Map(edges.value
  .filter((edge) => edge.data?.kind === 'tree')
  .map((edge) => [edge.target, edge.source])))
const inspectorMode = computed(() => (selectedCount.value > 1 ? 'multi' : selectedCount.value === 1 ? 'node' : selectedLink.value ? 'link' : 'map'))
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
  const direction = sourcePosition === Position.Left ? -1 : 1
  const bend = branchCurveBend(sourceX, targetX, direction)
  if (!bend) return `M${sourceX},${sourceY} L${targetX},${targetY}`
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
        ...(node.data.marks?.length ? { marks: [...node.data.marks] } : {}),
      },
    })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'default',
      class: 'tree-edge',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: { kind: 'tree' },
    })),
    ...(freeMarks.value.length ? { freeMarks: freeMarks.value.map((mark) => ({ ...mark })) } : {}),
    ...(links.value.length ? { links: links.value.map((link) => ({ ...link })) } : {}),
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
  freeMarks.value = normalized.freeMarks ?? []
  links.value = normalized.links ?? []
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

// dot and action make it a status toast (10c): the look of the Undo toast, six seconds, an optional action on the right.
function notify(message, { duration = 2600, tip = false, dot = '', action = null, about = null } = {}) {
  toast.value = message
  toastTip.value = tip || Boolean(dot)
  toastDot.value = dot
  toastAction.value = action
  toastAbout = about
  clearTimeout(rowClickTimer)
  finalizeDeletion()
  startToastTimer(dot ? 6000 : duration)
}

let toastDeadline = 0
let toastRemaining = 0
// The map a status toast speaks about: once that map's Drive state moves on, the toast is stale and goes.
let toastAbout = null
function dropToastAbout(id) {
  if (toast.value && toastAbout === id) toast.value = ''
}
function startToastTimer(ms) {
  clearTimeout(toastTimer)
  toastDeadline = Date.now() + ms
  toastTimer = setTimeout(() => (toast.value = ''), ms)
}

// A toast under the cursor waits.
function pauseToast() {
  clearTimeout(toastTimer)
  toastRemaining = Math.max(0, toastDeadline - Date.now())
}

function resumeToast() {
  if (toast.value) startToastTimer(toastRemaining)
}

function runToastAction() {
  const action = toastAction.value
  toast.value = ''
  action?.run()
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

function onCopy(event) {
  if (isEditableClipboardTarget(event.target) || !selectedNodes.value.length || !event.clipboardData) return
  try {
    const copied = serializeClipboardBranches(nodes.value, edges.value, selectedNodes.value.map((node) => node.id), links.value)
    event.clipboardData.setData(MINDSPACE_CLIPBOARD_TYPE, copied.custom)
    event.clipboardData.setData('text/plain', copied.text)
    event.preventDefault()
    notify(`Copied ${pluralNodes(copied.count)}`)
  } catch {
    notify('The selected branch could not be copied')
  }
}

async function onPaste(event) {
  if (isEditableClipboardTarget(event.target)) return
  const files = clipboardImageFiles(event.clipboardData)
  if (files.length) {
    event.preventDefault()
    if (files.length !== 1) return notify('Paste one image at a time.')
    const bounds = canvasElement.value?.getBoundingClientRect()
    if (!bounds) return
    addImageFile(files[0], screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }))
    return
  }
  if (!event.clipboardData) return

  let fragment
  try {
    fragment = parseClipboardData(event.clipboardData)
    if (!fragment) return
    assertClipboardCapacity(nodes.value.length, fragment.nodes.length)
  } catch (error) {
    event.preventDefault()
    return notify(error instanceof ClipboardPayloadError ? error.message : 'The clipboard content could not be pasted')
  }

  event.preventDefault()
  const documentAtStart = activeId.value
  try {
    const assetIds = new Set(fragment.nodes.flatMap((node) => node.data.image?.assetId ? [node.data.image.assetId] : []))
    assertClipboardAssetCapacity(referencedAssetIds(cleanMap()), assetIds)
    const assets = await Promise.all([...assetIds].map((assetId) => loadImageAsset(assetId)))
    if (assets.some((asset) => !asset)) throw new ClipboardPayloadError('A copied image is no longer available')
    if (activeId.value !== documentAtStart) return notify('Content was not pasted because the map changed.')
    assertClipboardCapacity(nodes.value.length, fragment.nodes.length)
    assertClipboardAssetCapacity(referencedAssetIds(cleanMap()), assetIds)

    if (fragment.source !== 'mindspace') {
      fragment = { ...fragment, nodes: layoutNodes(fragment.nodes, fragment.edges, () => null, settings.value) }
    }
    const bounds = canvasElement.value?.getBoundingClientRect()
    if (!bounds) return
    const center = screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
    fragment = translateClipboardFragment(fragment, center)

    const before = snapshot()
    const roots = new Set(fragment.roots)
    nodes.value.forEach((node) => (node.selected = false))
    fragment.nodes.forEach((node) => (node.selected = roots.has(node.id)))
    nodes.value.push(...fragment.nodes)
    edges.value.push(...fragment.edges)
    links.value.push(...(fragment.links ?? []))
    orient()
    if (autoLayout.value) relayout(false, false, false, fragment.roots[0])
    else applyVisibility()
    for (const asset of assets) {
      if (asset && !imageUrls.has(asset.image.assetId)) imageUrls.set(asset.image.assetId, URL.createObjectURL(asset.blob))
    }
    record(before)
    notify(`Pasted ${pluralNodes(fragment.nodes.length)}`)
  } catch (error) {
    notify(error instanceof ClipboardPayloadError ? error.message : 'The clipboard content could not be pasted')
  }
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
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    const editor = document.querySelector(`[data-editor="${CSS.escape(id)}"]`)
    editor?.focus()
    if (initialText === null) editor?.select()
    else {
      editor?.setSelectionRange(initialText.length, initialText.length)
    }
  })))
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
    node.data.label = label.slice(0, MAX_LABEL_LENGTH)
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
  pruneLinks()
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

// Icon names are searchable too: “done” finds every node marked Done.
const searchIndex = computed(() => new Map(nodes.value.map((node) => [node.id,
  normalizeSearch([node.data.label, node.data.note, ...(node.data.marks ?? []).map(markName)].join('\n'))])))
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
const displayParts = (id, text) => linkParts(text).map((part) => ({ ...part, search: searchParts(id, part.text) }))
const onTextLinkClick = (event) => {
  if (!hasMod(event)) event.preventDefault()
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

function onNodeDragStart({ node, nodes: dragged = [node] }) {
  if (alignmentGuides.value.length) alignmentGuides.value = []
  dragStart = snapshot()
  dragOrigin = { ...node.position }
  const draggedIds = new Set(dragged.map((item) => item.id))
  dragRoots = selectedBranchRoots(draggedIds, edges.value)
    .map((id) => nodesById.value.get(id))
    .filter(Boolean)
  const descendants = new Set(dragRoots.flatMap((item) => [...descendantsOf(item.id, edges.value)]))
  // Every selected branch moves with its parent; Vue Flow moves selected descendants itself.
  dragBranch = new Map(nodes.value
    .filter((item) => descendants.has(item.id) && !draggedIds.has(item.id))
    .map((item) => [item.id, { item, origin: { ...item.position } }]))
  const rigid = rigidRootBranch(node, dragged, edges.value, links.value)
  if (rigid) {
    const selector = (kind, id) => `.${kind}[data-id="${CSS.escape(id)}"]`
    const elements = [
      ...rigid.nodeIds.map((id) => document.querySelector(selector('vue-flow__node', id))),
      ...rigid.edgeIds.map((id) => document.querySelector(selector('vue-flow__edge', id))),
    ].filter(Boolean)
    for (const element of elements) element.style.translate = 'var(--branch-drag-x) var(--branch-drag-y)'
    rigidDrag = { elements, dx: 0, dy: 0, rawPosition: dragOrigin }
  }
}

function moveBranch(node, restore = false) {
  if (!dragBranch || !dragOrigin) return
  const dx = restore ? 0 : node.position.x - dragOrigin.x
  const dy = restore ? 0 : node.position.y - dragOrigin.y
  for (const { item, origin } of dragBranch.values()) item.position = { x: origin.x + dx, y: origin.y + dy }
}

function moveRigidBranch(node) {
  rigidDrag.dx = node.position.x - dragOrigin.x
  rigidDrag.dy = node.position.y - dragOrigin.y
  canvasElement.value.style.setProperty('--branch-drag-x', `${rigidDrag.dx}px`)
  canvasElement.value.style.setProperty('--branch-drag-y', `${rigidDrag.dy}px`)
  node.position = dragOrigin
}

function commitRigidBranch(node) {
  if (!rigidDrag) return false
  node.position = { x: dragOrigin.x + rigidDrag.dx, y: dragOrigin.y + rigidDrag.dy }
  for (const { item, origin } of dragBranch.values()) {
    item.position = { x: origin.x + rigidDrag.dx, y: origin.y + rigidDrag.dy }
  }
  for (const element of rigidDrag.elements) element.style.removeProperty('translate')
  canvasElement.value.style.removeProperty('--branch-drag-x')
  canvasElement.value.style.removeProperty('--branch-drag-y')
  rigidDrag = null
  return true
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
// The root pulls harder: cursor distance to it counts as half (attach radius is 320),
// and inside ROOT_SNAP it wins even over the node under the cursor.
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
  return { side, path: branchPath({ sourceX: x0, sourceY: y0, targetX: x1, targetY: y1, sourcePosition }) }
}

// The nearest node to the cursor: the one under it, or the closest within the radius.
function findAttachTarget(node, dragged, point) {
  const excluded = new Set(dragged.flatMap((item) => [item.id, ...descendantsOf(item.id, edges.value)]))
  let best = null
  for (const candidate of nodes.value) {
    if (excluded.has(candidate.id) || candidate.hidden) continue
    const width = candidate.dimensions?.width || 180
    const height = candidate.dimensions?.height || 30
    const proximity = pointRectDistance(point, { ...candidate.position, width, height })
    const overlap = proximity === 0
    const geometry = attachGeometry(node, candidate)
    const snapsToRoot = candidate.data.root && proximity <= ROOT_SNAP
    const distance = snapsToRoot ? -1 : overlap ? 0 : proximity * (candidate.data.root ? ROOT_PULL : 1)
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

function showAttachPreview(node, dragged, event) {
  const roots = dragRoots.length ? dragRoots : dragged
  const merge = roots.length === 1 ? findMergeTarget(roots[0], roots) : null
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const best = movedFromOrigin(node) ? merge ?? findAttachTarget(node, roots, point) : null
  const mode = merge && best === merge ? 'merge' : 'attach'
  const parentIds = roots.map((item) => parentOf.value.get(item.id))
  const changes = best && (mode === 'merge'
    || (allowsAttachTarget(parentIds, best.target.id, best.overlap)
      && roots.some((item) => best.target.id !== parentOf.value.get(item.id))))
  // Preview only: the real link doesn't change until release.
  dragPreview.value = changes
    ? {
        mode,
        targetId: best.target.id,
        overlap: best.overlap,
        paths: roots.map((item) => ({
          id: item.id,
          path: attachGeometry(item, best.target).path,
          color: best.target.data.root ? item.data.color : best.target.data.color,
        })),
      }
    : null
  dropTargetId.value = changes ? best.target.id : null
  const rootIds = new Set(roots.map((item) => item.id))
  for (const edge of edges.value) {
    if (edge.data?.kind === 'tree' && rootIds.has(edge.target)) edge.hidden = Boolean(changes)
  }
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
  const rawPosition = rigidDrag ? { ...node.position } : null
  if (alignmentGuides.value.length) alignmentGuides.value = []
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
  if (rigidDrag) {
    rigidDrag.rawPosition = rawPosition
    showAttachPreview(node, dragged, event)
    moveRigidBranch(node)
    return
  }
  moveBranch(node)
  updateSides(dragged.flatMap((item) => [item.id, ...descendantsOf(item.id, edges.value)]))
  showAttachPreview(node, dragged, event)
}

function onNodeDragStop(payload) {
  const { node } = payload
  const roots = dragRoots.length ? [...dragRoots] : [node]
  // Vue Flow restores its raw pointer position before stop; apply the active snap once more.
  const wasRigid = Boolean(rigidDrag)
  if (wasRigid) node.position = rigidDrag.rawPosition
  onNodeDrag(payload)
  if (wasRigid) commitRigidBranch(node)
  if (alignmentGuides.value.length) alignmentGuides.value = []
  const preview = dragPreview.value
  dragPreview.value = null
  dropTargetId.value = null
  applyVisibility()
  const moved = movedFromOrigin(node)
  const origin = dragOrigin
  dragOrigin = null
  if (wasRigid) updateSides([node.id])
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
    dragRoots = []
    dragStart = null
    return
  }
  const target = preview ? nodesById.value.get(preview.targetId) : null
  if (target && preview.mode === 'merge') {
    const merged = mergeImageNode(nodes.value, edges.value, roots[0].id, target.id)
    if (merged.error) {
      if (origin) {
        dragOrigin = origin
        moveBranch(node, true)
        node.position = origin
        updateSides([node.id, ...descendantsOf(node.id, edges.value)])
        dragOrigin = null
      }
      dragBranch = null
      dragRoots = []
      dragStart = null
      applyVisibility()
      notify(merged.error === 'target-has-image'
        ? 'This block already has an image'
        : merged.error === 'cycle' ? 'This image cannot be merged into its own branch' : 'Image could not be added')
      return
    }
    nodes.value = merged.nodes
    edges.value = merged.edges
    pruneLinks()
    const mergedTarget = nodes.value.find((item) => item.id === target.id)
    mergedTarget.data.collapsed = false
    selectOnly(target.id)
    dragBranch = null
    dragRoots = []
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
    const moved = reparentBranches(nodes.value, edges.value, roots.map((item) => item.id), target.id)
    nodes.value = moved.nodes
    edges.value = moved.edges
    const movedRoots = moved.rootIds.map((id) => nodes.value.find((item) => item.id === id)).filter(Boolean)
    for (const root of movedRoots) root.data.side = attachGeometry(root, target).side
    // Dropped right on a node — nudge every branch aside; pulled close — leave the group where it was released.
    if (!autoLayout.value && preview.overlap) movedRoots.forEach((root) => placeBesideParent(root, target))
    else movedRoots.forEach((root) => updateSides(descendantsOf(root.id, edges.value)))
    if (!target.data.root) {
      const branch = new Set(movedRoots.flatMap((root) => [root.id, ...descendantsOf(root.id, edges.value)]))
      for (const item of nodes.value) {
        if (!branch.has(item.id)) continue
        item.data.color = target.data.color
        item.data.manualColor = Boolean(target.data.manualColor)
      }
    }
    orient()
    target.data.collapsed = false
    notify(movedRoots.length === 1
      ? `Moved “${nodeLabel(movedRoots[0])}” to “${nodeLabel(target)}”`
      : `Moved ${pluralNodes(movedRoots.length)} to “${nodeLabel(target)}”`)
  } else if (autoLayout.value) {
    // The node was moved by hand — layout no longer puts it back.
    autoLayout.value = false
    notify('Auto layout off — nodes stay where you put them')
  }
  if (autoLayout.value) relayout(false)
  applyVisibility()
  dragRoots = []
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
    mark: event.target.closest?.('[data-mark]')?.dataset.mark,
  }
}

function closeOverlays() {
  contextMenu.value = null
  selectedMarkId.value = selectedLinkId.value = null
  finishEditing()
}

// Icon marks (8a, 8b). On nodes they live in node.data.marks; free marks are their own list, outside layout and Vue Flow.
const selectedMark = computed(() => freeMarks.value.find((mark) => mark.id === selectedMarkId.value))
const markActive = (id) => (selectedCount.value
  ? selectedNodes.value.every((node) => node.data.marks?.includes(id))
  : selectedMark.value?.mark === id)
const markTarget = computed(() => (selectedCount.value > 1 ? `on ${pluralNodes(selectedCount.value)}`
  : primaryNode.value ? `on “${nodeLabel(primaryNode.value)}”`
  : selectedMark.value ? 'replace mark' : 'on canvas'))
const MARK_CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
// The frame and its handles are screen-sized: they follow the mark but do not scale with the zoom.
const markFrame = computed(() => {
  const mark = selectedMark.value
  if (!mark) return null
  const { x, y, zoom } = viewport.value
  const side = `${mark.size * zoom + 10}px`
  return { left: `${mark.x * zoom + x - 5}px`, top: `${mark.y * zoom + y - 5}px`, width: side, height: side }
})
// The set opens under its button. It slides left when it would cover the selected node, and stays 12px inside the window.
const marksShift = computed(() => {
  const wrap = marksWrap.value
  if (!marksOpen.value || !wrap) return 0
  const right = dimensions.value.width - (inspectorOpen.value ? INSPECTOR_SPACE : 12)
    - (topRight.value.offsetWidth - wrap.offsetLeft - wrap.offsetWidth)
  const left = right - 252
  const node = selectedCount.value === 1 ? primaryNode.value : null
  const { x, y, zoom } = viewport.value
  const nodeLeft = node ? node.position.x * zoom + x : 0
  const nodeTop = node ? node.position.y * zoom + y : 0
  // 62px is the top of the set, 180px its height with room to spare.
  const covered = node && nodeLeft < right && nodeLeft + (node.dimensions?.width || DEFAULT_SIZE.width) * zoom > left
    && nodeTop < 62 + 180 && nodeTop + (node.dimensions?.height || DEFAULT_SIZE.height) * zoom > 62
  return Math.min(covered ? right - nodeLeft + 12 : 0, left - 12)
})

function toggleMarks() {
  closeMenus()
  marksOpen.value = !marksOpen.value
}

// The set stays open while you work on the canvas; a click anywhere else closes it.
function onWindowPointerDown(event) {
  if (marksOpen.value && !event.target.closest?.('.mark-wrap, .mind-flow, .mark-frame')) marksOpen.value = false
}

function onMarkGridKeydown(event) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[event.key]
  if (!step) return
  event.preventDefault()
  const cells = [...event.currentTarget.children]
  cells[cells.indexOf(document.activeElement) + step]?.focus()
}

function selectMark(id) {
  clearSelection()
  for (const edge of edges.value) edge.selected = false
  selectedLinkId.value = null
  selectedMarkId.value = id
}

// A new mark never lands on another one, nor under a node where it could not be seen or grabbed:
// it steps down and right until its spot is free.
function addFreeMark(mark) {
  const taken = () => freeMarks.value.some((other) => Math.abs(other.x - mark.x) < 1 && Math.abs(other.y - mark.y) < 1)
    || nodes.value.some((node) => !node.hidden
      && pointRectDistance({ x: mark.x + mark.size / 2, y: mark.y + mark.size / 2 }, {
        ...node.position,
        width: node.dimensions?.width || DEFAULT_SIZE.width,
        height: node.dimensions?.height || DEFAULT_SIZE.height,
      }) < mark.size / 2)
  while (taken()) {
    mark.x += 16
    mark.y += 16
  }
  freeMarks.value.push({ ...mark, id: documentId() })
  selectMark(freeMarks.value.at(-1).id)
}

// A key or a click in the set: toggles the icon on the selected nodes, swaps it on the selected free mark,
// or drops a new mark in the middle of the visible canvas.
function applyMark(id) {
  const before = snapshot()
  if (selectedCount.value) toggleMark(selectedNodes.value.filter((node) => node.data.label), id)
  else if (selectedMark.value) selectedMark.value.mark = id
  else {
    const { x, y, zoom } = viewport.value
    const visible = dimensions.value.width - (inspectorOpen.value ? INSPECTOR_SPACE : 0)
    addFreeMark({
      mark: id,
      x: (visible / 2 - x) / zoom - MARK_SIZE.initial / 2,
      y: (dimensions.value.height / 2 - y) / zoom - MARK_SIZE.initial / 2,
      size: MARK_SIZE.initial,
    })
  }
  record(before)
}

function removeNodeMark(nodeId, id) {
  const before = snapshot()
  toggleMark([nodesById.value.get(nodeId)], id)
  record(before)
  contextMenu.value = null
}

function removeFreeMark() {
  const before = snapshot()
  freeMarks.value = freeMarks.value.filter((mark) => mark.id !== selectedMarkId.value)
  record(before)
}

function duplicateFreeMark() {
  const before = snapshot()
  const { mark, x, y, size } = selectedMark.value
  addFreeMark({ mark, x: x + 16, y: y + 16, size })
  record(before)
}

// One pointer gesture on a free mark — a move or a corner resize — is one undo step, recorded on release.
function dragFreeMark(event, mark, update) {
  const before = snapshot()
  const origin = { ...mark }
  let dragging = false
  const move = (moved) => {
    const dx = moved.clientX - event.clientX
    const dy = moved.clientY - event.clientY
    // A click with a little jitter moves nothing.
    if (!dragging && Math.hypot(dx, dy) < 4) return
    dragging = true
    Object.assign(mark, update(origin, dx / viewport.value.zoom, dy / viewport.value.zoom, moved))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    record(before)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function onMarkPointerDown(event, mark) {
  if (event.button) return
  selectMark(mark.id)
  dragFreeMark(event, mark, (origin, dx, dy) => ({ x: origin.x + dx, y: origin.y + dy }))
}

function onMarkHandleDown(event, sx, sy) {
  dragFreeMark(event, selectedMark.value, (origin, dx, dy, moved) => resizeFreeMark(origin, sx, sy, dx, dy, moved.shiftKey ? 8 : 1))
}

// Picking a node lets go of the free mark and of the link, and the other way round.
watch(selectedCount, (count) => {
  if (count) selectedMarkId.value = selectedLinkId.value = null
})

// Links outside the tree (9a). Like free marks they are their own list, outside layout and Vue Flow;
// they are drawn above the tree lines and below the nodes.
const LINK_HINT_KEY = 'mindspace:hint-link'
const ARROW_OPTIONS = [['end', '→', 'Arrow at the end'], ['both', '↔', 'Arrows on both ends'], ['none', '—', 'No arrows']]
const linkHover = ref(null)
const linkDrag = ref(null)
const linkDraft = ref(null)
const linkHint = ref(false)
let linkHintsLeft = 3
try {
  linkHintsLeft -= Number(localStorage.getItem(LINK_HINT_KEY)) || 0
} catch {
  // Without storage the hint shows three times per visit.
}
let linkHintSeen = false
let pointerAt = null
let cancelLinkDrag = null
let panelLink = null

const selectedLink = computed(() => links.value.find((link) => link.id === selectedLinkId.value))
const linkGlyph = computed(() => ARROW_OPTIONS.find(([value]) => value === (selectedLink.value?.arrows ?? 'end'))[1])
const nodeBox = (node) => ({
  x: node.position.x,
  y: node.position.y,
  width: node.dimensions?.width || DEFAULT_SIZE.width,
  height: node.dimensions?.height || DEFAULT_SIZE.height,
})
const linkEnd = (node) => ({ ...nodeBox(node), side: node.data.side, level: depths.value.get(node.id) })

// A block hidden in a collapsed branch hands its links to the nearest visible ancestor.
function visibleEnd(id) {
  let node = nodesById.value.get(id)
  while (node?.hidden) node = nodesById.value.get(parentOf.value.get(node.id))
  return node
}

const drawnLinks = computed(() => links.value.flatMap((link) => {
  const from = visibleEnd(link.from)
  const to = visibleEnd(link.to)
  if (!from || !to || from.id === to.id || linkDrag.value?.linkId === link.id) return []
  const ends = [linkEnd(from), linkEnd(to)]
  const sides = linkSides(...ends)
  return [{
    link,
    ghost: from.id !== link.from || to.id !== link.to,
    ...linkPath(linkAnchor(ends[0], sides[0]), linkAnchor(ends[1], sides[1]), link.arrows),
  }]
}))
const selectedDrawn = computed(() => drawnLinks.value.find((item) => item.link.id === selectedLinkId.value))

const linkAim = computed(() => {
  const node = linkHover.value && nodesById.value.get(linkHover.value.id)
  return node ? { frame: linkFrame(nodeBox(node)), dot: linkAnchor(nodeBox(node), linkHover.value.side) } : null
})

// A dragged link runs from its fixed block to the pointer, and sticks to the block under the pointer.
const linkPreview = computed(() => {
  const drag = linkDrag.value
  const fixed = drag && visibleEnd(drag.fixedId)
  if (!fixed) return null
  const target = nodesById.value.get(drag.targetId)
  const moving = target ? linkEnd(target) : { ...drag.point, width: 0, height: 0 }
  const ends = drag.end === 'to' ? [linkEnd(fixed), moving] : [moving, linkEnd(fixed)]
  const sides = linkSides(...ends)
  const anchors = ends.map((end, index) => linkAnchor(end, sides[index], end === moving && !target ? 0 : LINK_FRAME))
  const [origin, snap] = drag.end === 'to' ? anchors : [anchors[1], anchors[0]]
  return { d: linkPath(...anchors, 'none').d, frame: target && linkFrame(nodeBox(target)), origin, snap: target && snap }
})

// The visible block whose link frame, grown by `reach`, is under the point; the nearest one where frames overlap.
function linkNodeAt(point, reach) {
  let best = null
  let nearest = LINK_FRAME + reach
  for (const node of nodes.value) {
    if (node.hidden) continue
    const distance = pointRectDistance(point, nodeBox(node))
    if (distance > nearest) continue
    best = node
    nearest = distance
  }
  return best
}

// Shift with a free pointer over the map aims a link: the block under the pointer lights up and shows one dot,
// on the side of its frame nearest to the pointer.
function aimLink(shift) {
  const point = shift && pointerAt && !linkDrag.value && !editingId.value ? screenToFlowCoordinate(pointerAt) : null
  const node = point ? linkNodeAt(point, 5) : null
  const side = node ? nearestLinkSide(nodeBox(node), point) : null
  if (linkHover.value?.id !== node?.id || linkHover.value?.side !== side) linkHover.value = node ? { id: node.id, side } : null
  if (!shift) linkHint.value = linkHintSeen = false
  else if (node && !linkHintSeen) {
    // The hint comes with the first three aims ever, once per press of Shift.
    linkHintSeen = true
    if (linkHintsLeft <= 0) return
    linkHintsLeft -= 1
    linkHint.value = true
    try {
      localStorage.setItem(LINK_HINT_KEY, String(3 - linkHintsLeft))
    } catch {
      // Not counted — the hint may show again.
    }
  }
}

function onCanvasPointerMove(event) {
  pointerAt = !event.buttons && event.target.closest?.('.vue-flow') ? { x: event.clientX, y: event.clientY } : null
  aimLink(hasLinkMod(event))
}

function onCanvasPointerLeave() {
  pointerAt = null
  aimLink(false)
}

const onLinkModifierKeyup = (event) => aimLink(hasLinkMod(event))
const clearLinkModifier = () => aimLink(false)

function onCanvasPointerDown(event) {
  if (event.button || !hasLinkMod(event) || !linkHover.value || event.target.closest?.('.node-actions')) return
  // Cancelled, the press starts neither a node drag nor a selection box. The click that follows a press
  // without a drag still reaches the block, so Shift + click selects as before.
  event.preventDefault()
  event.stopPropagation()
  dragLink(event, linkHover.value.id, 'to')
}

// One gesture draws a new link and re-attaches an end of the selected one: `fixedId` stays put, `end` follows the pointer.
// Shift may be let go once the drag has started.
function dragLink(event, fixedId, end, link = null) {
  if (event.button) return
  document.activeElement?.blur?.()
  let pointer = event
  let moved = false
  let cancelled = false
  let frame = 0
  const track = () => {
    const point = screenToFlowCoordinate({ x: pointer.clientX, y: pointer.clientY })
    const node = linkNodeAt(point, 8)
    const allowed = node && canLink(links.value, ...(end === 'to' ? [fixedId, node.id] : [node.id, fixedId]), link?.id)
    linkDrag.value = { fixedId, end, linkId: link?.id, point, targetId: allowed ? node.id : null, denied: Boolean(node && !allowed) }
  }
  // Near an edge of the canvas the map scrolls under the pointer, as it does under a dragged node.
  const pan = () => {
    const bounds = canvasElement.value.getBoundingClientRect()
    const pull = (at, size) => Math.max(-1, Math.min(1, (Math.max(0, 40 - at) - Math.max(0, at - size + 40)) / 40)) * 15
    const dx = pull(pointer.clientX - bounds.left, bounds.width)
    const dy = pull(pointer.clientY - bounds.top, bounds.height)
    if (dx || dy) {
      setViewport({ x: viewport.value.x + dx, y: viewport.value.y + dy, zoom: viewport.value.zoom })
      track()
    }
    frame = requestAnimationFrame(pan)
  }
  const move = (at) => {
    pointer = at
    // A click with a little jitter draws nothing.
    if (cancelled || (!moved && Math.hypot(at.clientX - event.clientX, at.clientY - event.clientY) < 4)) return
    if (!moved) {
      moved = true
      linkHover.value = null
      linkHint.value = false
      frame = requestAnimationFrame(pan)
    }
    track()
  }
  const stop = (released) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    cancelAnimationFrame(frame)
    cancelLinkDrag = null
    const targetId = linkDrag.value?.targetId
    linkDrag.value = null
    if (!moved) return
    // The click that ends the gesture must not reach the canvas, where it would deselect the new link.
    const swallow = (click) => click.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true))
    if (released.type !== 'pointerup' || !targetId) return
    const before = snapshot()
    if (link) link[end] = targetId
    else {
      links.value.push({ id: documentId(), from: fixedId, to: targetId })
      selectLink(links.value.at(-1).id)
    }
    record(before)
  }
  // Esc drops the link at once; the listeners stay until release to swallow its click.
  cancelLinkDrag = () => {
    cancelled = true
    cancelAnimationFrame(frame)
    linkDrag.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function selectLink(id) {
  clearSelection()
  for (const edge of edges.value) edge.selected = false
  selectedMarkId.value = null
  selectedLinkId.value = id
}

// Every change to a link is its own undo step. The default arrow and an empty label are not stored.
function updateLink(link, patch) {
  const before = snapshot()
  Object.assign(link, patch)
  if (!link.label) delete link.label
  if (link.arrows === 'end') delete link.arrows
  record(before)
  contextMenu.value = null
}

function removeLink() {
  const before = snapshot()
  links.value = links.value.filter((link) => link.id !== selectedLinkId.value)
  selectedLinkId.value = null
  record(before)
  contextMenu.value = null
}

// A link goes when either of its blocks does, in the same undo step.
function pruneLinks() {
  links.value = links.value.filter((link) => nodesById.value.has(link.from) && nodesById.value.has(link.to))
}

function editLinkLabel() {
  if (linkDraft.value || !selectedDrawn.value) return
  linkDraft.value = { id: selectedLinkId.value, text: selectedLink.value.label ?? '' }
  nextTick(() => document.querySelector('.link-chip input')?.select())
}

function finishLinkLabel(save = true) {
  const draft = linkDraft.value
  linkDraft.value = null
  const link = draft && links.value.find((item) => item.id === draft.id)
  if (link && save) updateLink(link, { label: draft.text.trim().slice(0, MAX_LINK_LABEL) })
}

// Letting go of the link keeps the label typed so far.
watch(selectedLinkId, () => finishLinkLabel())

// The panel field writes the label as it is typed; the link is remembered because the selection may move on before the blur.
function beginLinkPanelEdit() {
  beginPanelEdit()
  panelLink = selectedLink.value
}

function endLinkPanelEdit() {
  const label = panelLink?.label?.trim()
  if (label) panelLink.label = label
  else if (panelLink) delete panelLink.label
  panelLink = null
  endPanelEdit()
}

function showLinkMenu(event, id) {
  selectLink(id)
  contextMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 230),
    y: Math.min(event.clientY, window.innerHeight - 170),
    link: id,
  }
}

function revealLinkEnd(id) {
  const node = visibleEnd(id)
  if (!node) return
  selectOnly(node.id)
  nextTick(() => ensureNodeVisible(node.id))
}

function persistDocuments(showState = true) {
  const current = activeDocument.value
  if (current) {
    current.map = cleanMap()
    if (dirty || !current.updatedAt) current.updatedAt = Date.now()
    noteBackupEdit(current)
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

// A linked map was edited if its content differs from what this session last saw. The first look at a map only
// takes the mark — unless the caller made the edit itself. The flag is saved with the map, so an edit that
// did not reach Drive before a reload is not forgotten.
function noteBackupEdit(document, certain = false) {
  const backup = document.googleDriveBackup
  if (!backup) return
  const key = backupKey(document.map)
  const seen = backupKeys.get(document.id)
  backupKeys.set(document.id, key)
  if (seen === key || (seen === undefined && !certain)) return
  backup.pending = true
  if (backup.state === 'linked') enqueueBackup(document.id)
}

const backupQueue = createBackupQueue(runBackup)

function enqueueBackup(id, immediate = false) {
  if (!DRIVE_ENABLED) return
  if (immediate) backupQueue.now(id)
  else backupQueue.schedule(id)
  // “Saving…” only for a job still going after 600 ms, so a quick upload does not blink, and never over a state that says more.
  setTimeout(() => {
    if (backupQueue.busy(id) && !driveStatus[id]) driveStatus[id] = { status: 'saving' }
  }, 600)
}

function setDriveStatus(id, status, extra = {}) {
  if (status) driveStatus[id] = { status, ...extra }
  else delete driveStatus[id]
}

// The active map is uploaded as it is on the canvas right now, any other as it was saved.
const backupMapOf = (document) => (document.id === activeId.value ? cleanMap() : document.map)

// One upload of one map, started by the queue. Nothing here may throw or touch the local save.
async function runBackup(id) {
  const target = documentById(id)
  const backup = target?.googleDriveBackup
  if (!DRIVE_ENABLED || backup?.state !== 'linked') {
    if (driveStatus[id]?.status === 'saving') setDriveStatus(id, null)
    return
  }
  const map = backupMapOf(target)
  const sentKey = backupKey(map)
  let result
  try {
    result = drive.hasToken()
      ? await pushBackup(drive, backup, { blob: await createMindmapFile(map, loadImageAsset) })
      : { outcome: 'auth' }
  } catch (error) {
    result = { outcome: errorKind(error) }
  }
  // The map was linked to another file, or unlinked, while this upload was on its way.
  if (target.googleDriveBackup?.fileId !== backup.fileId) return
  applyBackupResult(target, result, sentKey)
}

function applyBackupResult(target, { outcome, backup }, sentKey) {
  const id = target.id
  const before = driveKeyOf(target)
  const missing = driveStatus[id]?.missing ? { missing: true } : {}
  if (outcome === 'saved') {
    // An edit made during the upload is still on its way.
    target.googleDriveBackup = backupKey(backupMapOf(target)) === sentKey ? backup : { ...backup, pending: true }
    setDriveStatus(id, null)
  } else if (outcome === 'conflict') {
    target.googleDriveBackup.state = 'conflict'
    setDriveStatus(id, null)
  } else if (outcome === 'trashed' || (outcome === 'missing' && missing.missing)) {
    unlinkBackup(target)
  } else if (outcome === 'missing') {
    // Maybe just another Google account: ask to sign in once more before letting the link go.
    drive.forgetToken()
    setDriveStatus(id, 'auth', { missing: true })
  } else if (outcome === 'auth') setDriveStatus(id, 'auth', missing)
  else if (outcome === 'readonly' || outcome === 'offline') setDriveStatus(id, outcome)
  else setDriveStatus(id, 'failed', outcome === 'quota' ? { reason: 'quota' } : {})
  persistDocuments(false)
  // Toasts only when the state changes, not on every failed attempt. A lost network or a failed upload gets none.
  const after = driveKeyOf(target)
  if (after === before) return
  dropToastAbout(id)
  const name = documentTitle(target)
  if (after === 'off') notify(`The file for “${name}” was removed from Google Drive. The map is still on this device`, { dot: 'idle', about: id })
  else if (after === 'conflict') {
    notify(`“${name}” was changed elsewhere — saving to Drive stopped`, { dot: 'warn', about: id, action: { label: 'Details', run: () => showStorage(id) } })
  } else if (after === 'auth') {
    notify('Sign in to Google again — the copy is paused', { dot: 'warn', about: id, action: { label: 'Sign in', run: () => signInToDrive(id) } })
  }
}

// The Drive file is gone. The map stays, and can be connected again.
function unlinkBackup(target) {
  delete target.googleDriveBackup
  backupKeys.delete(target.id)
  setDriveStatus(target.id, null)
}

// The Storage block speaks for the open map only.
function showStorage(id) {
  if (id !== activeId.value && documentById(id)) switchDocument(id, { keepMenu: true })
  if (!documentsOpen.value) toggleDocuments()
}

// A file that was not found is looked up under the account the user picks now; a second miss lets the link go.
function signInToDrive(id) {
  rowMenu.value = null
  return driveAction('signin', async () => {
    const missing = Boolean(driveStatus[id]?.missing)
    if (missing || !drive.hasToken()) await drive.signIn({ chooseAccount: missing })
    resumeBackups()
  })
}

// Signed in: everything that waited for it goes out now.
function resumeBackups() {
  for (const target of documents.value) {
    const backup = target.googleDriveBackup
    const status = driveStatus[target.id]
    if (backup?.state !== 'linked' || (status?.status !== 'auth' && !backup.pending)) continue
    if (status?.status === 'auth') {
      setDriveStatus(target.id, 'saving', status.missing ? { missing: true } : {})
      dropToastAbout(target.id)
    }
    enqueueBackup(target.id, true)
  }
}

// The network is back, or the user is: whatever waited for a connection tries again.
function retryOfflineBackups() {
  for (const [id, status] of Object.entries(driveStatus)) if (status.status === 'offline') enqueueBackup(id, true)
}

function linkBackup(id, backup, map) {
  const target = documentById(id)
  if (!target) return
  target.googleDriveBackup = backup
  backupKeys.set(id, backupKey(map))
  setDriveStatus(id, null)
  // If the map changed while the file was being written, this save notices and queues the next upload.
  persistDocuments(false)
  notify(`“${documentTitle(target)}” now saves to Google Drive`, {
    dot: 'ok',
    about: id,
    action: { label: 'Open', run: () => window.open(driveFileUrl(backup.fileId), '_blank', 'noopener') },
  })
}

// Where the focus goes when a Drive dialog closes: the control its flow started from.
let driveDialogReturn = null

// A Drive action started by the user, one at a time. A closed sign-in window or picker is not an error.
async function driveAction(name, work) {
  if (driveBusy.value) return
  // The control the flow started from is remembered now: once disabled, it drops the focus.
  const origin = document.activeElement
  if (!driveDialog.value) driveDialogReturn = origin
  driveBusy.value = name
  try {
    await work()
  } catch (error) {
    const kind = errorKind(error)
    if (kind !== 'cancelled') notify(DRIVE_MESSAGES[kind] ?? DRIVE_MESSAGES.failed)
  } finally {
    driveBusy.value = ''
    nextTick(() => {
      const box = driveDialogBox.value
      if (box) {
        if (!box.contains(document.activeElement)) box.querySelector('[data-autofocus]')?.focus()
      } else if (document.activeElement === document.body && origin instanceof HTMLElement && origin.isConnected) origin.focus()
    })
  }
}

async function ensureSignedIn(options) {
  if (drive.hasToken()) return
  await drive.signIn(options)
  resumeBackups()
}

function openDriveDialog(dialog) {
  if (!driveDialog.value && !driveBusy.value) driveDialogReturn = document.activeElement
  rowMenu.value = null
  driveDialog.value = dialog
  nextTick(() => driveDialogBox.value?.querySelector('[data-autofocus]')?.focus())
}

function openConnect(id) {
  // Google's scripts are fetched now, so the sign-in window opens straight from the click.
  drive.preload().catch(() => {})
  openDriveDialog({ kind: 'connect', id })
}

const askReplace = (id, file) => openDriveDialog({ kind: 'replace', id, file })

function dismissDriveDialog() {
  const dialog = driveDialog.value
  if (!dialog) return
  driveDialog.value = null
  const target = driveDialogReturn
  driveDialogReturn = null
  nextTick(() => (target instanceof HTMLElement && target.isConnected ? target.focus() : focusDocumentRow(dialog.id)))
}

// Cancel, Esc and the backdrop. Not while a file is being written.
function closeDriveDialog() {
  if (!driveBusy.value) dismissDriveDialog()
}

function onDriveDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDriveDialog()
  } else trapFocus(event, driveDialogBox.value)
}

// A new file in the Mindspace folder: from the connect dialog, or as the way out of a stopped backup.
function saveToNewFile(id) {
  return driveAction('create', async () => {
    await ensureSignedIn()
    const target = documentById(id)
    if (!target) return dismissDriveDialog()
    const map = backupMapOf(target)
    const backup = await createBackup(drive, { title: map.title, blob: await createMindmapFile(map, loadImageAsset) })
    dismissDriveDialog()
    linkBackup(id, backup, map)
  })
}

// Writing into an existing file always goes through the confirmation.
function chooseDriveFile(id) {
  rowMenu.value = null
  return driveAction('pick', async () => {
    await ensureSignedIn()
    const file = await drive.pickFile()
    if (!file) return
    const other = linkedDocument(documents.value, file.id, id)
    if (other) notify(`That file is already connected to “${documentTitle(other)}”`)
    else askReplace(id, file)
  })
}

function confirmReplace() {
  const { id, file } = driveDialog.value
  return driveAction('replace', async () => {
    await ensureSignedIn()
    const target = documentById(id)
    if (!target) return dismissDriveDialog()
    const map = backupMapOf(target)
    const result = await replaceBackup(drive, file.id, { blob: await createMindmapFile(map, loadImageAsset) })
    dismissDriveDialog()
    if (result.outcome === 'saved') linkBackup(id, result.backup, map)
    else notify(DRIVE_MESSAGES[{ readonly: 'readonly', trashed: 'missing' }[result.outcome] ?? 'failed'])
  })
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
  const width = 236
  const fitsRight = rect.right + 4 + width <= window.innerWidth - 8
  rowMenu.value = {
    id,
    left: fitsRight ? rect.right + 4 : rect.left - 4 - width,
    top: Math.min(rect.top, window.innerHeight - 190),
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
    noteBackupEdit(target, true)
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
  const map = cleanMap()
  if (format === 'opml' || format === 'markdown') {
    const markdown = format === 'markdown'
    const name = markdown ? 'Markdown' : 'OPML'
    download(new Blob([markdown ? toMarkdown(map) : toOpml(map)], { type: markdown ? 'text/markdown' : 'text/x-opml' }), markdown ? 'md' : 'opml')
    notify(referencedAssetIds(map).size ? `${name} saved — images were exported as text only` : `${name} saved`)
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
    } else if (imported.kind === 'opml') map = parseOpml(imported.text)
    else if (imported.kind === 'markdown') map = parseMarkdown(imported.text, file.name.replace(/\.(?:md|markdown)$/i, ''))
    else map = normalizeMap(JSON.parse(imported.text))
    if (!addDocument(map)) throw new Error('The map could not be saved on this device.')
    importedAssetIds = []
    notify(`Added: ${file.name}`)
  } catch (error) {
    if (importedAssetIds.length) await deleteImageAssets(importedAssetIds).catch(() => {})
    notify(error instanceof Error ? error.message : 'Could not open the file')
  }
}

const appMenuItems = () => [...(appMenu.value?.querySelectorAll('[role^="menuitem"]') ?? [])]

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

function onHelpKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeHelp()
  } else trapFocus(event, helpDialog.value)
}

// Focus stays inside the dialog: Tab from the last element goes to the first, Shift+Tab from the first to the last.
function trapFocus(event, dialog) {
  if (event.key !== 'Tab') return
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
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

function runShortcut(id, event) {
  switch (id) {
    case 'undo': return undo()
    case 'redo': return redo()
    case 'addChild': return addChild()
    case 'addSibling': return selectedLink.value ? editLinkLabel() : addSibling()
    case 'navigate': return navigateNodes(event.key)
    case 'remove': return selectedMark.value ? removeFreeMark() : selectedLink.value ? removeLink() : removeSelected()
    case 'marks': return toggleMarks()
    case 'mark': return applyMark(MARKS.find((mark) => mark.key === event.key).id)
    case 'duplicateMark': return duplicateFreeMark()
    case 'collapse':
    case 'expand': return setCollapsed(selectedNodes.value.map((node) => node.id), id === 'collapse')
    case 'help': return openHelp(event.target)
    case 'theme': return cycleTheme()
    case 'selectAll': return selectAllCanvasNodes(nodes.value)
    case 'deselect':
      contextMenu.value = null
      closeMenus()
      for (const node of nodes.value) node.selected = false
      selectedMarkId.value = selectedLinkId.value = null
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && linkDrag.value) {
    event.preventDefault()
    event.stopPropagation()
    cancelLinkDrag()
    return
  }
  if (driveDialog.value) {
    // The dialog owns the keyboard, wherever the focus is: nothing reaches the map or the menu behind it.
    event.stopPropagation()
    onDriveDialogKeydown(event)
    return
  }
  if (!event.repeat) aimLink(hasLinkMod(event) && !isEditableClipboardTarget(event.target))
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
  if (event.key === 'Escape' && marksOpen.value) {
    // Only the set closes: Vue Flow must not see the key and deselect the focused node.
    event.preventDefault()
    event.stopPropagation()
    marksOpen.value = false
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
  // Keys inside the menu must not edit the map on the canvas; the icon set still takes its own keys.
  if (event.key !== 'Escape' && target instanceof Element && target.closest('.island, .island-menu, .row-menu, .app-menu, .undo-toast')
    && !(target.closest('.mark-wrap') && (shortcut?.id === 'marks' || shortcut?.id === 'mark'))) return
  // Without a selected mark Cmd+D stays with the browser.
  if (shortcut?.id === 'duplicateMark' && !selectedMark.value) return
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

// The Drive state of the open map is read out when it changes. “Saving…” is not, and neither is the “saved” that follows it.
let announcedDrive = activeDrive.value.key
watch(() => activeDrive.value.key, (key) => {
  if (key === 'saving' || key === announcedDrive) return
  announcedDrive = key
  announcement.value = BACKUP_VIEW[key]?.say ?? ''
})

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

// Vue Flow adds large internal handle geometry to every node; watch only fields that are actually saved.
watch(snapshot, () => {
  dirty = true
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    persistDocuments()
  }, 250)
})

onMounted(() => {
  applyVisibility()
  persistDocuments()
  hydrateImageUrls()
  const usedAssets = new Set()
  for (const document of documents.value) {
    for (const assetId of referencedAssetIds(document.map)) usedAssets.add(assetId)
  }
  pruneImageAssets(usedAssets).catch(() => {})
  // Someone who already keeps a map in Drive gets Google's scripts ahead of the first sign-in click.
  if (DRIVE_ENABLED && documents.value.some((document) => document.googleDriveBackup)) drive.preload().catch(() => {})
  // An edit that did not reach Drive before the page was closed: nothing can be sent without signing in, so say so — quietly.
  if (DRIVE_ENABLED) {
    for (const { id, googleDriveBackup: backup } of documents.value) if (backup?.pending && backup.state === 'linked') setDriveStatus(id, 'auth')
  }
  window.addEventListener('focus', retryOfflineBackups)
  window.addEventListener('online', retryOfflineBackups)
  // Capture keyboard navigation before Vue Flow can move the selected node.
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('keyup', onLinkModifierKeyup)
  window.addEventListener('blur', clearLinkModifier)
  window.addEventListener('pointerdown', onWindowPointerDown)
  window.addEventListener('copy', onCopy)
  window.addEventListener('paste', onPaste)
  window.addEventListener('pagehide', persistDocuments)
  window.addEventListener('resize', placeSearch)
  darkQuery.addEventListener('change', onSystemTheme)
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
  window.removeEventListener('keyup', onLinkModifierKeyup)
  window.removeEventListener('blur', clearLinkModifier)
  window.removeEventListener('focus', retryOfflineBackups)
  window.removeEventListener('online', retryOfflineBackups)
  window.removeEventListener('pointerdown', onWindowPointerDown)
  window.removeEventListener('copy', onCopy)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('pagehide', persistDocuments)
  window.removeEventListener('resize', placeSearch)
  darkQuery.removeEventListener('change', onSystemTheme)
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
      <section ref="canvasElement" class="canvas-wrap" :class="{ 'link-aim': linkHover, linking: linkDrag, 'link-denied': linkDrag?.denied, searching: searchMatches.length }" @wheel.capture="onCanvasWheel" @pointerdown.capture="onCanvasPointerDown" @pointermove="onCanvasPointerMove" @pointerleave="onCanvasPointerLeave" @dragover.prevent @drop.prevent="onImageDrop">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          class="mind-flow"
          :default-edge-options="defaultEdgeOptions"
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
          :node-drag-threshold="4"
          @nodes-change="onNodesChange"
          @nodes-initialized="onNodesInitialized"
          @node-drag-start="onNodeDragStart"
          @node-drag="onNodeDrag"
          @node-drag-stop="onNodeDragStop"
          @node-double-click="({ node }) => focusEditor(node.id)"
          @node-context-menu="showNodeMenu"
          @edge-click="selectedMarkId = selectedLinkId = null"
          @pane-click="closeOverlays"
        >
          <template #zoom-pane>
            <svg class="link-layer">
              <rect v-if="linkAim" class="link-frame" v-bind="linkAim.frame" rx="8" />
              <rect v-if="linkPreview?.frame" class="link-frame target" v-bind="linkPreview.frame" rx="8" />
              <g
                v-for="item in drawnLinks"
                :key="item.link.id"
                class="map-link nopan"
                :class="{ selected: item.link.id === selectedLinkId, ghost: item.ghost }"
                @pointerdown="selectLink(item.link.id)"
                @contextmenu.prevent.stop="showLinkMenu($event, item.link.id)"
              >
                <path class="link-hit" :d="item.d" />
                <path class="link-line" :d="item.d" />
                <template v-if="item.link.id !== selectedLinkId">
                  <path v-for="arrow in item.arrows" :key="arrow" class="link-arrow" :d="arrow" />
                </template>
              </g>
            </svg>
            <template v-for="item in drawnLinks" :key="item.link.id">
              <div
                v-if="item.link.label || item.link.id === selectedLinkId"
                class="link-chip nopan"
                :class="{ selected: item.link.id === selectedLinkId, empty: !item.link.label, ghost: item.ghost }"
                :style="{ left: `${item.middle.x}px`, top: `${item.middle.y}px` }"
                @click="item.link.id === selectedLinkId ? editLinkLabel() : selectLink(item.link.id)"
                @contextmenu.prevent.stop="showLinkMenu($event, item.link.id)"
              >
                <input
                  v-if="linkDraft?.id === item.link.id"
                  v-model="linkDraft.text"
                  name="link-label"
                  aria-label="Link label"
                  placeholder="Label"
                  :maxlength="MAX_LINK_LABEL"
                  @keydown.enter.prevent="finishLinkLabel()"
                  @keydown.esc.prevent="finishLinkLabel(false)"
                  @blur="finishLinkLabel()"
                />
                <template v-else>{{ item.link.label || '+ Label' }}</template>
              </div>
            </template>
            <div
              v-for="mark in freeMarks"
              :key="mark.id"
              class="free-mark nopan"
              :style="{ left: `${mark.x}px`, top: `${mark.y}px`, width: `${mark.size}px`, height: `${mark.size}px` }"
              @pointerdown="onMarkPointerDown($event, mark)"
            ><MarkIcon :id="mark.mark" :size="mark.size" /></div>
          </template>

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
              :style="{ '--branch': paint(data.color) }"
              :aria-current="selected ? 'true' : undefined"
              :aria-label="data.label || data.image?.name"
              tabindex="-1"
            >
              <Handle id="target-left" type="target" :position="Position.Left" class="node-handle target-handle" :connectable="false" />
              <Handle id="source-left" type="source" :position="Position.Left" class="node-handle source-handle" :connectable="false" />
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
                @dblclick.stop
                @focusout="onEditorFocusOut"
              >
                <div class="node-head">
                  <MarkIcon v-for="mark in data.marks" :id="mark" :key="mark" />
                  <textarea
                    v-model="editDraft.label"
                    :data-editor="id"
                    class="node-title"
                    name="node-text"
                    rows="1"
                    :maxlength="MAX_LABEL_LENGTH"
                    aria-label="Node title"
                    @keydown.enter.exact.prevent="finishEditing()"
                    @keydown.shift.enter.prevent="focusNoteEditor(id)"
                    @keydown.tab.exact.prevent="focusNoteEditor(id)"
                    @keydown.esc.prevent="finishEditing(false)"
                  ></textarea>
                </div>
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
                <div v-if="data.label" class="node-head">
                  <MarkIcon v-for="mark in data.marks" :id="mark" :key="mark" :data-mark="mark" />
                  <span class="node-title"><component
                    :is="part.href ? 'a' : 'span'"
                    v-for="(part, index) in displayParts(id, blockPreview(data.label))"
                    :key="index"
                    :class="{ 'node-link': part.href, nodrag: part.href }"
                    :href="part.href"
                    :target="part.href ? '_blank' : undefined"
                    :rel="part.href ? 'noopener' : undefined"
                    :title="part.href ? `${keyLabel('Mod')}+click to open` : undefined"
                    @click="part.href && onTextLinkClick($event)"
                  ><template v-for="(match, matchIndex) in part.search" :key="matchIndex"><mark v-if="match.match">{{ match.text }}</mark><template v-else>{{ match.text }}</template></template></component></span>
                </div>
                <span v-if="data.note" class="node-note"><component
                  :is="part.href ? 'a' : 'span'"
                  v-for="(part, index) in displayParts(id, data.note)"
                  :key="index"
                  :class="{ 'node-link': part.href, nodrag: part.href }"
                  :href="part.href"
                  :target="part.href ? '_blank' : undefined"
                  :rel="part.href ? 'noopener' : undefined"
                  :title="part.href ? `${keyLabel('Mod')}+click to open` : undefined"
                  @click="part.href && onTextLinkClick($event)"
                ><template v-for="(match, matchIndex) in part.search" :key="matchIndex"><mark v-if="match.match">{{ match.text }}</mark><template v-else>{{ match.text }}</template></template></component></span>
              </template>
              <div
                v-if="!data.root || hasChildren(id)"
                class="node-actions nodrag nopan"
                @pointerdown.stop.prevent
                @click.stop
              >
                <button
                  v-if="hasChildren(id)"
                  class="node-action collapse-button"
                  :title="data.collapsed ? 'Expand branch' : 'Collapse branch'"
                  :aria-label="data.collapsed ? `Expand branch, ${hiddenCount(id)} hidden` : 'Collapse branch'"
                  @click="toggleCollapse(id)"
                >
                  <template v-if="data.collapsed">{{ hiddenCount(id) }}</template>
                  <svg v-else viewBox="0 0 10 10"><path d="M2 5h6"/></svg>
                </button>
                <button
                  v-if="!data.root"
                  class="node-action add-child-button"
                  title="Add child block"
                  aria-label="Add child block"
                  @click="addChild(id)"
                >+</button>
              </div>
              <Handle id="target-right" type="target" :position="Position.Right" class="node-handle target-handle" :connectable="false" />
              <Handle id="source-right" type="source" :position="Position.Right" class="node-handle source-handle" :connectable="false" />
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
            <!-- A failed local save must stay visible even on a map that is backed up. -->
            <span v-if="activeDrive.key === 'off' || saveState === 'error'" class="store-mark" role="img" :title="saveLabel" :aria-label="saveLabel">
              <i class="save-dot" :class="saveState"></i>
            </span>
            <span
              v-else
              class="store-mark"
              :class="[activeDrive.view.tone, { badge: activeDrive.view.badge }]"
              role="img"
              :title="activeDrive.view.label"
              :aria-label="activeDrive.view.label"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="CLOUD"/></svg>
              <i v-if="activeDrive.view.badge" class="store-badge"></i>
            </span>
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
          <div class="app-menu-item app-menu-theme" role="group" aria-label="Theme">
            <span>Theme</span>
            <div class="theme-switch">
              <button
                v-for="(label, key) in THEMES"
                :key="key"
                role="menuitemradio"
                tabindex="-1"
                :title="label"
                :aria-label="label"
                :aria-checked="theme === key"
                :class="{ active: theme === key }"
                @click="setTheme(key)"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <template v-if="key === 'system'"><rect x="2" y="2.75" width="12" height="8.5" rx="1.5" /><path d="M5.5 13.75h5M8 11.25v2.5" /></template>
                  <template v-else-if="key === 'light'"><circle cx="8" cy="8" r="2.75" /><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" /></template>
                  <path v-else d="M13.25 9.6A5.5 5.5 0 116.4 2.75a4.4 4.4 0 006.85 6.85z" />
                </svg>
              </button>
            </div>
          </div>
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
          <section class="storage" aria-label="Storage">
            <div class="storage-title">Storage</div>
            <div class="storage-row">
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="7.5" rx="1.2"/><path d="M1 13h14"/></svg>
              <span class="storage-name">On this device</span>
              <span class="storage-status">
                <i class="save-dot" :class="saveState"></i>{{ saveState === 'error' ? saveLabel : relativeTime(activeDocument?.updatedAt, now) }}
              </span>
            </div>
            <template v-if="DRIVE_ENABLED">
              <div class="storage-row drive">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="CLOUD"/></svg>
                <span class="storage-name">Google Drive</span>
                <button v-if="activeDrive.key === 'off'" class="storage-connect" @click="openConnect(activeId)">Connect</button>
                <span v-else class="storage-status" :class="activeDrive.view.tone">
                  <i class="save-dot"></i>{{ activeDrive.view.status ?? relativeTime(activeDrive.backup.savedAt, now) }}
                </span>
              </div>
              <div v-if="activeDrive.key === 'saving' || activeDrive.key === 'saved'" class="storage-file">
                <span>{{ driveFileLabel(activeDrive.backup) }}</span>
                <a :href="driveFileUrl(activeDrive.backup.fileId)" target="_blank" rel="noopener" title="Open in Google Drive">Open ↗</a>
              </div>
              <div v-if="activeDrive.note" class="storage-note">
                <span>{{ activeDrive.note }}</span>
                <button v-if="activeDrive.key === 'failed'" @click="enqueueBackup(activeId, true)">Retry</button>
              </div>
              <div v-if="activeDrive.view?.alert" class="drive-alert" role="status">
                <p><b>{{ activeDrive.view.alert.title }}</b> {{ activeDrive.view.alert.text.replace('{name}', activeDrive.backup.name) }}</p>
                <div class="drive-alert-actions">
                  <button v-if="activeDrive.key === 'auth'" class="primary" :disabled="Boolean(driveBusy)" @click="signInToDrive(activeId)">Sign in to Google</button>
                  <template v-else>
                    <button class="primary" :disabled="Boolean(driveBusy)" @click="saveToNewFile(activeId)">Save to a new file</button>
                    <button
                      v-if="activeDrive.key === 'conflict'"
                      :disabled="Boolean(driveBusy)"
                      @click="askReplace(activeId, { id: activeDrive.backup.fileId, name: activeDrive.backup.name })"
                    >Replace file in Drive</button>
                  </template>
                </div>
                <button v-if="activeDrive.key !== 'auth'" class="drive-alert-link" :disabled="Boolean(driveBusy)" @click="chooseDriveFile(activeId)">Choose another file in Google Drive…</button>
              </div>
            </template>
          </section>
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
              <span
                v-if="item.cloud"
                class="doc-cloud"
                :class="item.cloud"
                role="img"
                :title="item.cloud === 'warn' ? 'Backup stopped' : 'Saves to Google Drive'"
                :aria-label="item.cloud === 'warn' ? 'Backup stopped' : 'Saves to Google Drive'"
              ><svg viewBox="0 0 16 16" aria-hidden="true"><path :d="CLOUD"/></svg></span>
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
            <template v-if="rowMenuDrive">
              <hr />
              <button role="menuitem" @click="rowMenuDrive.run()">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="CLOUD"/></svg><span>{{ rowMenuDrive.label }}</span>
              </button>
            </template>
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
            <div ref="marksWrap" class="mark-wrap">
              <button
                class="island-icon mark-toggle"
                :class="{ active: marksOpen }"
                :aria-expanded="marksOpen"
                :title="`Icons · ${keysLabel('marks')}`"
                aria-label="Icons"
                @click="toggleMarks"
              >
                <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M5.6 9.5a2.8 2.8 0 004.8 0M6 6.5h.01M10 6.5h.01"/></svg>
              </button>
              <Transition name="marks">
                <div v-if="marksOpen" class="mark-popover" role="dialog" aria-label="Icons" :style="{ right: `${marksShift}px` }">
                  <header>
                    <strong>Icons</strong>
                    <span>{{ markTarget }}</span>
                  </header>
                  <div class="mark-grid" @keydown="onMarkGridKeydown" @mouseleave="hoveredMark = null">
                    <button
                      v-for="mark in MARKS"
                      :key="mark.id"
                      :class="{ active: markActive(mark.id) }"
                      :aria-pressed="markActive(mark.id)"
                      :title="`${mark.name} · ${mark.key}`"
                      @click="applyMark(mark.id)"
                      @mouseenter="hoveredMark = mark"
                      @focus="hoveredMark = mark"
                      @blur="hoveredMark = null"
                    ><MarkIcon :id="mark.id" :size="24" /></button>
                  </div>
                  <hr />
                  <footer :class="{ idle: !hoveredMark }">
                    <span>{{ hoveredMark ? `${hoveredMark.name} — ${hoveredMark.hint}` : 'Keys 1–0 add and remove' }}</span>
                    <kbd>{{ hoveredMark?.key ?? '1' }}</kbd>
                  </footer>
                </div>
              </Transition>
            </div>
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
                <button class="menu-item" role="menuitem" @click="exportMap('markdown')">Markdown outline<small>.md</small></button>
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
        <input ref="fileInput" class="visually-hidden" name="map-file" aria-label="Open map file" type="file" accept=".mindmap,.json,.opml,.md,.markdown,application/json,text/xml,text/markdown" @change="loadFile" />

        <div v-if="markFrame" class="mark-frame" :style="markFrame">
          <span class="mark-size">{{ selectedMark.size }} px</span>
          <i
            v-for="[sx, sy] in MARK_CORNERS"
            :key="`${sx}${sy}`"
            class="mark-handle"
            :style="{ left: sx < 0 ? 0 : '100%', top: sy < 0 ? 0 : '100%', cursor: sx === sy ? 'nwse-resize' : 'nesw-resize' }"
            @pointerdown.prevent="onMarkHandleDown($event, sx, sy)"
          ></i>
        </div>

        <svg v-if="alignmentGuides.length || dragPreview?.mode === 'attach'" class="drag-preview" aria-hidden="true">
          <g :transform="`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`">
            <path
              v-for="path in dragPreview?.mode === 'attach' ? dragPreview.paths : []"
              :key="path.id"
              :d="path.path"
              :style="{ stroke: paint(path.color) }"
            />
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

        <svg v-if="linkAim || linkPreview || selectedDrawn" class="link-overlay" aria-hidden="true">
          <g :transform="`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`">
            <template v-if="linkPreview">
              <path class="link-preview" :d="linkPreview.d" />
              <template v-if="linkPreview.snap">
                <circle class="link-halo" :cx="linkPreview.snap.x" :cy="linkPreview.snap.y" r="10" />
                <circle class="link-dot solid" :cx="linkPreview.snap.x" :cy="linkPreview.snap.y" r="5" />
                <circle class="link-dot solid" :cx="linkPreview.origin.x" :cy="linkPreview.origin.y" r="4" />
              </template>
            </template>
            <template v-else>
              <g
                v-for="end in selectedDrawn ? ['from', 'to'] : []"
                :key="end"
                class="link-end"
                :transform="`translate(${selectedDrawn.ends[end].x} ${selectedDrawn.ends[end].y})`"
                @pointerdown.stop.prevent="dragLink($event, selectedDrawn.link[end === 'from' ? 'to' : 'from'], end, selectedDrawn.link)"
              >
                <circle r="10" />
                <circle class="link-dot" r="4" />
              </g>
              <circle v-if="linkAim" :key="linkHover.side" class="link-dot aim" :cx="linkAim.dot.x" :cy="linkAim.dot.y" r="5" />
            </template>
          </g>
        </svg>

        <div v-if="linkHint" class="link-hint"><kbd>{{ keyLabel('Shift') }}</kbd>drag from the edge to link</div>

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
            <span>{{ inspectorMode === 'map' ? 'Map' : inspectorMode === 'multi' ? 'Selection' : inspectorMode === 'link' ? 'Link' : nodePath }}</span>
            <strong>{{ inspectorMode === 'map' ? title : inspectorMode === 'multi' ? pluralNodes(selectedCount) : inspectorMode === 'link' ? selectedLink.label || 'No label' : primaryNode.data.label || primaryNode.data.image?.name }}</strong>
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
                :maxlength="MAX_LABEL_LENGTH"
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
                  :style="{ '--swatch': paint(color) }"
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
                  :style="{ '--swatch': paint(color) }"
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

          <template v-else-if="inspectorMode === 'link'">
            <section class="panel-section">
              <h3>Link</h3>
              <div class="link-route">
                <button title="Show this block" @click="revealLinkEnd(selectedLink.from)">{{ nodeLabel(nodesById.get(selectedLink.from)) }}</button>
                <span aria-hidden="true">{{ linkGlyph }}</span>
                <button title="Show this block" @click="revealLinkEnd(selectedLink.to)">{{ nodeLabel(nodesById.get(selectedLink.to)) }}</button>
              </div>
              <input
                class="panel-input note-input"
                :value="selectedLink.label ?? ''"
                name="panel-link-label"
                aria-label="Link label"
                placeholder="Label"
                :maxlength="MAX_LINK_LABEL"
                @focus="beginLinkPanelEdit"
                @input="selectedLink.label = $event.target.value"
                @blur="endLinkPanelEdit"
                @keydown="onPanelKeydown"
              />
              <div class="segmented" role="radiogroup" aria-label="Arrows">
                <button v-for="[value, glyph, name] in ARROW_OPTIONS" :key="value" role="radio" :aria-checked="(selectedLink.arrows ?? 'end') === value" :aria-label="name" :title="name" :class="{ active: (selectedLink.arrows ?? 'end') === value }" @click="updateLink(selectedLink, { arrows: value })">{{ glyph }}</button>
              </div>
            </section>
            <section class="panel-actions">
              <button class="danger" @click="removeLink"><span>Delete link</span><kbd>{{ keysLabel('remove') }}</kbd></button>
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
                  <span class="palette-dots"><i v-for="color in palette.colors" :key="color" :style="{ background: paint(color) }"></i></span>
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

      <div v-if="contextMenu?.link && selectedLink" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
        <button :disabled="!canLink(links, selectedLink.to, selectedLink.from)" @click="updateLink(selectedLink, { from: selectedLink.to, to: selectedLink.from })"><span>⇄</span>Reverse</button>
        <button @click="updateLink(selectedLink, { arrows: selectedLink.arrows === 'none' ? 'end' : 'none' })"><span>{{ selectedLink.arrows === 'none' ? '✓' : '' }}</span>No arrow</button>
        <button @click="updateLink(selectedLink, { arrows: selectedLink.arrows === 'both' ? 'end' : 'both' })"><span>{{ selectedLink.arrows === 'both' ? '✓' : '' }}</span>Arrows on both ends</button>
        <hr />
        <button class="danger" @click="removeLink"><span>⌫</span>Delete link <kbd>{{ keysLabel('remove') }}</kbd></button>
      </div>
      <div v-else-if="contextMenu && !contextMenu.link" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
        <template v-if="contextMenu.mark">
          <button @click="removeNodeMark(contextMenu.id, contextMenu.mark)"><span>✕</span>Remove “{{ markName(contextMenu.mark) }}”</button>
          <hr />
        </template>
        <button @click="addChild(contextMenu.id)"><span>＋</span>Child node <kbd>{{ keysLabel('addChild') }}</kbd></button>
        <button @click="addSibling"><span>↳</span>Sibling node <kbd>{{ keysLabel('addSibling') }}</kbd></button>
        <button @click="focusEditor(contextMenu.id); contextMenu = null"><span>✎</span>{{ imageOnly(nodes.find((node) => node.id === contextMenu.id)) ? 'Preview' : 'Edit' }}</button>
        <button v-if="hasChildren(contextMenu.id)" @click="toggleCollapse(contextMenu.id); contextMenu = null"><span>⌁</span>Collapse / expand</button>
        <hr />
        <button class="danger" :disabled="nodes.find((node) => node.id === contextMenu.id)?.data.root && rootCount === 1" @click="removeSelected"><span>⌫</span>Delete branch</button>
      </div>

      <div class="visually-hidden" aria-live="polite">{{ announcement }}</div>

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
        <div
          v-else-if="toast"
          class="toast"
          :class="{ 'undo-toast': toastTip }"
          role="status"
          @mouseenter="pauseToast"
          @mouseleave="resumeToast"
          @click.stop
        >
          <i v-if="toastDot" class="toast-dot" :class="toastDot"></i>
          <span>{{ toast }}</span>
          <button v-if="toastAction" @click="runToastAction">{{ toastAction.label }}</button>
        </div>
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

      <!-- Not a native <dialog>: Google's picker opens over the page and has to stay reachable above this one. -->
      <Transition name="help">
        <div v-if="driveDialog" class="help-backdrop" @click.stop="closeDriveDialog">
          <div
            ref="driveDialogBox"
            class="help-dialog drive-dialog"
            :class="driveDialog.kind"
            :role="driveDialog.kind === 'replace' ? 'alertdialog' : 'dialog'"
            aria-modal="true"
            aria-labelledby="drive-dialog-title"
            aria-describedby="drive-dialog-text"
            @click.stop
          >
            <template v-if="driveDialog.kind === 'connect'">
              <header>
                <h2 id="drive-dialog-title">Save “{{ driveDialogMap }}” to Google Drive</h2>
                <p id="drive-dialog-text">The copy updates itself a few seconds after each change. The map still lives on this device.</p>
              </header>
              <div class="drive-options">
                <button class="drive-option" data-autofocus :disabled="Boolean(driveBusy)" @click="saveToNewFile(driveDialog.id)">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2.5H5.5a1.5 1.5 0 00-1.5 1.5v12a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0016 16V7z"/><path d="M11.5 2.5V7H16M10 10v5M7.5 12.5h5"/></svg>
                  <span><strong>{{ driveBusy === 'create' ? 'Creating…' : 'New file' }}</strong><small>In the Mindspace folder in your Google Drive</small></span>
                </button>
                <button class="drive-option" :disabled="Boolean(driveBusy)" @click="chooseDriveFile(driveDialog.id)">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3.5l2 2H16a1.5 1.5 0 011.5 1.5v7.5A1.5 1.5 0 0116 16.5H4a1.5 1.5 0 01-1.5-1.5z"/></svg>
                  <span><strong>Existing file</strong><small>Choose a .mindmap in Google Drive — its content will be replaced</small></span>
                </button>
              </div>
              <footer><button class="drive-button text" :disabled="Boolean(driveBusy)" @click="closeDriveDialog">Cancel</button></footer>
            </template>
            <template v-else>
              <header>
                <h2 id="drive-dialog-title">Replace “{{ driveDialog.file.name }}”?</h2>
                <p id="drive-dialog-text">The file in Google Drive will become a copy of “{{ driveDialogMap }}” from this device. The previous content stays in Google Drive version history.</p>
              </header>
              <footer>
                <button class="drive-button" data-autofocus :disabled="Boolean(driveBusy)" @click="closeDriveDialog">Cancel</button>
                <button class="drive-button danger" :disabled="Boolean(driveBusy)" @click="confirmReplace">{{ driveBusy === 'replace' ? 'Replacing…' : 'Replace file' }}</button>
              </footer>
            </template>
          </div>
        </div>
      </Transition>
    </main>
  </div>
</template>
