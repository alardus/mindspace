import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { BACKUP_VIEW, DRIVE_MESSAGES, backupFileName, backupKey, backupUi, createBackupQueue, errorKind, linkedDocument, remoteCheck } from '../src/backup.js'

test('auto-layout positions are not an edit, manual positions are', () => {
  const map = (x, autoLayout) => ({ title: 'A', autoLayout, nodes: [{ id: 'n', position: { x, y: 0 }, data: { label: 'One' } }] })
  assert.equal(backupKey(map(0, true)), backupKey(map(40, true)))
  assert.notEqual(backupKey(map(0, false)), backupKey(map(40, false)))
  assert.notEqual(backupKey(map(0, true)), backupKey({ ...map(0, true), title: 'B' }))
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
