import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTextFormats, textRuns, toggleTextFormat, trimRichText } from '../src/rich-text.js'

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
