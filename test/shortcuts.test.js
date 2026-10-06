import test from 'node:test'
import assert from 'node:assert/strict'
import * as shortcuts from '../src/shortcuts.js'

const { SHORTCUTS, SHORTCUT_GROUPS, findShortcut, keyLabel, shortcutGroups, shortcutKeys } = shortcuts

const key = (init) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init })

test('keydown events resolve to registry entries', () => {
  assert.equal(findShortcut(key({ key: 'Tab' })).id, 'addChild')
  assert.equal(findShortcut(key({ key: 'Tab', shiftKey: true })), undefined)
  assert.equal(findShortcut(key({ key: 'Backspace' })).id, 'remove')
  assert.equal(findShortcut(key({ key: 'z', metaKey: true })).id, 'undo')
  assert.equal(findShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true })).id, 'redo')
  assert.equal(findShortcut(key({ key: 'y', ctrlKey: true })).id, 'redo')
  assert.equal(findShortcut(key({ key: 'ArrowLeft', altKey: true })).id, 'collapse')
  assert.equal(findShortcut(key({ key: 'ArrowLeft' })).id, 'navigate')
  assert.equal(findShortcut(key({ key: '?', shiftKey: true, code: 'Slash' })).id, 'help')
  // Russian layout: Shift+/ types a comma.
  assert.equal(findShortcut(key({ key: ',', shiftKey: true, code: 'Slash' })).id, 'help')
  assert.equal(findShortcut(key({ key: 'f', metaKey: true })).id, 'search')
  // Russian layout: Cmd+F types “а”.
  assert.equal(findShortcut(key({ key: 'а', code: 'KeyF', ctrlKey: true })).id, 'search')
  assert.equal(findShortcut(key({ key: 'a' })), undefined)
})

test('modifier names follow the platform', () => {
  assert.deepEqual(shortcutKeys('redo', true), ['⇧', '⌘', 'Z'])
  assert.deepEqual(shortcutKeys('redo', false), ['Shift', 'Ctrl', 'Z'])
  assert.deepEqual(shortcutKeys('collapse', false), ['Alt', '←'])
  assert.equal(keyLabel('Delete', false), 'Del')
  assert.equal(keyLabel('Tab', true), 'Tab')
  assert.deepEqual(shortcutKeys('zoom', true), ['⌘', 'wheel'])
  assert.deepEqual(shortcutKeys('zoom', false), ['Ctrl', 'wheel'])
})

test('primary modifier accepts Cmd and Ctrl clicks', () => {
  assert.equal(shortcuts.hasMod?.(key({ metaKey: true })), true)
  assert.equal(shortcuts.hasMod?.(key({ ctrlKey: true })), true)
  assert.equal(shortcuts.hasMod?.(key({})), false)
})

test('help groups cover every registry entry in group order', () => {
  const groups = shortcutGroups(false)
  assert.deepEqual(groups.map((group) => group.title), SHORTCUT_GROUPS)
  assert.equal(groups.flatMap((group) => group.items).length, SHORTCUTS.length)
  assert.ok(groups.every((group) => group.items.length))
  assert.deepEqual(groups.find((group) => group.title === 'Editing').items
    .find((item) => item.id === 'noteLine').bindings, [['Tab'], ['Shift', 'Enter']])
  assert.deepEqual(groups.find((group) => group.title === 'General').items
    .find((item) => item.id === 'redo').bindings, [['Shift', 'Ctrl', 'Z'], ['Ctrl', 'Y']])
  assert.deepEqual(shortcutKeys('theme', true), ['⇧', '⌘', 'L'])
  assert.equal(findShortcut({ key: 'L', code: 'KeyL', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }).id, 'theme')
  assert.deepEqual(groups.find((group) => group.title === 'Canvas').items
    .find((item) => item.id === 'pan').bindings, [['Space', 'drag']])
  assert.deepEqual(groups.find((group) => group.title === 'Canvas').items
    .find((item) => item.id === 'zoom').bindings, [['Ctrl', 'wheel']])
  assert.deepEqual(shortcutGroups(true).find((group) => group.title === 'Canvas').items
    .find((item) => item.id === 'zoom').bindings, [['⌘', 'wheel']])
  assert.deepEqual(groups.find((group) => group.title === 'Maps').items
    .map((item) => item.id), ['mapNavigate', 'mapOpen', 'mapRename', 'mapDuplicate', 'mapDelete', 'mapMenu'])
})

test('branch copy and canvas paste are reference-only shortcuts', () => {
  const items = shortcutGroups(false).find((group) => group.title === 'Nodes').items
  const copy = items.find((item) => item.id === 'copyBranch')
  const paste = items.find((item) => item.id === 'paste')

  assert.deepEqual(copy.keys, ['Ctrl', 'C'])
  assert.deepEqual(paste.keys, ['Ctrl', 'V'])
  assert.equal(findShortcut(key({ key: 'c', ctrlKey: true })), undefined)
  assert.equal(findShortcut(key({ key: 'v', ctrlKey: true })), undefined)
})

test('select all targets every visible canvas block', () => {
  assert.equal(findShortcut(key({ key: 'a', metaKey: true }))?.id, 'selectAll')
  assert.equal(findShortcut(key({ key: 'ф', code: 'KeyA', ctrlKey: true }))?.id, 'selectAll')
  assert.equal(findShortcut(key({ key: 'a' })), undefined)

  const nodes = [
    { id: 'visible', hidden: false, selected: false },
    { id: 'hidden', hidden: true, selected: true },
  ]
  assert.equal(typeof shortcuts.selectAllCanvasNodes, 'function')
  shortcuts.selectAllCanvasNodes?.(nodes)
  assert.deepEqual(nodes.map((node) => node.selected), [true, false])
})
