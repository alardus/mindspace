<script setup>
import { markName } from './model.js'

defineProps({ id: { type: String, required: true }, size: { type: Number, default: 16 } })

// One path per glyph on a 20×20 circle. Dots are an h.01 segment with a round cap.
const GLYPHS = {
  important: 'M10 5.6v5.4M10 14.3h.01',
  question: 'M7.7 7.8a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.4v.3M10 14.3h.01',
  done: 'M6.2 10.2l2.6 2.6 5-5.2',
  rejected: 'M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6',
  idea: 'M10 4.9a3.4 3.4 0 0 0-2 6.2c.4.3.6.7.6 1.1v.4h2.8v-.4c0-.4.2-.8.6-1.1A3.4 3.4 0 0 0 10 4.9zM8.8 15h2.4',
  warning: 'M10 5.4l4.6 8.3H5.4zM10 8.8v1.8M10 12.2h.01',
  deadline: 'M10 5.3a4.7 4.7 0 1 1 0 9.4a4.7 4.7 0 1 1 0-9.4zM10 7.6V10l1.7 1.3',
  owner: 'M10 5.6a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4zM6.4 14.6a3.6 3.6 0 0 1 7.2 0',
  favorite: 'M10 5.2l1.4 3 3.2.3-2.4 2.1.7 3.2L10 12.2l-2.9 1.6.7-3.2-2.4-2.1 3.2-.3z',
  milestone: 'M7.2 14.8V5.4M7.2 5.6h6l-1.5 2.3 1.5 2.3h-6',
}
// White does not reach contrast on yellow and orange; Milestone has its own glyph color because it flips with the theme.
const GLYPH_TONES = { idea: 'dark', warning: 'dark', milestone: 'milestone' }
const FILLED = ['favorite', 'milestone']
const glyph = (id) => `var(--icon-glyph-${GLYPH_TONES[id] ?? 'light'})`
</script>

<template>
  <svg class="mark-icon" :width="size" :height="size" viewBox="0 0 20 20" role="img" :aria-label="markName(id)">
    <circle cx="10" cy="10" r="10" :style="{ fill: `var(--icon-${id})`, stroke: 'none' }" />
    <path
      :d="GLYPHS[id]"
      :stroke-width="id === 'favorite' ? 1 : 1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="{ fill: FILLED.includes(id) ? glyph(id) : 'none', stroke: glyph(id) }"
    />
  </svg>
</template>
