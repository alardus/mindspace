import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRIVE_ENABLED, DRIVE_MIME, MULTIPART_LIMIT, acceptToken, createFile, ensureFolder, folderLabel, forgetToken, getMetadata, hasToken, pickFile, signIn,
  updateFile, uploadMode,
} from '../src/google-drive.js'

const FIELDS = 'id,name,version,md5Checksum,appProperties,trashed,capabilities(canEdit),parents'
const json = (body, init) => new Response(JSON.stringify(body), init)

// Records every request and answers it with respond(url, init, index).
function stubFetch(t, respond) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), ...init })
    return respond(new URL(url), init, calls.length)
  }
  t.after(() => {
    globalThis.fetch = original
    forgetToken()
  })
  return calls
}

test('uploads up to 5 MB are multipart, larger ones resumable', () => {
  assert.equal(MULTIPART_LIMIT, 5 * 1024 * 1024)
  assert.equal(uploadMode(MULTIPART_LIMIT), 'multipart')
  assert.equal(uploadMode(MULTIPART_LIMIT + 1), 'resumable')
})

test('without a valid token nothing is requested', async (t) => {
  const calls = stubFetch(t, () => json({}))
  // No build-time Google config under plain Node: the feature is off, but the module still loads.
  assert.equal(DRIVE_ENABLED, false)
  forgetToken()
  await assert.rejects(getMetadata('f1'), { status: 401 })
  // A token in its last minute would expire mid-upload, so it does not count.
  acceptToken({ access_token: 't', expires_in: 30 })
  assert.equal(hasToken(), false)
  await assert.rejects(getMetadata('f1'), { status: 401 })
  assert.equal(calls.length, 0)
})

test('a new file is one multipart request with the lineage properties', async (t) => {
  const calls = stubFetch(t, () => json({ id: 'f1', version: '1' }))
  acceptToken({ access_token: 't', expires_in: 3600 })
  const created = await createFile({ name: 'Plan.mindmap', folderId: 'dir', blob: new Blob(['{}'], { type: 'application/json' }), appProperties: { mindspaceSaveId: 's1' } })
  assert.deepEqual(created, { id: 'f1', version: '1' })
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.method, 'POST')
  assert.equal(call.url.origin + call.url.pathname, 'https://www.googleapis.com/upload/drive/v3/files')
  assert.equal(call.url.searchParams.get('uploadType'), 'multipart')
  assert.equal(call.url.searchParams.get('fields'), FIELDS)
  assert.equal(call.headers.Authorization, 'Bearer t')
  assert.ok(call.body instanceof FormData)
  assert.deepEqual(JSON.parse(await call.body.get('metadata').text()), {
    name: 'Plan.mindmap', parents: ['dir'], mimeType: DRIVE_MIME, appProperties: { mindspaceSaveId: 's1' },
  })
  assert.equal(call.body.get('file').size, 2)
  assert.equal(call.body.get('file').type, DRIVE_MIME)
})

test('a large update opens a resumable session and sends the bytes to it', async (t) => {
  const calls = stubFetch(t, (url, init, index) => (index === 1
    ? new Response(null, { headers: { Location: 'https://upload.example/session?id=1' } })
    : json({ id: 'f1', version: '3' })))
  acceptToken({ access_token: 't', expires_in: 3600 })
  const blob = new Blob([new Uint8Array(MULTIPART_LIMIT + 1)])
  const updated = await updateFile('f1', { blob, appProperties: { mindspaceSaveId: 's2', mindspaceParentSaveId: 's1' } })
  assert.deepEqual(updated, { id: 'f1', version: '3' })
  assert.equal(calls.length, 2)
  const [open, send] = calls
  assert.equal(open.method, 'PATCH')
  assert.equal(open.url.origin + open.url.pathname, 'https://www.googleapis.com/upload/drive/v3/files/f1')
  assert.equal(open.url.searchParams.get('uploadType'), 'resumable')
  assert.equal(open.url.searchParams.get('fields'), FIELDS)
  assert.equal(open.headers['X-Upload-Content-Type'], DRIVE_MIME)
  // No name and no parents: a rename or a move made in Drive must stick.
  assert.deepEqual(JSON.parse(open.body), { mimeType: DRIVE_MIME, appProperties: { mindspaceSaveId: 's2', mindspaceParentSaveId: 's1' } })
  assert.equal(send.method, 'PUT')
  assert.equal(send.url.href, 'https://upload.example/session?id=1')
  assert.equal(send.body.size, MULTIPART_LIMIT + 1)
})

test('an expired token is forgotten', async (t) => {
  stubFetch(t, () => json({ error: { code: 401, message: 'Invalid Credentials' } }, { status: 401 }))
  acceptToken({ access_token: 't', expires_in: 3600 })
  assert.equal(hasToken(), true)
  await assert.rejects(getMetadata('f1'), { status: 401 })
  assert.equal(hasToken(), false)
})

test('Drive error reasons and network failures are reported', async (t) => {
  let offline = false
  stubFetch(t, () => {
    if (offline) throw new TypeError('fetch failed')
    return json({ error: { message: 'Quota', errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 })
  })
  acceptToken({ access_token: 't', expires_in: 3600 })
  await assert.rejects(getMetadata('f1'), { name: 'DriveError', status: 403, reason: 'storageQuotaExceeded', message: 'Quota' })
  offline = true
  await assert.rejects(getMetadata('f1'), { name: 'DriveError', status: 0 })
  // Neither is a reason to sign in again.
  assert.equal(hasToken(), true)
})

test('the folder label is only given for the Mindspace folder and never throws', async (t) => {
  const calls = stubFetch(t, (url) => {
    if (url.pathname.endsWith('/label-dir')) return json({ name: 'Backups', appProperties: { mindspaceFolder: 'v1' } })
    if (url.pathname.endsWith('/label-other')) return json({ name: 'Docs' })
    return json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 })
  })
  acceptToken({ access_token: 't', expires_in: 3600 })
  assert.equal(await folderLabel('label-dir'), 'Backups')
  assert.equal(await folderLabel('label-dir'), 'Backups')
  assert.equal(calls.length, 1)
  assert.equal(await folderLabel('label-other'), '')
  assert.equal(await folderLabel('label-gone'), '')
  assert.equal(await folderLabel(undefined), '')
  assert.equal(calls.length, 3)
})

// Google's sign-in and picker as the page sees them. With the globals in place nothing is loaded from the network.
function stubGoogle(t, { signIn: answer, pick } = {}) {
  const seen = { prompts: [] }
  globalThis.google = {
    accounts: { oauth2: { initTokenClient: (config) => ({
      requestAccessToken: (options) => {
        seen.prompts.push(options.prompt)
        seen.scope = config.scope
        queueMicrotask(() => answer(config))
      },
    }) } },
    picker: {
      ViewId: { DOCS: 'docs' },
      DocsViewMode: { LIST: 'list' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      DocsView: class { setMimeTypes(types) { seen.mimeTypes = types; return this } setMode() { return this } },
      PickerBuilder: class {
        setAppId() { return this } setDeveloperKey() { return this } addView() { return this }
        setOAuthToken(token) { seen.token = token; return this }
        setCallback(callback) { this.callback = callback; return this }
        build() { return { setVisible: () => queueMicrotask(() => pick(this.callback)) } }
      },
    },
  }
  t.after(() => {
    delete globalThis.google
    forgetToken()
  })
  return seen
}

test('signing in takes the token; a closed or blocked window is told apart from a failure', async (t) => {
  let answer = (config) => config.callback({ access_token: 't1', expires_in: 3600 })
  const seen = stubGoogle(t, { signIn: (config) => answer(config) })
  forgetToken()
  await signIn()
  assert.equal(hasToken(), true)
  assert.equal(seen.scope, 'https://www.googleapis.com/auth/drive.file')
  await signIn({ chooseAccount: true })
  assert.deepEqual(seen.prompts, ['', 'select_account'])

  forgetToken()
  answer = (config) => config.error_callback({ type: 'popup_closed' })
  await assert.rejects(signIn(), { name: 'DriveError', kind: 'cancelled' })
  answer = (config) => config.error_callback({ type: 'popup_failed_to_open' })
  await assert.rejects(signIn(), { kind: 'blocked' })
  answer = (config) => config.error_callback({ type: 'unknown' })
  await assert.rejects(signIn(), { kind: 'failed' })
  // The user pressed Cancel on Google's consent screen.
  answer = (config) => config.callback({ error: 'access_denied' })
  await assert.rejects(signIn(), { kind: 'cancelled' })
  assert.equal(hasToken(), false)
})

test('the picker gives the chosen file, or nothing when it is closed', async (t) => {
  let pick = (callback) => {
    callback({ action: 'loaded' })
    callback({ action: 'picked', docs: [{ id: 'f1', name: 'Plan.mindmap', mimeType: DRIVE_MIME }] })
  }
  const seen = stubGoogle(t, { pick: (callback) => pick(callback) })
  forgetToken()
  await assert.rejects(pickFile(), { status: 401 })
  acceptToken({ access_token: 't1', expires_in: 3600 })
  assert.deepEqual(await pickFile(), { id: 'f1', name: 'Plan.mindmap' })
  assert.equal(seen.token, 't1')
  assert.ok(seen.mimeTypes.split(',').includes(DRIVE_MIME))
  pick = (callback) => callback({ action: 'cancel' })
  assert.equal(await pickFile(), null)
})

test('the Mindspace folder is found by its private mark, and created only when there is none', async (t) => {
  let found = [{ id: 'dir', name: 'Renamed by the user' }]
  const calls = stubFetch(t, (url, init) => (init.method === 'POST' ? json({ id: 'new-dir', name: 'Mindspace' }) : json({ files: found })))
  acceptToken({ access_token: 't', expires_in: 3600 })
  assert.deepEqual(await ensureFolder(), { id: 'dir', name: 'Renamed by the user' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.origin + calls[0].url.pathname, 'https://www.googleapis.com/drive/v3/files')
  assert.equal(calls[0].url.searchParams.get('q'), "appProperties has { key='mindspaceFolder' and value='v1' } and mimeType='application/vnd.google-apps.folder' and trashed=false")
  found = []
  assert.deepEqual(await ensureFolder(), { id: 'new-dir', name: 'Mindspace' })
  assert.equal(calls.length, 3)
  assert.equal(calls[2].method, 'POST')
  assert.deepEqual(JSON.parse(calls[2].body), { name: 'Mindspace', mimeType: 'application/vnd.google-apps.folder', appProperties: { mindspaceFolder: 'v1' } })
})
