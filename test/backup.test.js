import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKUP_VIEW, DRIVE_MESSAGES, backupFileName, backupKey, backupTransition, backupUi, createBackup, createBackupQueue, errorKind, isBackupEdit, linkedDocument,
  pushBackup, remoteCheck, replaceBackup, restoreBackup, resumesOnSignIn, retriesWhenBack,
} from '../src/backup.js'

test('what auto-layout derives is not an edit; the same fields placed by hand are', () => {
  const map = (autoLayout, { x = 0, side = 'right', handle = 'source-right' } = {}) => ({
    title: 'A',
    autoLayout,
    nodes: [{ id: 'n', position: { x, y: 0 }, data: { label: 'One', side } }],
    edges: [{ id: 'e', source: 'root', target: 'n', sourceHandle: handle, targetHandle: handle.replace('source', 'target') }],
  })
  // Another device measures text differently: nodes move, a branch lands on the other side, its line re-attaches.
  for (const drift of [{ x: 40 }, { side: 'left' }, { handle: 'source-left' }]) {
    assert.equal(backupKey(map(true)), backupKey(map(true, drift)), JSON.stringify(drift))
    assert.notEqual(backupKey(map(false)), backupKey(map(false, drift)), JSON.stringify(drift))
  }
  assert.notEqual(backupKey(map(true)), backupKey({ ...map(true), title: 'B' }))
  const reordered = map(true)
  reordered.nodes.push({ id: 'm', position: { x: 0, y: 0 }, data: { label: 'Two', side: 'left' } })
  assert.notEqual(backupKey(reordered), backupKey({ ...reordered, nodes: [...reordered.nodes].reverse() }))
})

test('remote check accepts metadata-only changes and stops on content or lineage changes', () => {
  const backup = { md5Checksum: 'm1', saveId: 's1' }
  const meta = { md5Checksum: 'm1', version: '9', name: 'Renamed.mindmap', appProperties: { mindspaceSaveId: 's1' }, capabilities: { canEdit: true } }
  assert.equal(remoteCheck(backup, meta), 'ok')
  assert.equal(remoteCheck(backup, { ...meta, md5Checksum: 'm2' }), 'conflict')
  assert.equal(remoteCheck(backup, { ...meta, appProperties: { mindspaceSaveId: 's2' } }), 'conflict')
  assert.equal(remoteCheck({ md5Checksum: 'm1', saveId: '' }, { ...meta, appProperties: undefined }), 'ok')
  assert.equal(remoteCheck(backup, { ...meta, md5Checksum: 'm2', capabilities: { canEdit: false } }), 'readonly')
  assert.equal(remoteCheck(backup, { ...meta, trashed: true, capabilities: { canEdit: false } }), 'trashed')
  assert.equal(remoteCheck(null, { ...meta, md5Checksum: 'other' }), 'ok')
})

test('errors map to the state the user sees', () => {
  const kinds = [
    [{ status: 401 }, 'auth'], [{ status: 404 }, 'missing'], [{ status: 0 }, 'offline'], [{ status: 503 }, 'offline'], [{ status: 429 }, 'offline'],
    [{ status: 403, reason: 'userRateLimitExceeded' }, 'offline'], [{ status: 403, reason: 'storageQuotaExceeded' }, 'quota'],
    [{ status: 403, reason: 'insufficientFilePermissions' }, 'readonly'], [{ status: 403, reason: 'domainPolicy' }, 'failed'],
    [{ status: 400 }, 'failed'], [new Error('The map archive is incomplete or corrupted.'), 'failed'],
    [{ kind: 'cancelled', status: 0 }, 'cancelled'], [{ kind: 'blocked' }, 'blocked'],
  ]
  for (const [error, kind] of kinds) assert.equal(errorKind(error), kind)
  for (const kind of ['offline', 'quota', 'readonly', 'missing', 'blocked', 'failed']) assert.ok(DRIVE_MESSAGES[kind])
})

test('every linked state has its copy; only the three that need a reaction carry an alert', () => {
  assert.equal(backupUi(undefined, { status: 'auth' }), 'off')
  assert.equal(backupUi({ state: 'conflict' }, { status: 'saving' }), 'conflict')
  assert.equal(backupUi({ state: 'linked' }, { status: 'offline' }), 'offline')
  assert.equal(backupUi({ state: 'linked' }), 'saved')
  assert.deepEqual(Object.keys(BACKUP_VIEW).sort(), ['auth', 'conflict', 'failed', 'offline', 'readonly', 'saved', 'saving'])
  for (const [key, view] of Object.entries(BACKUP_VIEW)) {
    assert.ok(view.label)
    assert.equal(Boolean(view.alert), ['auth', 'conflict', 'readonly'].includes(key))
    assert.equal(view.tone === 'warn', Boolean(view.alert))
    assert.equal(Boolean(view.status), key !== 'saved')
  }
  assert.equal(BACKUP_VIEW.saving.say, undefined)
  assert.match(BACKUP_VIEW.conflict.alert.text, /\{name\}/)
})

test('a file can back only one local map', () => {
  const documents = [{ id: 'a', googleDriveBackup: { fileId: 'f1' } }, { id: 'b' }]
  assert.equal(linkedDocument(documents, 'f1').id, 'a')
  assert.equal(linkedDocument(documents, 'f1', 'a'), undefined)
  assert.equal(linkedDocument(documents, 'f2'), undefined)
  assert.equal(backupFileName('  Plan / Q4 '), 'Plan / Q4.mindmap')
  assert.equal(backupFileName('   '), 'Untitled.mindmap')
})

const settle = () => new Promise((resolve) => setImmediate(resolve))
// Uploads the test finishes by hand.
function manualQueue(t) {
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())
  const runs = []
  const queue = createBackupQueue((id) => new Promise((resolve, reject) => runs.push({ id, resolve, reject })))
  return { runs, queue }
}

test('edits are debounced for five seconds', async (t) => {
  const { runs, queue } = manualQueue(t)
  queue.schedule('a')
  mock.timers.tick(2000)
  queue.schedule('a')
  mock.timers.tick(2000)
  queue.schedule('a')
  mock.timers.tick(4999)
  assert.equal(runs.length, 0)
  assert.equal(queue.busy('a'), true)
  mock.timers.tick(1)
  assert.deepEqual(runs.map((run) => run.id), ['a'])
  assert.equal(queue.busy('a'), true)
  runs[0].resolve()
  await settle()
  assert.equal(queue.busy('a'), false)
})

test('one upload at a time, and one more after a change mid-upload', async (t) => {
  const { runs, queue } = manualQueue(t)
  queue.now('a')
  assert.equal(runs.length, 1)
  queue.schedule('a')
  queue.schedule('a')
  queue.now('a')
  mock.timers.tick(10000)
  assert.equal(runs.length, 1)
  runs[0].resolve()
  await settle()
  // The follow-up waits the normal delay instead of firing back to back.
  assert.equal(runs.length, 1)
  assert.equal(queue.busy('a'), true)
  mock.timers.tick(5000)
  assert.equal(runs.length, 2)
  runs[1].resolve()
  await settle()
  mock.timers.tick(10000)
  assert.equal(runs.length, 2)
  assert.equal(queue.busy('a'), false)
})

test('maps queue independently and a failing run does not break the queue', async (t) => {
  const { runs, queue } = manualQueue(t)
  queue.schedule('a')
  queue.schedule('b')
  mock.timers.tick(5000)
  assert.deepEqual(runs.map((run) => run.id), ['a', 'b'])
  runs[0].reject(new Error('boom'))
  await settle()
  assert.equal(queue.busy('a'), false)
  assert.equal(queue.busy('b'), true)
  queue.schedule('a')
  mock.timers.tick(5000)
  assert.equal(runs.length, 3)
  queue.now('missing')
  assert.equal(runs.at(-1).id, 'missing')
})

// An in-memory Drive with the client's shape. The digest stands in for md5: equal content, equal checksum.
const digest = (text) => `md5:${text}`
function fakeDrive(initial = []) {
  const files = new Map(initial.map((file) => [file.id, { version: '1', capabilities: { canEdit: true }, md5Checksum: digest(file.content), ...file }]))
  const view = ({ content, ...meta }) => structuredClone(meta)
  async function write(method, id, file, blob, appProperties) {
    drive.calls.push([method, id])
    const content = await blob.text()
    const next = { ...file, content, md5Checksum: digest(content), version: String(Number(file.version) + 1), appProperties: { ...file.appProperties, ...appProperties } }
    files.set(id, next)
    // The moment between a write and the read that follows it: another device may get in.
    drive.afterWrite?.(id)
    return view(next)
  }
  const drive = {
    files,
    calls: [],
    afterWrite: null,
    writes: () => drive.calls.filter(([method]) => method === 'createFile' || method === 'updateFile'),
    // What a second device does: new content under its own save id.
    otherDevice(id, content) {
      const file = files.get(id)
      files.set(id, { ...file, content, md5Checksum: digest(content), version: String(Number(file.version) + 1), appProperties: { ...file.appProperties, mindspaceSaveId: 'other-device' } })
    },
    async getMetadata(id) {
      if (!files.has(id)) throw Object.assign(new Error('File not found'), { status: 404 })
      return view(files.get(id))
    },
    createFile: ({ name, folderId, blob, appProperties }) => write('createFile', `file${files.size + 1}`, { id: `file${files.size + 1}`, name, parents: [folderId], version: '0', capabilities: { canEdit: true } }, blob, appProperties),
    updateFile: (id, { blob, appProperties }) => write('updateFile', id, files.get(id), blob, appProperties),
    async downloadFile(id) {
      drive.calls.push(['downloadFile', id])
      return new Blob([files.get(id).content])
    },
    ensureFolder: async () => ({ id: 'dir', name: 'Mindspace' }),
    folderLabel: async (id) => (id === 'dir' ? 'Mindspace' : ''),
  }
  return drive
}
const text = (content) => new Blob([content])
// A map backed up once from this device.
async function linked(content = 'v1') {
  const drive = fakeDrive()
  const backup = await createBackup(drive, { title: 'Plan', blob: text(content), now: 1000 })
  drive.calls.length = 0
  return { drive, backup, file: () => drive.files.get(backup.fileId) }
}

test('a new backup lands in the Mindspace folder and becomes the baseline', async () => {
  const drive = fakeDrive()
  const backup = await createBackup(drive, { title: 'Plan', blob: text('v1'), now: 1000 })
  const file = drive.files.get(backup.fileId)
  assert.equal(file.name, 'Plan.mindmap')
  assert.deepEqual(file.parents, ['dir'])
  assert.equal(file.content, 'v1')
  assert.equal(file.appProperties.mindspaceFormat, 'mindmap')
  assert.equal(file.appProperties.mindspaceParentSaveId, '')
  assert.ok(file.appProperties.mindspaceSaveId)
  assert.deepEqual(backup, {
    fileId: file.id, driveVersion: file.version, md5Checksum: file.md5Checksum, saveId: file.appProperties.mindspaceSaveId,
    state: 'linked', name: 'Plan.mindmap', folder: 'Mindspace', savedAt: 1000,
  })
})

test('an unchanged remote is updated and the lineage advances', async () => {
  const { drive, backup, file } = await linked()
  const result = await pushBackup(drive, backup, { blob: text('v2'), now: 2000 })
  assert.equal(result.outcome, 'saved')
  assert.equal(file().content, 'v2')
  assert.equal(file().appProperties.mindspaceParentSaveId, backup.saveId)
  assert.notEqual(result.backup.saveId, backup.saveId)
  assert.deepEqual(result.backup, {
    ...backup, driveVersion: file().version, md5Checksum: digest('v2'), saveId: file().appProperties.mindspaceSaveId, savedAt: 2000,
  })
  assert.deepEqual(drive.writes(), [['updateFile', backup.fileId]])
  // And again from the new baseline.
  assert.equal((await pushBackup(drive, result.backup, { blob: text('v3') })).outcome, 'saved')
})

test('a rename or move in Drive is not a conflict', async () => {
  const { drive, backup, file } = await linked()
  Object.assign(file(), { name: 'Renamed.mindmap', parents: ['elsewhere'], version: '40' })
  const result = await pushBackup(drive, backup, { blob: text('v2') })
  assert.equal(result.outcome, 'saved')
  assert.equal(result.backup.name, 'Renamed.mindmap')
  assert.equal(result.backup.folder, '')
  assert.equal(result.backup.driveVersion, '41')
  assert.equal(file().content, 'v2')
})

test('a changed remote is neither overwritten nor pulled', async () => {
  const { drive, backup, file } = await linked()
  drive.otherDevice(backup.fileId, 'theirs')
  assert.deepEqual(await pushBackup(drive, backup, { blob: text('mine') }), { outcome: 'conflict' })
  assert.equal(file().content, 'theirs')
  // Same bytes saved by another device are still someone else's save.
  drive.otherDevice(backup.fileId, 'v1')
  assert.equal(file().md5Checksum, backup.md5Checksum)
  assert.deepEqual(await pushBackup(drive, backup, { blob: text('mine') }), { outcome: 'conflict' })
  assert.deepEqual(drive.writes(), [])
})

test('a trashed or read-only remote stops before writing', async () => {
  const { drive, backup, file } = await linked()
  file().capabilities.canEdit = false
  assert.deepEqual(await pushBackup(drive, backup, { blob: text('v2') }), { outcome: 'readonly' })
  file().trashed = true
  assert.deepEqual(await pushBackup(drive, backup, { blob: text('v2') }), { outcome: 'trashed' })
  assert.deepEqual(drive.writes(), [])
  drive.files.delete(backup.fileId)
  await assert.rejects(pushBackup(drive, backup, { blob: text('v2') }), { status: 404 })
})

test('a write that loses the race is reported as a conflict', async () => {
  const { drive, backup, file } = await linked()
  drive.afterWrite = (id) => drive.otherDevice(id, 'theirs')
  assert.deepEqual(await pushBackup(drive, backup, { blob: text('mine') }), { outcome: 'conflict' })
  assert.equal(file().content, 'theirs')
})

test('a conflicted file can be overwritten on request', async () => {
  const { drive, backup, file } = await linked()
  drive.otherDevice(backup.fileId, 'theirs')
  const result = await replaceBackup(drive, backup.fileId, { blob: text('mine'), now: 3000 })
  assert.equal(result.outcome, 'saved')
  assert.equal(file().content, 'mine')
  assert.equal(file().appProperties.mindspaceParentSaveId, 'other-device')
  assert.equal(result.backup.savedAt, 3000)
  assert.equal(result.backup.state, 'linked')
  assert.equal((await pushBackup(drive, result.backup, { blob: text('mine 2') })).outcome, 'saved')
})

test('replacing a read-only or trashed file writes nothing', async () => {
  const drive = fakeDrive([{ id: 'f1', name: 'Shared.mindmap', content: 'theirs', capabilities: { canEdit: false } }, { id: 'f2', name: 'Old.mindmap', content: 'old', trashed: true }])
  assert.deepEqual(await replaceBackup(drive, 'f1', { blob: text('mine') }), { outcome: 'readonly' })
  assert.deepEqual(await replaceBackup(drive, 'f2', { blob: text('mine') }), { outcome: 'trashed' })
  assert.deepEqual(drive.writes(), [])
})

test('restore records the baseline without uploading', async () => {
  const drive = fakeDrive([
    { id: 'f1', name: 'Trip.mindmap', content: 'theirs', version: '4', parents: ['dir'], appProperties: { mindspaceSaveId: 's9' } },
    { id: 'f2', name: 'By hand.mindmap', content: 'manual', parents: ['root'] },
  ])
  const restored = await restoreBackup(drive, 'f1', { now: 5000 })
  assert.equal(restored.outcome, 'ok')
  assert.equal(restored.file.name, 'Trip.mindmap')
  assert.equal(await restored.file.text(), 'theirs')
  assert.deepEqual(restored.backup, {
    fileId: 'f1', driveVersion: '4', md5Checksum: digest('theirs'), saveId: 's9', state: 'linked', name: 'Trip.mindmap', folder: 'Mindspace', savedAt: 5000,
  })
  // A file uploaded by hand has no lineage yet; the first save from here starts it.
  const manual = await restoreBackup(drive, 'f2')
  assert.equal(manual.backup.saveId, '')
  assert.equal(manual.backup.folder, '')
  assert.deepEqual(drive.writes(), [])
  assert.equal((await pushBackup(drive, manual.backup, { blob: text('edited') })).outcome, 'saved')
  assert.equal(drive.files.get('f2').appProperties.mindspaceParentSaveId, '')
})

test('restoring a trashed file is refused', async () => {
  const drive = fakeDrive([{ id: 'f1', name: 'Old.mindmap', content: 'old', trashed: true }])
  assert.deepEqual(await restoreBackup(drive, 'f1'), { outcome: 'trashed' })
  assert.deepEqual(drive.calls, [])
})

test('a write whose confirmation fails is still our own save', async () => {
  const { drive, backup, file } = await linked()
  const getMetadata = drive.getMetadata
  let reads = 0
  // The upload lands, then the sign-in runs out before the file is read back.
  drive.getMetadata = async (id) => {
    if (++reads === 2) throw Object.assign(new Error('Google sign-in is required'), { status: 401 })
    return getMetadata(id)
  }
  const result = await pushBackup(drive, backup, { blob: text('v2'), now: 2000 })
  assert.equal(result.outcome, 'saved')
  assert.deepEqual(result.backup, {
    ...backup, driveVersion: file().version, md5Checksum: digest('v2'), saveId: file().appProperties.mindspaceSaveId, savedAt: 2000,
  })
  drive.getMetadata = getMetadata
  assert.equal((await pushBackup(drive, result.backup, { blob: text('v3') })).outcome, 'saved')
})

test('a save that landed as the page closed is not a conflict after the reload', async () => {
  const { drive, backup, file } = await linked()
  let sent
  // The bytes reach Drive, the answer never reaches the page.
  drive.afterWrite = () => {
    throw Object.assign(new Error('The page is gone'), { status: 0 })
  }
  await assert.rejects(pushBackup(drive, backup, { blob: text('v2'), beforeWrite: (saveId) => (sent = saveId) }), { status: 0 })
  drive.afterWrite = null
  assert.equal(file().content, 'v2')
  // The id was handed over before the bytes went out, so it could be stored with the map.
  assert.equal(file().appProperties.mindspaceSaveId, sent)
  const reloaded = { ...backup, sentSaveId: sent }
  assert.equal(remoteCheck(backup, await drive.getMetadata(backup.fileId)), 'conflict')
  assert.equal(remoteCheck(reloaded, await drive.getMetadata(backup.fileId)), 'ok')
  const result = await pushBackup(drive, reloaded, { blob: text('v3') })
  assert.equal(result.outcome, 'saved')
  assert.equal(file().appProperties.mindspaceParentSaveId, sent)
  assert.equal('sentSaveId' in result.backup, false)
  // Somebody else's save is still somebody else's.
  drive.otherDevice(backup.fileId, 'theirs')
  assert.deepEqual(await pushBackup(drive, reloaded, { blob: text('v4') }), { outcome: 'conflict' })
})

test('what an upload attempt does to a linked map', () => {
  const backup = { fileId: 'f1', state: 'linked', saveId: 's1', md5Checksum: 'm1', name: 'Plan.mindmap', pending: true }
  const saved = { fileId: 'f1', state: 'linked', saveId: 's2', md5Checksum: 'm2', name: 'Plan.mindmap', savedAt: 5 }
  const step = (status, result, editedSince) => backupTransition(backup, status, result, editedSince)
  const quiet = { toast: null, forgetToken: false }
  assert.deepEqual(step({ status: 'saving' }, { outcome: 'saved', backup: saved }), { backup: saved, status: null, ...quiet })
  // An edit made while the upload was on its way still waits.
  assert.deepEqual(step(null, { outcome: 'saved', backup: saved }, true), { backup: { ...saved, pending: true }, status: null, ...quiet })
  assert.deepEqual(step(null, { outcome: 'conflict' }), { backup: { ...backup, state: 'conflict' }, status: null, toast: 'conflict', forgetToken: false })
  assert.deepEqual(step(null, { outcome: 'trashed' }), { backup: null, status: null, toast: 'removed', forgetToken: false })
  // Not found: maybe another Google account. Ask once, with a fresh sign-in; the second miss lets the link go.
  assert.deepEqual(step({ status: 'saving' }, { outcome: 'missing' }), { backup, status: { status: 'auth', missing: true }, toast: 'auth', forgetToken: true })
  assert.deepEqual(step({ status: 'saving', missing: true }, { outcome: 'missing' }), { backup: null, status: null, toast: 'removed', forgetToken: false })
  assert.deepEqual(step({ status: 'saving', missing: true }, { outcome: 'auth' }), { backup, status: { status: 'auth', missing: true }, toast: 'auth', forgetToken: false })
  // A toast only when the state changes.
  assert.equal(step(null, { outcome: 'auth' }).toast, 'auth')
  assert.equal(step({ status: 'auth' }, { outcome: 'auth' }).toast, null)
  assert.equal(backupTransition({ ...backup, state: 'conflict' }, null, { outcome: 'conflict' }).toast, null)
  // A lost network, a full Drive and a failed upload are states, not alarms.
  const states = [['offline', { status: 'offline' }], ['readonly', { status: 'readonly' }], ['quota', { status: 'failed', reason: 'quota' }], ['failed', { status: 'failed' }], ['blocked', { status: 'failed' }]]
  for (const [outcome, status] of states) assert.deepEqual(step(null, { outcome }), { backup, status, ...quiet }, outcome)
})

test('the first look at a map is not an edit unless the caller made one', () => {
  assert.equal(isBackupEdit(undefined, 'a'), false)
  assert.equal(isBackupEdit(undefined, 'a', true), true)
  assert.equal(isBackupEdit('a', 'a', true), false)
  assert.equal(isBackupEdit('a', 'b'), true)
})

test('which maps go out after a sign-in, and which when the user or the network is back', () => {
  const linked = { state: 'linked' }
  const pending = { state: 'linked', pending: true }
  assert.equal(resumesOnSignIn(linked, { status: 'auth' }), true)
  assert.equal(resumesOnSignIn(pending, undefined), true)
  assert.equal(resumesOnSignIn(pending, { status: 'offline' }), true)
  assert.equal(resumesOnSignIn(linked, undefined), false)
  assert.equal(resumesOnSignIn({ state: 'conflict', pending: true }, { status: 'auth' }), false)
  assert.equal(resumesOnSignIn(undefined, { status: 'auth' }), false)

  assert.equal(retriesWhenBack(linked, { status: 'offline' }, false), true)
  // An edit nobody is sending and nothing explains: e.g. a map deleted during its wait and brought back with Undo.
  assert.equal(retriesWhenBack(pending, undefined, false), true)
  assert.equal(retriesWhenBack(pending, undefined, true), false)
  assert.equal(retriesWhenBack(pending, { status: 'auth' }, false), false)
  assert.equal(retriesWhenBack(pending, { status: 'failed' }, false), false)
  assert.equal(retriesWhenBack(linked, undefined, false), false)
  assert.equal(retriesWhenBack({ state: 'conflict', pending: true }, undefined, false), false)
  assert.equal(retriesWhenBack(undefined, undefined, false), false)
})
