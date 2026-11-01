<script setup>
import { computed, defineComponent, h } from 'vue'
import { safeTextHref, textRuns } from './rich-text.js'

const props = defineProps({
  text: { type: String, default: '' },
  formats: { type: Array, default: () => [] },
  annotations: { type: Array, default: () => [] },
})
const emit = defineEmits(['link-click'])

const runs = computed(() => textRuns(props.text, props.formats, props.annotations))
const RichRun = defineComponent({
  props: { run: { type: Object, required: true } },
  setup(runProps) {
    return () => {
      let content = runProps.run.text
      if (runProps.run.styles.includes('strike')) content = h('s', content)
      if (runProps.run.styles.includes('italic')) content = h('em', content)
      if (runProps.run.styles.includes('bold')) content = h('strong', content)
      if (runProps.run.match) content = h('mark', content)
      const href = safeTextHref(runProps.run.href)
      return href ? h('a', {
        class: 'node-link nodrag',
        href,
        target: '_blank',
        rel: 'noopener',
        onClick: (event) => emit('link-click', event),
      }, content) : content
    }
  },
})
</script>

<template><RichRun v-for="run in runs" :key="`${run.from}:${run.to}`" :run="run" /></template>
