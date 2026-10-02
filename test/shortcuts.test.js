import test from 'node:test'
import assert from 'node:assert/strict'
import { SHORTCUTS, SHORTCUT_GROUPS, findShortcut, keyLabel, shortcutGroups, shortcutKeys } from '../src/shortcuts.js'

const key = (init) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init })

test('keydown events resolve to registry entries', () => {
  assert.equal(findShortcut(key({ key: 'Tab' })).id, 'addChild')
  assert.equal(findShortcut(key({ key: 'Backspace' })).id, 'remove')
  assert.equal(findShortcut(key({ key: 'z', metaKey: true })).id, 'undo')
  assert.equal(findShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true })).id, 'redo')
  assert.equal(findShortcut(key({ key: 'y', ctrlKey: true })).id, 'redo')
  assert.equal(findShortcut(key({ key: 'ArrowLeft', altKey: true })).id, 'collapse')
  assert.equal(findShortcut(key({ key: '?', shiftKey: true, code: 'Slash' })).id, 'help')
  // Russian layout: Shift+/ types a comma.
  assert.equal(findShortcut(key({ key: ',', shiftKey: true, code: 'Slash' })).id, 'help')
  assert.equal(findShortcut(key({ key: 'a' })), undefined)
  assert.equal(findShortcut(key({ key: 'ArrowLeft' })), undefined)
})

test('modifier names follow the platform', () => {
  assert.deepEqual(shortcutKeys('redo', true), ['⇧', '⌘', 'Z'])
  assert.deepEqual(shortcutKeys('redo', false), ['Shift', 'Ctrl', 'Z'])
  assert.deepEqual(shortcutKeys('collapse', false), ['Alt', '←'])
  assert.equal(keyLabel('Delete', false), 'Del')
  assert.equal(keyLabel('Tab', true), 'Tab')
})

test('help groups cover every registry entry in group order', () => {
  const groups = shortcutGroups(false)
  assert.deepEqual(groups.map((group) => group.title), SHORTCUT_GROUPS)
  assert.equal(groups.flatMap((group) => group.items).length, SHORTCUTS.length)
  assert.ok(groups.every((group) => group.items.length))
})
