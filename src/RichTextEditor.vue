<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatShortcut, normalizeTextFormats, readEditorValue, sameRichText, textRuns } from './rich-text.js'

const props = defineProps({
  modelValue: { type: Object, required: true },
  maxlength: { type: Number, default: Infinity },
  multiline: Boolean,
  name: { type: String, default: '' },
  ariaLabel: { type: String, required: true },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'activate', 'format-state', 'keydown', 'focus', 'blur'])
const root = ref(null)
let savedSelection = null
const children = (node) => [...(node?.childNodes ?? [])]
const nodeLength = (node) => {
  if (node?.nodeType === 3) return String(node.data ?? '').length
  if (String(node?.nodeName ?? '').toUpperCase() === 'BR') return 1
  return children(node).reduce((sum, child) => sum + nodeLength(child), 0)
}

function offsetAt(target, targetOffset) {
  let offset = 0
  let result = null
  const visit = (node) => {
    if (result !== null) return
    if (node === target) {
      if (node.nodeType === 3) result = offset + Math.min(targetOffset, nodeLength(node))
      else result = offset + children(node).slice(0, targetOffset).reduce((sum, child) => sum + nodeLength(child), 0)
      return
    }
    if (node.nodeType === 3 || String(node.nodeName ?? '').toUpperCase() === 'BR') offset += nodeLength(node)
    else children(node).forEach(visit)
  }
  visit(root.value)
  return result
}

function pointAt(wanted) {
  let remaining = Math.max(0, wanted)
  const seek = (parent) => {
    const items = children(parent)
    for (let index = 0; index < items.length; index += 1) {
      const child = items[index]
      const length = nodeLength(child)
      if (remaining > length) {
        remaining -= length
        continue
      }
      if (child.nodeType === 3) return [child, Math.min(remaining, length)]
      if (String(child.nodeName ?? '').toUpperCase() === 'BR') return [parent, remaining ? index + 1 : index]
      return seek(child)
    }
    return [parent, items.length]
  }
  return seek(root.value)
}

function currentSelection() {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.value?.contains(selection.anchorNode) || !root.value.contains(selection.focusNode)) return null
  const anchor = offsetAt(selection.anchorNode, selection.anchorOffset)
  const focus = offsetAt(selection.focusNode, selection.focusOffset)
  return anchor === null || focus === null ? null : { from: Math.min(anchor, focus), to: Math.max(anchor, focus) }
}

function restoreSelection(range = savedSelection) {
  if (!range || !root.value) return
  const [startNode, startOffset] = pointAt(range.from)
  const [endNode, endOffset] = pointAt(range.to)
  const selection = window.getSelection()
  const domRange = document.createRange()
  domRange.setStart(startNode, startOffset)
  domRange.setEnd(endNode, endOffset)
  selection.removeAllRanges()
  selection.addRange(domRange)
}

const commands = { bold: 'bold', italic: 'italic', strike: 'strikeThrough' }
function activeStyles() {
  if (document.activeElement !== root.value) return []
  return Object.entries(commands).flatMap(([style, command]) => document.queryCommandState(command) ? [style] : [])
}
const reportState = () => emit('format-state', activeStyles())

function sync() {
  const selection = currentSelection()
  const parsed = readEditorValue(root.value)
  const text = parsed.text.slice(0, props.maxlength)
  const formats = normalizeTextFormats(text, parsed.formats)
  savedSelection = selection && { from: Math.min(selection.from, text.length), to: Math.min(selection.to, text.length) }
  emit('update:modelValue', { text, formats })
  reportState()
}

function renderModel() {
  if (!root.value) return
  const value = { text: String(props.modelValue?.text ?? ''), formats: props.modelValue?.formats }
  if (sameRichText(readEditorValue(root.value), value)) return
  const fragment = document.createDocumentFragment()
  for (const run of textRuns(value.text, value.formats)) {
    let content = document.createTextNode(run.text)
    for (const [style, tag] of [['strike', 's'], ['italic', 'em'], ['bold', 'strong']]) {
      if (!run.styles.includes(style)) continue
      const wrapper = document.createElement(tag)
      wrapper.append(content)
      content = wrapper
    }
    const span = document.createElement('span')
    span.append(content)
    fragment.append(span)
  }
  root.value.replaceChildren(fragment)
  const length = value.text.length
  if (savedSelection) savedSelection = { from: Math.min(savedSelection.from, length), to: Math.min(savedSelection.to, length) }
  nextTick(() => {
    if (document.activeElement === root.value) restoreSelection()
    reportState()
  })
}

function focus() {
  root.value?.focus()
}

function selectAll() {
  focus()
  savedSelection = { from: 0, to: props.modelValue?.text?.length ?? 0 }
  restoreSelection()
  reportState()
}

function setCaret(offset) {
  focus()
  savedSelection = { from: offset, to: offset }
  restoreSelection()
  reportState()
}

function insertText(value) {
  focus()
  restoreSelection()
  const text = props.multiline ? value : String(value).replace(/\s*\r?\n\s*/g, ' ')
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, index) => {
    if (line) document.execCommand('insertText', false, line)
    if (index < lines.length - 1) document.execCommand('insertLineBreak')
  })
  sync()
}

function toggle(style) {
  const command = commands[style]
  if (!command) return
  focus()
  restoreSelection()
  const before = currentSelection()
  document.execCommand(command)
  savedSelection = currentSelection()
  if (before?.from === before?.to) reportState()
  else sync()
}

const controller = { focus, selectAll, setCaret, insertText, toggle, activeStyles }

function onFocus(event) {
  savedSelection = currentSelection() ?? { from: 0, to: 0 }
  emit('activate', controller)
  emit('focus', event)
  reportState()
}

function onBlur(event) {
  emit('blur', event)
  emit('format-state', [])
}

function onKeydown(event) {
  const style = formatShortcut(event)
  if (style) {
    event.preventDefault()
    toggle(style)
    return
  }
  emit('keydown', event)
}

function onPaste(event) {
  event.preventDefault()
  insertText(event.clipboardData?.getData('text/plain') ?? '')
}

function onSelectionChange() {
  const selection = currentSelection()
  if (!selection) return
  savedSelection = selection
  reportState()
}

onMounted(() => {
  renderModel()
  document.addEventListener('selectionchange', onSelectionChange)
})
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))
watch(() => props.modelValue, renderModel, { deep: true })

defineExpose(controller)
</script>

<template>
  <div
    ref="root"
    contenteditable="true"
    role="textbox"
    :name="name"
    :aria-label="ariaLabel"
    :aria-multiline="multiline ? 'true' : 'false'"
    :data-placeholder="placeholder"
    spellcheck="true"
    @input="sync"
    @focus="onFocus"
    @blur="onBlur"
    @keydown="onKeydown"
    @paste="onPaste"
  ></div>
</template>
