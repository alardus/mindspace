import test from 'node:test'
import assert from 'node:assert/strict'

const assets = await import('../src/assets.js').catch(() => ({}))
const validateImageFile = assets.validateImageFile ?? (() => assert.fail('validateImageFile is missing'))
const saveImageAssets = assets.saveImageAssets ?? (async () => assert.fail('saveImageAssets is missing'))
const createImageAsset = assets.createImageAsset ?? (async () => assert.fail('createImageAsset is missing'))

test('accepted raster formats allow files at the 2 MiB boundary', () => {
  for (const [name, type] of [
    ['image.png', 'image/png'],
    ['image.jpg', 'image/jpeg'],
    ['image.webp', 'image/webp'],
    ['image.gif', 'image/gif'],
  ]) {
    assert.doesNotThrow(() => validateImageFile(new File([new Uint8Array(2 * 1024 * 1024)], name, { type })))
  }
})

test('SVG files are rejected', () => {
  assert.throws(
    () => validateImageFile(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })),
    { message: 'Use PNG, JPEG, WebP, or GIF.' },
  )
})

test('empty image files are rejected', () => {
  assert.throws(
    () => validateImageFile(new File([], 'empty.png', { type: 'image/png' })),
    { message: 'The image is empty.' },
  )
})

test('images above 2 MiB are rejected', () => {
  assert.throws(
    () => validateImageFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })),
    { message: 'Images must be 2 MB or smaller.' },
  )
})

test('decoded images must match their declared MIME', async () => {
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
  try {
    const jpeg = new File([new Uint8Array([255, 216, 255, 1])], 'wrong.png', { type: 'image/png' })
    await assert.rejects(createImageAsset(jpeg), { message: 'Use PNG, JPEG, WebP, or GIF.' })
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap
    else globalThis.createImageBitmap = original
  }
})

test('invalid asset batches fail before opening a write transaction', async () => {
  const original = globalThis.indexedDB
  let opened = false
  globalThis.indexedDB = { open() { opened = true; throw new Error('opened') } }
  try {
    await assert.rejects(saveImageAssets([
      {
        blob: new Blob(['image']),
        image: { assetId: 'valid', name: 'valid.png', mime: 'image/png', naturalWidth: 1, naturalHeight: 1 },
      },
      { blob: new Blob(['invalid']), image: null },
    ]), /could not be saved/i)
    assert.equal(opened, false)
  } finally {
    if (original === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = original
  }
})
