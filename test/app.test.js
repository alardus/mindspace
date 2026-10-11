import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('icon menu outside pointer listener runs before propagation can be stopped', () => {
  assert.match(app, /addEventListener\('pointerdown', onWindowPointerDown, true\)/)
  assert.match(app, /removeEventListener\('pointerdown', onWindowPointerDown, true\)/)
})
