import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { normalizeMap } from '../src/model.js'

const archive = await import('../src/archive.js').catch(() => ({}))
const createMindmapFile = archive.createMindmapFile ?? (async () => new Blob())
const readMindmapFile = archive.readMindmapFile ?? (async () => ({ kind: 'missing' }))

const firstImage = {
  assetId: 'asset-1',
  name: 'diagram.png',
  mime: 'image/png',
  naturalWidth: 1200,
  naturalHeight: 800,
}
const secondImage = {
  assetId: 'asset-2',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  naturalWidth: 600,
  naturalHeight: 900,
}
const firstBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const secondBytes = new Uint8Array([255, 216, 255, 4, 5, 6])

const imageMap = () => normalizeMap({
  version: 3,
  title: 'Images',
  nodes: [
    { id: 'first', data: { label: '', image: firstImage } },
    { id: 'second', data: { label: 'Photo', image: secondImage } },
  ],
  edges: [],
})

test('maps without images remain JSON files', async () => {
  const map = normalizeMap({ version: 2, title: 'Text', nodes: [{ id: 'root', data: { label: 'Root' } }], edges: [] })
  const blob = await createMindmapFile(map, async () => null)

  assert.equal(blob.type, 'application/json')
  assert.deepEqual(JSON.parse(await blob.text()), map)
})

test('image maps round-trip exact assets through a ZIP archive', async () => {
  const records = new Map([
    ['asset-1', { image: firstImage, blob: new Blob([firstBytes], { type: firstImage.mime }) }],
    ['asset-2', { image: secondImage, blob: new Blob([secondBytes], { type: secondImage.mime }) }],
  ])
  const blob = await createMindmapFile(imageMap(), async (id) => records.get(id) ?? null)
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer())

  assert.deepEqual([...magic], [80, 75, 3, 4])
  const imported = await readMindmapFile(new File([blob], 'images.mindmap'))
  assert.equal(imported.kind, 'archive')
  assert.deepEqual(imported.map.nodes.map((node) => node.data.label), ['', 'Photo'])
  const importedIds = imported.map.nodes.map((node) => node.data.image.assetId)
  assert.equal(new Set(importedIds).size, 2)
  assert.ok(importedIds.every((id) => id !== 'asset-1' && id !== 'asset-2'))
  assert.deepEqual(imported.assets.map((asset) => asset.image.assetId), importedIds)
  assert.deepEqual(
    await Promise.all(imported.assets.map(async (asset) => [...new Uint8Array(await asset.blob.arrayBuffer())])),
    [[...firstBytes], [...secondBytes]],
  )
})

test('legacy JSON and OPML payloads are detected without archive parsing', async () => {
  const json = await readMindmapFile(new File(['{"version":2}'], 'legacy.mindmap'))
  const opml = await readMindmapFile(new File(['<?xml version="1.0"?><opml/>'], 'outline.opml'))

  assert.deepEqual(json, { kind: 'json', text: '{"version":2}' })
  assert.deepEqual(opml, { kind: 'opml', text: '<?xml version="1.0"?><opml/>' })
})

test('Markdown files are detected by extension', async () => {
  const text = '# Notes\n\n- First'

  assert.deepEqual(await readMindmapFile(new File([text], 'notes.md')), { kind: 'markdown', text })
  assert.deepEqual(await readMindmapFile(new File([text], 'notes.markdown')), { kind: 'markdown', text })
})

const archiveFile = (entries) => new File([zipSync(entries, { level: 0 })], 'invalid.mindmap')
const mapEntry = () => strToU8(JSON.stringify(imageMap()))

test('rejects incomplete archive with a missing referenced asset', async () => {
  await assert.rejects(
    readMindmapFile(archiveFile({ 'map.json': mapEntry(), 'images/asset-1.png': firstBytes })),
    /incomplete or corrupted/i,
  )
})

test('rejects archive with an unreferenced image', async () => {
  await assert.rejects(
    readMindmapFile(archiveFile({
      'map.json': mapEntry(),
      'images/asset-1.png': firstBytes,
      'images/asset-2.jpg': secondBytes,
      'images/surplus.png': firstBytes,
    })),
    /incomplete or corrupted/i,
  )
})

test('rejects archive with an oversized image', async () => {
  await assert.rejects(
    readMindmapFile(archiveFile({
      'map.json': mapEntry(),
      'images/asset-1.png': new Uint8Array(10 * 1024 * 1024 + 1),
      'images/asset-2.jpg': secondBytes,
    })),
    /incomplete or corrupted/i,
  )
})

test('rejects archive without map.json', async () => {
  await assert.rejects(readMindmapFile(archiveFile({ 'other.json': strToU8('{}') })), /incomplete or corrupted/i)
})

test('rejects archive with an oversized map.json', async () => {
  const oversizedMap = new Uint8Array(5 * 1024 * 1024 + 1)
  oversizedMap.set(strToU8(JSON.stringify(imageMap())))
  oversizedMap.fill(32, strToU8(JSON.stringify(imageMap())).length)
  await assert.rejects(
    readMindmapFile(archiveFile({
      'map.json': oversizedMap,
      'images/asset-1.png': firstBytes,
      'images/asset-2.jpg': secondBytes,
    })),
    /incomplete or corrupted/i,
  )
})

test('rejects a ZIP whose declared sizes hide an oversized map', async () => {
  const mapJson = JSON.stringify(imageMap())
  const payload = strToU8(mapJson + ' '.repeat(6 * 1024 * 1024))
  const bytes = zipSync({
    'map.json': payload,
    'images/asset-1.png': firstBytes,
    'images/asset-2.jpg': secondBytes,
  }, { level: 9 })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset <= bytes.length - 28; offset += 1) {
    const signature = view.getUint32(offset, true)
    if (signature === 0x04034b50) view.setUint32(offset + 22, mapJson.length + 16, true)
    if (signature === 0x02014b50) view.setUint32(offset + 24, mapJson.length + 16, true)
  }

  await assert.rejects(readMindmapFile(new File([bytes], 'forged.mindmap')), /incomplete or corrupted/i)
})

test('rejects image bytes that do not match the declared MIME', async () => {
  await assert.rejects(
    readMindmapFile(archiveFile({
      'map.json': mapEntry(),
      'images/asset-1.png': secondBytes,
      'images/asset-2.jpg': secondBytes,
    })),
    /incomplete or corrupted/i,
  )
})

test('rejects inconsistent metadata for a shared asset ID', async () => {
  const map = imageMap()
  map.nodes[1].data.image = { ...secondImage, assetId: firstImage.assetId }
  await assert.rejects(
    readMindmapFile(archiveFile({
      'map.json': strToU8(JSON.stringify(map)),
      'images/asset-1.png': firstBytes,
    })),
    /incomplete or corrupted/i,
  )
})

test('refuses to export more images than its importer accepts', async () => {
  const nodes = Array.from({ length: 101 }, (_, index) => ({
    id: `node-${index}`,
    data: { label: '', image: { ...firstImage, assetId: `asset-${index}` } },
  }))
  const map = normalizeMap({ version: 3, title: 'Too many', nodes, edges: [] })
  let reads = 0

  await assert.rejects(createMindmapFile(map, async (assetId) => {
    reads += 1
    return {
      image: map.nodes.find((node) => node.data.image.assetId === assetId).data.image,
      blob: new Blob([firstBytes], { type: 'image/png' }),
    }
  }), /incomplete or corrupted/i)
  assert.equal(reads, 0)
})
