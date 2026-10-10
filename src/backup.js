// Google Drive backup: every decision lives here as plain functions, so it runs under node --test.
// Talking to Google is google-drive.js; reactive state and the UI are App.vue.

export const BACKUP_DELAY = 5000

// What counts as an edit worth uploading. Positions of an auto-layout map are derived and drift between devices
// (fonts measure differently), so a map that was only opened must not look changed.
export const backupKey = (map) => JSON.stringify(map, (key, value) => (key === 'position' && map.autoLayout ? undefined : value))

export const backupFileName = (title) => `${String(title ?? '').trim() || 'Untitled'}.mindmap`

// Compares the Drive file with the baseline of the last upload or restore. A rename, move or other metadata-only
// change is fine; different content or a save made by another device is not. Without a baseline (the user asked
// to overwrite the file) only a trashed or read-only file stops the write.
export function remoteCheck(backup, meta) {
  if (meta.trashed) return 'trashed'
  if (meta.capabilities?.canEdit === false) return 'readonly'
  if (!backup) return 'ok'
  const sameContent = meta.md5Checksum === backup.md5Checksum
  const sameLineage = (meta.appProperties?.mindspaceSaveId ?? '') === backup.saveId
  return sameContent && sameLineage ? 'ok' : 'conflict'
}

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
