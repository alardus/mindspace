import { Unzip, UnzipInflate, strFromU8, strToU8, zip } from 'fflate'
import { normalizeMap } from './model.js'
import { matchesImageMime } from './assets.js'

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_MAP_BYTES = 5 * 1024 * 1024
const MAX_IMAGES = 100
const MAX_TOTAL_IMAGE_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_BYTES = MAX_MAP_BYTES + MAX_TOTAL_IMAGE_BYTES + 1024 * 1024
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const assetPath = (image) => `images/${encodeURIComponent(image.assetId)}.${MIME_EXTENSIONS[image.mime]}`
const archiveError = () => new Error('The map archive is incomplete or corrupted.')
const imageFields = ['assetId', 'name', 'mime', 'naturalWidth', 'naturalHeight']
const sameImage = (a, b) => imageFields.every((field) => a?.[field] === b?.[field])

function imageReferences(map) {
  const references = new Map()
  for (const node of map.nodes) {
    const image = node.data.image
    if (!image) continue
    const existing = references.get(image.assetId)
    if (existing && !sameImage(existing, image)) throw archiveError()
    references.set(image.assetId, image)
  }
  return references
}

const zipFiles = (files) => new Promise((resolve, reject) => {
  zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data))
})

const joinChunks = (chunks, size) => {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

// Count streamed output instead of trusting attacker-controlled ZIP size headers.
const unzipFiles = (data) => new Promise((resolve, reject) => {
  const files = {}
  const names = new Set()
  let images = 0
  let imageBytes = 0
  let pending = 0
  let inputDone = false
  let settled = false
  const streams = []
  const fail = () => {
    if (settled) return
    settled = true
    streams.forEach((stream) => stream.terminate())
    reject(archiveError())
  }
  const finish = () => {
    if (!settled && inputDone && pending === 0) {
      settled = true
      resolve(files)
    }
  }
  const unzipper = new Unzip((file) => {
    if (settled) return
    const image = /^images\/[^/]+\.(png|jpg|webp|gif)$/.test(file.name)
    if (names.has(file.name) || (file.name !== 'map.json' && !image)) return fail()
    names.add(file.name)
    if (image && ++images > MAX_IMAGES) return fail()
    const limit = image ? MAX_IMAGE_BYTES : MAX_MAP_BYTES
    const chunks = []
    let size = 0
    pending += 1
    streams.push(file)
    file.ondata = (error, chunk, final) => {
      if (settled) return
      if (error) return fail()
      size += chunk.length
      if (image) imageBytes += chunk.length
      if (size > limit || imageBytes > MAX_TOTAL_IMAGE_BYTES) return fail()
      chunks.push(chunk.slice())
      if (!final) return
      if (file.originalSize !== undefined && file.originalSize !== size) return fail()
      files[file.name] = joinChunks(chunks, size)
      pending -= 1
      finish()
    }
    try {
      file.start()
    } catch {
      fail()
    }
  })
  unzipper.register(UnzipInflate)
  let offset = 0
  const push = () => {
    if (settled) return
    for (let count = 0; count < 16 && offset < data.length && !settled; count += 1) {
      const end = Math.min(offset + 64 * 1024, data.length)
      try {
        unzipper.push(data.subarray(offset, end), end === data.length)
      } catch {
        return fail()
      }
      offset = end
    }
    if (settled) return
    if (offset < data.length) setTimeout(push, 0)
    else {
      inputDone = true
      finish()
    }
  }
  push()
})

export async function createMindmapFile(map, readAsset) {
  const references = imageReferences(map)
  if (!references.size) return new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' })

  const mapBytes = strToU8(JSON.stringify(map, null, 2))
  if (mapBytes.length > MAX_MAP_BYTES || references.size > MAX_IMAGES) throw archiveError()
  const files = { 'map.json': mapBytes }
  let imageBytes = 0
  for (const [assetId, image] of references) {
    const record = await readAsset(assetId)
    if (!record?.blob || !sameImage(record.image, image) || record.blob.size > MAX_IMAGE_BYTES) throw archiveError()
    imageBytes += record.blob.size
    if (imageBytes > MAX_TOTAL_IMAGE_BYTES) throw archiveError()
    const bytes = new Uint8Array(await record.blob.arrayBuffer())
    if (!matchesImageMime(bytes, image.mime)) throw archiveError()
    files[assetPath(image)] = [bytes, { level: 0 }]
  }
  return new Blob([await zipFiles(files)], { type: 'application/zip' })
}

export async function readMindmapFile(file) {
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (magic[0] !== 80 || magic[1] !== 75) {
    const text = await file.text()
    if (/\.(?:md|markdown)$/i.test(file.name)) return { kind: 'markdown', text }
    return { kind: text.trimStart().startsWith('<') ? 'opml' : 'json', text }
  }
  if (file.size > MAX_ARCHIVE_BYTES) throw archiveError()
  const bytes = new Uint8Array(await file.arrayBuffer())

  let files
  try {
    files = await unzipFiles(bytes)
  } catch {
    throw archiveError()
  }
  if (!files['map.json']) throw archiveError()
  let map
  try {
    map = normalizeMap(JSON.parse(strFromU8(files['map.json'])))
  } catch {
    throw archiveError()
  }

  const references = imageReferences(map)
  const expectedPaths = new Set()
  const replacements = new Map()
  const assets = []
  for (const [assetId, image] of references) {
    const path = assetPath(image)
    expectedPaths.add(path)
    const bytes = files[path]
    if (!bytes || !matchesImageMime(bytes, image.mime)) throw archiveError()
    const imported = { ...image, assetId: uid() }
    replacements.set(assetId, imported)
    assets.push({ image: imported, blob: new Blob([bytes], { type: image.mime }) })
  }
  const imagePaths = Object.keys(files).filter((name) => name !== 'map.json')
  if (imagePaths.length !== expectedPaths.size || imagePaths.some((name) => !expectedPaths.has(name))) throw archiveError()
  map = normalizeMap({
    ...map,
    nodes: map.nodes.map((node) => node.data.image
      ? { ...node, data: { ...node.data, image: replacements.get(node.data.image.assetId) } }
      : node),
  })
  return { kind: 'archive', map, assets }
}
