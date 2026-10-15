// The only code that talks to Google: sign-in (Google Identity Services), the file picker and the Drive REST API.
// The access token lives in this module's memory and nowhere else.

// Vite fills import.meta.env at build time; under plain Node (tests) it is absent.
const env = import.meta.env ?? {}
const CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID
const API_KEY = env.VITE_GOOGLE_API_KEY
const APP_ID = env.VITE_GOOGLE_APP_ID
export const DRIVE_ENABLED = Boolean(CLIENT_ID && API_KEY && APP_ID)

export const DRIVE_MIME = 'application/vnd.mindspace.mindmap'
export const MULTIPART_LIMIT = 5 * 1024 * 1024
export const uploadMode = (size) => (size <= MULTIPART_LIMIT ? 'multipart' : 'resumable')

// Per-file access only: the app sees what it created and what the user picked for it.
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,name,version,md5Checksum,appProperties,trashed,capabilities(canEdit),parents'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
// A .mindmap uploaded to Drive by hand is plain JSON or a ZIP archive.
const PICKER_MIME_TYPES = [DRIVE_MIME, 'application/json', 'application/zip']
const isMindspaceFile = (file) => typeof file?.id === 'string' && typeof file.name === 'string'
  && (file.mimeType === DRIVE_MIME || (PICKER_MIME_TYPES.includes(file.mimeType) && /\.mindmap$/i.test(file.name)))

// status: the HTTP status, 0 when Google could not be reached. reason: Drive's own word for a 403.
// kind: set where there is no status to go by — a closed or blocked sign-in window.
export class DriveError extends Error {
  constructor(message, { status = 0, reason = '', kind } = {}) {
    super(message)
    this.name = 'DriveError'
    this.status = status
    this.reason = reason
    if (kind) this.kind = kind
  }
}

let token = null

// A token in its last minute would expire mid-upload, so it is treated as gone already.
export function acceptToken({ access_token: value, expires_in: seconds }) {
  token = { value, expiresAt: Date.now() + (Number(seconds) - 60) * 1000 }
}
export const hasToken = () => Boolean(token && Date.now() < token.expiresAt)
export const forgetToken = () => {
  token = null
}

const scripts = new Map()
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const element = document.createElement('script')
      element.src = src
      element.async = true
      element.onload = resolve
      element.onerror = () => {
        // The next attempt starts over, e.g. once the network is back.
        scripts.delete(src)
        element.remove()
        reject(new DriveError('Google is unreachable'))
      }
      document.head.append(element)
    }))
  }
  return scripts.get(src)
}

const loadPicker = () => loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) => {
  const fail = () => reject(new DriveError('Google is unreachable'))
  globalThis.gapi.load('picker', { callback: resolve, onerror: fail, timeout: 10000, ontimeout: fail })
}))

// Fetching Google's scripts ahead of the click keeps the sign-in popup inside the user gesture.
export async function preload() {
  await Promise.all([
    globalThis.google?.accounts?.oauth2 || loadScript('https://accounts.google.com/gsi/client'),
    globalThis.google?.picker || loadPicker(),
  ])
}

// Opens Google's sign-in window. chooseAccount forces the account list — for when the file was not found under the current one.
export async function signIn({ chooseAccount = false } = {}) {
  await preload()
  await new Promise((resolve, reject) => {
    globalThis.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) return reject(new DriveError(response.error, { kind: 'cancelled' }))
        acceptToken(response)
        resolve()
      },
      error_callback: (error) => reject(new DriveError(error.message ?? error.type, {
        kind: { popup_closed: 'cancelled', popup_failed_to_open: 'blocked' }[error.type] ?? 'failed',
      })),
    }).requestAccessToken({ prompt: chooseAccount ? 'select_account' : '' })
  })
}

// Resolves to the chosen file, or null when the picker is closed. Picking is what grants the app access to the file.
export async function pickFile() {
  if (!hasToken()) throw new DriveError('Google sign-in is required', { status: 401 })
  await preload()
  const { picker } = globalThis.google
  return new Promise((resolve, reject) => {
    new picker.PickerBuilder()
      .setAppId(APP_ID)
      .setDeveloperKey(API_KEY)
      .setOAuthToken(token.value)
      .addView(new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(PICKER_MIME_TYPES.join(',')).setMode(picker.DocsViewMode.LIST))
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const file = data.docs?.[0]
          if (!isMindspaceFile(file)) return reject(new DriveError('Choose a Mindspace .mindmap file', { kind: 'invalid' }))
          resolve({ id: file.id, name: file.name })
        }
        else if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}

async function request(url, init = {}) {
  if (!hasToken()) throw new DriveError('Google sign-in is required', { status: 401 })
  let response
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token.value}` } })
  } catch {
    throw new DriveError('Google Drive is unreachable')
  }
  if (response.ok) return response
  if (response.status === 401) forgetToken()
  const body = await response.json().catch(() => null)
  throw new DriveError(body?.error?.message ?? `Google Drive responded with ${response.status}`, {
    status: response.status,
    reason: body?.error?.errors?.[0]?.reason ?? '',
  })
}

const query = (params) => new URLSearchParams(params).toString()
const jsonBody = (value) => ({ headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(value) })

export const getMetadata = async (fileId) => (await request(`${FILES}/${fileId}?${query({ fields: FIELDS })}`)).json()

export const downloadFile = async (fileId) => (await request(`${FILES}/${fileId}?alt=media`)).blob()

async function upload(method, fileId, metadata, blob) {
  const url = (uploadType) => `${UPLOAD}${fileId ? `/${fileId}` : ''}?${query({ uploadType, fields: FIELDS })}`
  if (uploadMode(blob.size) === 'multipart') {
    const body = new FormData()
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    body.append('file', new Blob([blob], { type: DRIVE_MIME }))
    return (await request(url('multipart'), { method, body })).json()
  }
  const { headers, body } = jsonBody(metadata)
  const session = await request(url('resumable'), { method, headers: { ...headers, 'X-Upload-Content-Type': DRIVE_MIME }, body })
  const location = session.headers.get('Location')
  if (!location) throw new DriveError('Google Drive did not open an upload session', { kind: 'failed' })
  return (await request(location, { method: 'PUT', body: blob })).json()
}

export const createFile = ({ name, folderId, blob, appProperties }) => upload('POST', null, {
  name, parents: [folderId], mimeType: DRIVE_MIME, appProperties,
}, blob)

// No name and no parents: a rename or a move made in Drive must stick.
export const updateFile = (fileId, { blob, appProperties }) => upload('PATCH', fileId, { mimeType: DRIVE_MIME, appProperties }, blob)

// The visible folder for backups made by the app. It is found by a private property, so renaming it in Drive is fine.
export async function ensureFolder() {
  const q = `appProperties has { key='mindspaceFolder' and value='v1' } and mimeType='${FOLDER_MIME}' and trashed=false`
  const found = await (await request(`${FILES}?${query({ q, fields: 'files(id,name)', pageSize: 1 })}`)).json()
  if (found.files?.[0]) return found.files[0]
  return (await request(`${FILES}?${query({ fields: 'id,name' })}`, {
    method: 'POST',
    ...jsonBody({ name: 'Mindspace', mimeType: FOLDER_MIME, appProperties: { mindspaceFolder: 'v1' } }),
  })).json()
}

const folderLabels = new Map()
// The name of a file's folder when it is the app's own; any other folder — or one the app may not read — gives ''.
export function folderLabel(parentId) {
  if (!parentId) return Promise.resolve('')
  if (!folderLabels.has(parentId)) {
    folderLabels.set(parentId, request(`${FILES}/${parentId}?${query({ fields: 'name,appProperties' })}`)
      .then((response) => response.json())
      .then((folder) => (folder.appProperties?.mindspaceFolder === 'v1' ? folder.name : ''))
      .catch((error) => {
        // "Not yours" is an answer; a dropped connection or an expired sign-in is not.
        if (error.status !== 403 && error.status !== 404) folderLabels.delete(parentId)
        return ''
      }))
  }
  return folderLabels.get(parentId)
}
