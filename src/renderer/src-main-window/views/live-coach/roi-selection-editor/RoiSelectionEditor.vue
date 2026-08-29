<template>
  <div
    ref="container"
    class="relative aspect-video w-full overflow-hidden rounded border border-gray-200 bg-gray-950 dark:border-gray-700"
  >
    <img
      v-if="imageDataUrl"
      class="h-full w-full object-fill select-none"
      :src="imageDataUrl"
      :alt="imageAlt"
      draggable="false"
    />
    <div v-else class="flex h-full items-center justify-center text-sm text-gray-400">
      {{ emptyText }}
    </div>

    <div
      v-if="modelValue"
      class="absolute cursor-move border-2 border-yellow-400 bg-yellow-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
      :style="roiStyle"
      :aria-label="roiAriaLabel"
      tabindex="0"
      @keydown="nudgeRoi"
      @pointerdown="startInteraction($event, 'move')"
    >
      <div
        class="absolute -top-1.5 -left-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-black bg-yellow-300"
        @pointerdown.stop="startInteraction($event, 'resize-nw')"
      />
      <div
        class="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-black bg-yellow-300"
        @pointerdown.stop="startInteraction($event, 'resize-se')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MinimapCalibration } from '@shared/types/live-coach'
import { computed, ref } from 'vue'

type Roi = MinimapCalibration['roi']
type RoiInteraction = 'move' | 'resize-nw' | 'resize-se'

const props = defineProps<{
  modelValue: Roi | null
  imageDataUrl?: string
  imageAlt: string
  emptyText: string
  roiAriaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Roi]
}>()

const container = ref<HTMLElement | null>(null)
const roiStyle = computed(() => ({
  left: `${(props.modelValue?.x ?? 0) * 100}%`,
  top: `${(props.modelValue?.y ?? 0) * 100}%`,
  width: `${(props.modelValue?.width ?? 0) * 100}%`,
  height: `${(props.modelValue?.height ?? 0) * 100}%`
}))

function startInteraction(event: PointerEvent, mode: RoiInteraction) {
  if (!props.modelValue || !container.value) return
  event.preventDefault()
  const start = { ...props.modelValue }
  const startX = event.clientX
  const startY = event.clientY
  const bounds = container.value.getBoundingClientRect()

  const onMove = (moveEvent: PointerEvent) => {
    const dx = (moveEvent.clientX - startX) / bounds.width
    const dy = (moveEvent.clientY - startY) / bounds.height
    const minimum = 0.05

    if (mode === 'move') {
      emit('update:modelValue', {
        ...start,
        x: Math.max(0, Math.min(1 - start.width, start.x + dx)),
        y: Math.max(0, Math.min(1 - start.height, start.y + dy))
      })
    } else if (mode === 'resize-se') {
      emit('update:modelValue', {
        ...start,
        width: Math.max(minimum, Math.min(1 - start.x, start.width + dx)),
        height: Math.max(minimum, Math.min(1 - start.y, start.height + dy))
      })
    } else {
      const x = Math.max(0, Math.min(start.x + start.width - minimum, start.x + dx))
      const y = Math.max(0, Math.min(start.y + start.height - minimum, start.y + dy))
      emit('update:modelValue', {
        x,
        y,
        width: start.width + (start.x - x),
        height: start.height + (start.y - y)
      })
    }
  }

  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function nudgeRoi(event: KeyboardEvent) {
  if (!props.modelValue) return
  const delta = event.shiftKey ? 0.02 : 0.005
  const next = { ...props.modelValue }
  if (event.key === 'ArrowLeft') next.x -= delta
  else if (event.key === 'ArrowRight') next.x += delta
  else if (event.key === 'ArrowUp') next.y -= delta
  else if (event.key === 'ArrowDown') next.y += delta
  else return
  event.preventDefault()
  next.x = Math.max(0, Math.min(1 - next.width, next.x))
  next.y = Math.max(0, Math.min(1 - next.height, next.y))
  emit('update:modelValue', next)
}
</script>
