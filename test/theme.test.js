import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PALETTES, paint } from '../src/model.js'

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const block = (selector) => Object.fromEntries([...css.split(`${selector} {`)[1].split('\n}')[0]
  .matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(([, name, value]) => [name, value]))
const light = block(':root')
const dark = { ...light, ...block(':root[data-theme="dark"]') }

const luminance = (hex) => [1, 3, 5]
  .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('palette colors resolve to theme variables that match the model', () => {
  for (const [key, palette] of Object.entries(PALETTES)) {
    palette.colors.forEach((color, index) => {
      assert.equal(paint(color), `var(--${key}-${index + 1})`)
      assert.equal(light[`--${key}-${index + 1}`], color)
      assert.ok(dark[`--${key}-${index + 1}`])
    })
  }
  assert.equal(paint('#123456'), '#123456')
})

test('dark theme meets the contrast targets', () => {
  const failures = []
  const check = (fg, bg, min) => {
    const ratio = contrast(dark[fg], dark[bg])
    if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`)
  }
  for (const fg of ['--ink', '--text-2', '--muted', '--muted-2']) {
    for (const bg of ['--canvas', '--surface', '--surface-panel', '--selected']) check(fg, bg, 4.5)
  }
  check('--danger', '--surface', 4.5)
  check('--danger', '--danger-bg', 4.5)
  for (const key of Object.keys(PALETTES)) for (let i = 1; i <= 6; i++) check(`--${key}-${i}`, '--canvas', 3)
  for (const bg of ['--canvas', '--surface', '--surface-panel', '--surface-raised', '--selected']) check('--focus', bg, 3)
  assert.deepEqual(failures, [])
})
