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

test('link gesture uses Shift on every platform', () => {
  assert.equal(shortcuts.hasLinkMod?.(key({ shiftKey: true })), true)
  assert.equal(shortcuts.hasLinkMod?.(key({ metaKey: true })), false)
  assert.equal(shortcuts.hasLinkMod?.(key({ ctrlKey: true })), false)
  assert.deepEqual(shortcutKeys('link', true), ['⇧', 'drag from block'])
  assert.deepEqual(shortcutKeys('link', false), ['Shift', 'drag from block'])
  assert.deepEqual(shortcutGroups(false).find((group) => group.title === 'Links').items.map((item) => [item.id, ...item.keys]),
    [['link', 'Shift', 'drag from block'], ['linkRemove', 'Del'], ['linkCancel', 'Esc']])
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
  const selected = shortcuts.selectAllCanvasObjects?.(
    nodes,
    [{ id: 'mark-1' }, { id: 'mark-2' }],
    [{ id: 'text-1' }],
  )
  assert.deepEqual(nodes.map((node) => node.selected), [true, false])
  assert.deepEqual(selected, { markIds: ['mark-1', 'mark-2'], textIds: ['text-1'] })
})

test('typing targets one text block but not a mixed canvas selection', () => {
  assert.deepEqual(shortcuts.typingTarget?.([], new Set(), new Set(['text-1'])), { type: 'text', id: 'text-1' })
  assert.deepEqual(shortcuts.typingTarget?.([{ id: 'node-1' }], new Set(), new Set()), { type: 'node', id: 'node-1' })
  assert.equal(shortcuts.typingTarget?.([], new Set(['mark-1']), new Set()), null)
  assert.equal(shortcuts.typingTarget?.([{ id: 'node-1' }], new Set(), new Set(['text-1'])), null)
})

test('icon keys are bare: digits and I, never with a modifier', () => {
  assert.equal(findShortcut(key({ key: 'i', code: 'KeyI' }))?.id, 'marks')
  // Shift+I and Cmd+I stay free: a capital letter starts a title, Cmd+I belongs to the browser.
  assert.equal(findShortcut(key({ key: 'I', code: 'KeyI', shiftKey: true })), undefined)
  assert.equal(findShortcut(key({ key: 'i', code: 'KeyI', metaKey: true })), undefined)
  for (const digit of '1234567890') assert.equal(findShortcut(key({ key: digit }))?.id, 'mark')
  assert.equal(findShortcut(key({ key: '1', ctrlKey: true })), undefined)
  assert.equal(findShortcut(key({ key: '1', altKey: true })), undefined)
  assert.equal(findShortcut(key({ key: '!', code: 'Digit1', shiftKey: true })), undefined)
  assert.equal(findShortcut(key({ key: 'd', metaKey: true }))?.id, 'duplicateMark')
  assert.deepEqual(shortcutGroups(true).find((group) => group.title === 'Icons').items.map((item) => item.id),
    ['marks', 'mark', 'markStep', 'markRemove', 'duplicateMark'])
})
