// Google Drive backup: every decision lives here as plain functions, so it runs under node --test.
// Talking to Google is google-drive.js; reactive state and the UI are App.vue.

export const BACKUP_DELAY = 5000

// What counts as an edit worth uploading. In an auto-layout map the layout derives where a node sits, on which side
// of the root its branch lands and how its line attaches — from measured text, so it drifts between devices.
// A map that was only opened must not look changed.
const DERIVED_BY_LAYOUT = new Set(['position', 'side', 'sourceHandle', 'targetHandle'])
export const backupKey = (map) => JSON.stringify(map, (key, value) => (map.autoLayout && DERIVED_BY_LAYOUT.has(key) ? undefined : value))

export const backupFileName = (title) => `${String(title ?? '').trim() || 'Untitled'}.mindmap`

// Compares the Drive file with the baseline of the last upload or restore. A rename, move or other metadata-only
// change is fine; different content or a save made by another device is not. Without a baseline (the user asked
// to overwrite the file) only a trashed or read-only file stops the write.
const saveIdOf = (meta) => meta.appProperties?.mindspaceSaveId ?? ''

export function remoteCheck(backup, meta) {
  if (meta.trashed) return 'trashed'
  if (meta.capabilities?.canEdit === false) return 'readonly'
  if (!backup) return 'ok'
  const saveId = saveIdOf(meta)
  // A save of ours that reached Drive although its confirmation never reached the page (closed tab, dropped connection).
  if (backup.sentSaveId && saveId === backup.sentSaveId) return 'ok'
  return meta.md5Checksum === backup.md5Checksum && saveId === backup.saveId ? 'ok' : 'conflict'
}

// The first look at a map in a session only takes the mark to compare with — unless the caller made the edit itself.
export const isBackupEdit = (seen, key, certain = false) => seen !== key && (seen !== undefined || certain)

const QUOTA_REASONS = ['storageQuotaExceeded', 'teamDriveFileLimitExceeded']
const READONLY_REASONS = ['insufficientFilePermissions', 'appNotAuthorizedToFile']

export function errorKind(error) {
  if (error?.kind) return error.kind
  const { status, reason = '' } = error ?? {}
  if (typeof status !== 'number') return 'failed'
  if (status === 0 || status === 429 || status >= 500 || /RateLimitExceeded$/.test(reason)) return 'offline'
  if (status === 401) return 'auth'
  if (status === 404) return 'missing'
  if (status === 403 && QUOTA_REASONS.includes(reason)) return 'quota'
  if (status === 403 && READONLY_REASONS.includes(reason)) return 'readonly'
  return 'failed'
}

// What a Drive action started by the user says when it fails. A cancelled popup and an expired sign-in say nothing here.
export const DRIVE_MESSAGES = {
  offline: 'Can’t reach Google Drive. Check your connection and try again.',
  quota: 'Your Google Drive is out of space.',
  readonly: 'That file is read-only. Choose another file or save to a new one.',
  missing: 'That file is no longer in Google Drive.',
  blocked: 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  failed: 'Google Drive didn’t respond as expected. Try again.',
}

// The state the user sees: the persisted conflict wins, then whatever this session knows, else all is well.
export function backupUi(backup, session) {
  if (!backup) return 'off'
  if (backup.state === 'conflict') return 'conflict'
  return session?.status ?? 'saved'
}

// What one upload attempt does to a linked map: the link to keep (null lets it go), the session status, the toast
// its change of state calls for (none while the state stays the same), and whether the sign-in is to be forgotten.
export function backupTransition(backup, status, result, editedSince = false) {
  const missing = status?.missing ? { missing: true } : {}
  let next = { backup, status: { status: 'failed' } }
  let forgetToken = false
  if (result.outcome === 'saved') {
    // An edit made while the upload was on its way still waits for the next one.
    next = { backup: editedSince ? { ...result.backup, pending: true } : result.backup, status: null }
  } else if (result.outcome === 'conflict') next = { backup: { ...backup, state: 'conflict' }, status: null }
  else if (result.outcome === 'trashed' || (result.outcome === 'missing' && status?.missing)) next = { backup: null, status: null }
  else if (result.outcome === 'missing') {
    // Maybe just another Google account: ask to sign in once more, afresh, before letting the link go.
    next.status = { status: 'auth', missing: true }
    forgetToken = true
  } else if (result.outcome === 'auth') next.status = { status: 'auth', ...missing }
  else if (result.outcome === 'readonly' || result.outcome === 'offline') next.status = { status: result.outcome }
  else if (result.outcome === 'quota') next.status = { status: 'failed', reason: 'quota' }
  const after = backupUi(next.backup ?? undefined, next.status)
  const toast = after === backupUi(backup, status) ? null : ({ off: 'removed', conflict: 'conflict', auth: 'auth' }[after] ?? null)
  return { ...next, toast, forgetToken }
}

// After a sign-in: every linked map that was paused for it or still has an edit to send.
export const resumesOnSignIn = (backup, status) => backup?.state === 'linked' && (status?.status === 'auth' || Boolean(backup.pending))

// When the network or the user is back: a map that waited for the network, and a map with an edit that nobody
// is sending and no state explains (e.g. deleted during its wait and brought back with Undo).
export const retriesWhenBack = (backup, status, busy) => backup?.state === 'linked'
  && (status?.status === 'offline' || (Boolean(backup.pending) && !status && !busy))

// tone colors the status dot and text; badge puts the mark on the toolbar cloud; label is the cloud's title;
// say is read out once when the state is entered; alert is the block that asks for a reaction.
export const BACKUP_VIEW = {
  saving: { status: 'Saving…', tone: 'idle', label: 'Saving to Google Drive' },
  saved: { tone: 'ok', label: 'Saved on this device and in Google Drive', say: 'Saved to Google Drive' },
  offline: {
    status: 'Waiting for network',
    tone: 'idle',
    badge: true,
    label: 'Google Drive: waiting for network',
    say: 'Google Drive: waiting for network',
    note: 'Can’t reach Google Drive. Your changes will be sent as soon as it’s back.',
  },
  failed: {
    status: 'Not saved',
    tone: 'idle',
    badge: true,
    label: 'Google Drive: not saved',
    say: 'Google Drive: not saved',
    note: 'Couldn’t upload. Will try again after the next change.',
    quotaNote: 'Couldn’t upload — your Google Drive is out of space.',
  },
  auth: {
    status: 'Paused',
    tone: 'warn',
    badge: true,
    label: 'Google Drive: sign in again',
    say: 'Google Drive copy paused: sign in again',
    alert: { title: 'Google sign-in expired.', text: 'Changes are saved on this device and will go to Drive once you sign in — to the same file.' },
  },
  conflict: {
    status: 'Stopped',
    tone: 'warn',
    badge: true,
    label: 'Google Drive: the copy was changed elsewhere',
    say: 'Google Drive copy stopped: it was changed elsewhere',
    alert: { title: 'The copy was changed elsewhere.', text: 'To keep everything safe, “{name}” is no longer updated. This device keeps saving everything.' },
  },
  readonly: {
    status: 'Stopped',
    tone: 'warn',
    badge: true,
    label: 'Google Drive: no permission to edit',
    say: 'Google Drive copy stopped: no permission to edit',
    alert: { title: 'No permission to edit.', text: '“{name}” is read-only. This device keeps saving everything.' },
  },
}

// One Drive file backs one local map: two maps on the same file would stop each other forever.
export const linkedDocument = (documents, fileId, exceptId) => documents
  .find((document) => document.id !== exceptId && document.googleDriveBackup?.fileId === fileId)

// Per map: an edit waits out the delay, one upload runs at a time, and a change made during an upload
// earns exactly one more upload after it. A failing run is the caller's to report; the queue just goes on.
export function createBackupQueue(run, delay = BACKUP_DELAY) {
  const jobs = new Map()
  const job = (id) => {
    if (!jobs.has(id)) jobs.set(id, { timer: null, running: false, again: false })
    return jobs.get(id)
  }

  function schedule(id) {
    const state = job(id)
    if (state.running) {
      state.again = true
      return
    }
    clearTimeout(state.timer)
    state.timer = setTimeout(() => now(id), delay)
  }

  async function now(id) {
    const state = job(id)
    if (state.running) {
      state.again = true
      return
    }
    clearTimeout(state.timer)
    state.timer = null
    state.running = true
    try {
      await run(id)
    } catch {
      // Reported by run itself.
    } finally {
      state.running = false
      if (state.again) {
        state.again = false
        schedule(id)
      }
    }
  }

  return { schedule, now, busy: (id) => Boolean(jobs.get(id)?.running || jobs.get(id)?.timer) }
}

// What gets persisted with the map: the link, the state of the Drive file to compare against next time,
// and what the Storage block shows without asking Drive.
async function baseline(drive, meta, now) {
  return {
    fileId: meta.id,
    driveVersion: meta.version ?? '',
    md5Checksum: meta.md5Checksum ?? '',
    saveId: saveIdOf(meta),
    state: 'linked',
    name: meta.name ?? '',
    folder: await drive.folderLabel(meta.parents?.[0]),
    savedAt: now,
  }
}

// Every write carries a new save id and the id it replaces. Drive has no compare-and-swap for file content, so the
// file is read back: a save id that is no longer ours means another device wrote in between.
// beforeWrite gets the new id while nothing is sent yet, so it can be stored with the map.
async function write(drive, fileId, { title, blob, parentSaveId, now, beforeWrite }) {
  const saveId = globalThis.crypto.randomUUID()
  beforeWrite?.(saveId)
  const appProperties = { mindspaceSaveId: saveId, mindspaceParentSaveId: parentSaveId, mindspaceFormat: 'mindmap' }
  const written = fileId
    ? await drive.updateFile(fileId, { blob, appProperties })
    : await drive.createFile({ name: backupFileName(title), folderId: (await drive.ensureFolder()).id, blob, appProperties })
  // If the read-back fails (the sign-in ran out, the network dropped), the answer to the write itself is the baseline:
  // the bytes are in Drive, and not knowing our own save would report it as someone else's next time.
  const meta = await drive.getMetadata(written.id).catch(() => written)
  if (saveIdOf(meta) !== saveId) return { outcome: 'conflict' }
  return { outcome: 'saved', backup: await baseline(drive, meta, now) }
}

// A new file in the Mindspace folder.
export async function createBackup(drive, { title, blob, now = Date.now() }) {
  const result = await write(drive, null, { title, blob, parentSaveId: '', now })
  if (result.outcome !== 'saved') throw new Error('The new backup changed while it was being created')
  return result.backup
}

// The regular upload: only onto the file as this device last left it.
export async function pushBackup(drive, backup, { blob, now = Date.now(), beforeWrite }) {
  const meta = await drive.getMetadata(backup.fileId)
  const check = remoteCheck(backup, meta)
  if (check !== 'ok') return { outcome: check }
  return write(drive, backup.fileId, { blob, parentSaveId: saveIdOf(meta), now, beforeWrite })
}

// The user confirmed replacing this file with the local map, whatever it holds.
export async function replaceBackup(drive, fileId, { blob, now = Date.now() }) {
  const meta = await drive.getMetadata(fileId)
  const check = remoteCheck(null, meta)
  if (check !== 'ok') return { outcome: check }
  return write(drive, fileId, { blob, parentSaveId: saveIdOf(meta), now })
}

// Downloads the file and takes it as the baseline. Nothing is written: the first local edit starts the uploads.
export async function restoreBackup(drive, fileId, { now = Date.now() } = {}) {
  const meta = await drive.getMetadata(fileId)
  if (meta.trashed) return { outcome: 'trashed' }
  const blob = await drive.downloadFile(fileId)
  return { outcome: 'ok', file: new File([blob], meta.name), backup: await baseline(drive, meta, now) }
}
