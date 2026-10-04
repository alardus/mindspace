import { IMAGE_MIME_TYPES, normalizeImageReference } from './model.js'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DB_NAME = 'mindspace-assets-v1'
const STORE_NAME = 'images'
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export function matchesImageMime(bytes, mime) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value)
  if (mime === 'image/png') return starts(137, 80, 78, 71, 13, 10, 26, 10)
  if (mime === 'image/jpeg') return starts(255, 216, 255)
  if (mime === 'image/gif') return starts(71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97
  if (mime === 'image/webp') return starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80
  return false
}

export function validateImageFile(file) {
  if (!IMAGE_MIME_TYPES.has(file?.type)) throw new Error('Use PNG, JPEG, WebP, or GIF.')
  if (!file.size) throw new Error('The image is empty.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be 10 MB or smaller.')
}

export async function createImageAsset(file, assetId = uid()) {
  validateImageFile(file)
  let bitmap
  try {
    if (!matchesImageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) throw new Error()
    bitmap = await createImageBitmap(file)
    const image = normalizeImageReference({
      assetId,
      name: file.name,
      mime: file.type,
      naturalWidth: bitmap.width,
      naturalHeight: bitmap.height,
    })
    if (!image) throw new Error()
    return { blob: file, image }
  } catch {
    throw new Error('Use PNG, JPEG, WebP, or GIF.')
  } finally {
    bitmap?.close()
  }
}

const request = (operation) => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result)
  operation.onerror = () => reject(operation.error)
})

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error)
})

function openAssets() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'))
  const opening = indexedDB.open(DB_NAME, 1)
  opening.onupgradeneeded = () => {
    if (!opening.result.objectStoreNames.contains(STORE_NAME)) {
      opening.result.createObjectStore(STORE_NAME, { keyPath: 'image.assetId' })
    }
  }
  return request(opening)
}

export async function saveImageAssets(records) {
  if (!records.length) return
  let prepared
  try {
    prepared = records.map((record) => {
      const image = normalizeImageReference(record?.image)
      if (!image || !(record.blob instanceof Blob)) throw new Error()
      return { blob: record.blob, image }
    })
  } catch {
    throw new Error('The image could not be saved on this device.')
  }
  let database
  let transaction
  try {
    database = await openAssets()
    transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    for (const record of prepared) store.put(record)
    await transactionDone(transaction)
  } catch {
    try { transaction?.abort() } catch { /* The transaction already ended. */ }
    throw new Error('The image could not be saved on this device.')
  } finally {
    database?.close()
  }
}

export async function deleteImageAssets(assetIds) {
  if (!assetIds.length) return
  let database
  try {
    database = await openAssets()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    assetIds.forEach((assetId) => store.delete(assetId))
    await transactionDone(transaction)
  } finally {
    database?.close()
  }
}

export async function loadImageAsset(assetId) {
  const database = await openAssets()
  try {
    return await request(database.transaction(STORE_NAME).objectStore(STORE_NAME).get(assetId)) ?? null
  } finally {
    database.close()
  }
}

export async function pruneImageAssets(keepIds) {
  const database = await openAssets()
  try {
    const keys = await request(database.transaction(STORE_NAME).objectStore(STORE_NAME).getAllKeys())
    const stale = keys.filter((key) => !keepIds.has(key))
    if (!stale.length) return
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    stale.forEach((key) => store.delete(key))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}
