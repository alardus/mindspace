import test from 'node:test'
import assert from 'node:assert/strict'
import { formatShortcut, normalizeTextFormats, readEditorValue, safeTextHref, sameRichText, textRuns, toggleTextFormat, trimRichText } from '../src/rich-text.js'

const domText = (data) => ({ nodeType: 3, data })
const domElement = (name, ...childNodes) => ({ nodeType: 1, nodeName: name.toUpperCase(), childNodes })

test('format ranges validate, sort, deduplicate and merge the same style', () => {
  assert.deepEqual(normalizeTextFormats('A🙂BC', [
    { from: 3, to: 4, style: 'bold' },
    { from: 1, to: 3, style: 'bold' },
    { from: 1, to: 3, style: 'bold' },
    { from: 4, to: 99, style: 'italic' },
  ]), [
    { from: 1, to: 4, style: 'bold' },
    { from: 4, to: 5, style: 'italic' },
  ])
})

test('malformed ranges and boundaries inside an emoji are discarded', () => {
  assert.deepEqual(normalizeTextFormats('A🙂BC', [
    { from: 1, to: 3, style: 'bold' },
    { from: 3, to: 4, style: 'bold' },
    { from: 2, to: 4, style: 'italic' },
    { from: 0, to: 1, style: 'unknown' },
    { from: NaN, to: 1, style: 'strike' },
    { from: 4, to: 4, style: 'strike' },
  ]), [{ from: 1, to: 4, style: 'bold' }])
})

test('different styles retain overlapping ranges', () => {
  assert.deepEqual(normalizeTextFormats('abcdef', [
    { from: 0, to: 4, style: 'bold' },
    { from: 2, to: 6, style: 'italic' },
    { from: 3, to: 5, style: 'strike' },
  ]), [
    { from: 0, to: 4, style: 'bold' },
    { from: 2, to: 6, style: 'italic' },
    { from: 3, to: 5, style: 'strike' },
  ])
})

test('trimming and length limiting shift and clip formats with the text', () => {
  assert.deepEqual(trimRichText('  Hello world  ', [
    { from: 2, to: 7, style: 'bold' },
    { from: 8, to: 13, style: 'italic' },
  ], 8), {
    text: 'Hello wo',
    formats: [
      { from: 0, to: 5, style: 'bold' },
      { from: 6, to: 8, style: 'italic' },
    ],
  })
})

test('format toggle adds a missing style and removes it only when the whole selection has it', () => {
  const text = 'abcdef'
  const formats = [
    { from: 0, to: 2, style: 'bold' },
    { from: 4, to: 6, style: 'bold' },
    { from: 2, to: 4, style: 'italic' },
  ]
  const added = toggleTextFormat(text, formats, 'bold', 1, 5)
  assert.deepEqual(added, [
    { from: 0, to: 6, style: 'bold' },
    { from: 2, to: 4, style: 'italic' },
  ])
  assert.deepEqual(toggleTextFormat(text, added, 'bold', 1, 5), [
    { from: 0, to: 1, style: 'bold' },
    { from: 2, to: 4, style: 'italic' },
    { from: 5, to: 6, style: 'bold' },
  ])
  assert.deepEqual(toggleTextFormat(text, formats, 'bold', 3, 3), normalizeTextFormats(text, formats))
})

test('text runs combine crossing styles with link and search annotations', () => {
  assert.deepEqual(textRuns('Docs', [{ from: 1, to: 3, style: 'bold' }], [
    { from: 0, to: 4, href: 'https://example.com' },
    { from: 2, to: 4, match: true },
  ]), [
    { from: 0, to: 1, text: 'D', styles: [], href: 'https://example.com' },
    { from: 1, to: 2, text: 'o', styles: ['bold'], href: 'https://example.com' },
    { from: 2, to: 3, text: 'c', styles: ['bold'], href: 'https://example.com', match: true },
    { from: 3, to: 4, text: 's', styles: [], href: 'https://example.com', match: true },
  ])
})

test('read-only links accept only absolute web URLs', () => {
  assert.equal(safeTextHref('https://example.com/docs'), 'https://example.com/docs')
  assert.equal(safeTextHref('http://example.org'), 'http://example.org')
  assert.equal(safeTextHref('javascript:alert(1)'), null)
  assert.equal(safeTextHref('/relative'), null)
})

test('editor DOM becomes plain text and supported formatting ranges', () => {
  const root = domElement('div',
    domElement('strong', domText('Bold '), domElement('em', domText('both'))),
    domElement('br'),
    domElement('s', domText('gone')),
    domElement('b', domText('B')),
    domElement('i', domText('I')),
    domElement('strike', domText('S')),
    domElement('del', domText('D')),
  )

  assert.deepEqual(readEditorValue(root), {
    text: 'Bold both\ngoneBISD',
    formats: [
      { from: 0, to: 9, style: 'bold' },
      { from: 5, to: 9, style: 'italic' },
      { from: 10, to: 14, style: 'strike' },
      { from: 14, to: 15, style: 'bold' },
      { from: 15, to: 16, style: 'italic' },
      { from: 16, to: 18, style: 'strike' },
    ],
  })
})

test('editor DOM after deletion and replacement keeps styles on the surviving characters', () => {
  const root = domElement('div', domElement('strong', domText('ac')), domElement('em', domText('X')))

  assert.deepEqual(readEditorValue(root), {
    text: 'acX',
    formats: [
      { from: 0, to: 2, style: 'bold' },
      { from: 2, to: 3, style: 'italic' },
    ],
  })
})

test('unsupported pasted markup contributes text but no stored markup or style', () => {
  const unsafe = { ...domElement('span', domText('click')), onclick: 'steal()' }
  const root = domElement('div', domText('Safe '), unsafe, domElement('script', domText(' alert(1)')))

  assert.deepEqual(readEditorValue(root), { text: 'Safe click alert(1)', formats: [] })
})

test('rich text equality ignores range order and rejects different editor content', () => {
  const value = { text: 'Undo', formats: [{ from: 0, to: 4, style: 'bold' }, { from: 1, to: 3, style: 'italic' }] }
  assert.equal(sameRichText(value, { text: 'Undo', formats: value.formats.toReversed() }), true)
  assert.equal(sameRichText(value, { text: 'UndoUndo', formats: value.formats }), false)
  assert.equal(sameRichText(value, { text: 'Undo', formats: [] }), false)
})

test('format shortcuts recognize Mod-B, Mod-I and Mod-Shift-X only', () => {
  assert.equal(formatShortcut({ code: 'KeyB', metaKey: true }), 'bold')
  assert.equal(formatShortcut({ code: 'KeyI', ctrlKey: true }), 'italic')
  assert.equal(formatShortcut({ code: 'KeyX', ctrlKey: true, shiftKey: true }), 'strike')
  assert.equal(formatShortcut({ code: 'KeyX', ctrlKey: true }), null)
  assert.equal(formatShortcut({ code: 'KeyB', metaKey: true, shiftKey: true }), null)
  assert.equal(formatShortcut({ code: 'KeyI' }), null)
})
