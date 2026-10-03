<script setup>
defineProps({ size: { type: Number, default: 30 }, title: { type: String, default: 'mindspace' } })
</script>

<template>
  <svg class="logo" :width="size" :height="size" viewBox="0 0 32 32" role="img" :aria-label="title">
    <polyline points="6,25 6,8 16,18 26,8 26,25" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="6" cy="25" r="2.6" /><circle cx="6" cy="8" r="2.6" />
    <circle cx="26" cy="8" r="2.6" /><circle cx="26" cy="25" r="2.6" />
    <circle cx="16" cy="18" r="3.2" fill="#E9A23B" />
  </svg>
</template>
