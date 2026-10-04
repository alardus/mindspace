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

// sRGB hex ↔ OKLab: the math behind color-mix(in oklab) and oklab(from …).
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const oklab = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
  const [l, m, s] = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]
    .map(([x, y, z]) => Math.cbrt(x * r + y * g + z * b))
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
const toHex = ([L, a, b]) => {
  const [l, m, s] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b].map((v) => v ** 3)
  return `#${[[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.7076147010]]
    .map(([x, y, z]) => Math.round(Math.min(1, Math.max(0, toGamma(x * l + y * m + z * s))) * 255).toString(16).padStart(2, '0')).join('')}`
}
const hue = ([, a, b]) => (Math.atan2(b, a) * 180) / Math.PI
// Light and dark --branch-fill, in file order.
const fills = [...css.matchAll(/--branch-fill: oklab\(from color-mix\(in oklab, var\(--branch\) ([\d.]+)%, var\(--canvas\)\) (max|min)\(l, ([\d.]+)\) a b\)/g)]
  .map(([, mix, clamp, limit]) => ({ mix: mix / 100, clamp: Math[clamp], limit: Number(limit) }))

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

test('branch fills keep their hue and readable text in both themes', () => {
  assert.doesNotMatch(css, /color-mix\(in (?:oklch|lch|hsl|hwb)\b/)
  assert.equal(fills.length, 2)
  const failures = []
  for (const [tokens, fill] of [[light, fills[0]], [dark, fills[1]]]) {
    const canvas = oklab(tokens['--canvas'])
    for (const key of Object.keys(PALETTES)) for (let i = 1; i <= 6; i++) {
      const name = `--${key}-${i}`
      const branch = oklab(tokens[name])
      const [L, a, b] = branch.map((value, k) => value * fill.mix + canvas[k] * (1 - fill.mix))
      const color = toHex([fill.clamp(L, fill.limit), a, b])
      for (const fg of ['--ink', '--muted']) {
        if (contrast(tokens[fg], color) < 4.5) failures.push(`${fg} on ${name} fill ${color}: ${contrast(tokens[fg], color).toFixed(2)}`)
      }
      const drift = Math.abs(((hue(oklab(color)) - hue(branch) + 540) % 360) - 180)
      if (Math.hypot(branch[1], branch[2]) > 0.04 && drift > 30) failures.push(`${name} fill ${color} drifts ${drift.toFixed(0)}°`)
    }
  }
  assert.deepEqual(failures, [])
})
