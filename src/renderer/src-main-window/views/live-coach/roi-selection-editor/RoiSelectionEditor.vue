<template>
  <div
    ref="container"
    class="relative mx-auto overflow-hidden rounded border border-gray-200 bg-gray-950 dark:border-gray-700"
    :style="previewStyle"
  >
    <img
      v-if="imageDataUrl"
      class="block h-full w-full object-fill select-none"
      :src="imageDataUrl"
      :alt="imageAlt"
      draggable="false"
    />
    <div v-else class="flex h-full items-center justify-center text-sm text-gray-400">
      {{ emptyText }}
    </div>

    <div
      v-if="modelValue"
      class="absolute cursor-move touch-none border-2 border-yellow-400 bg-yellow-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
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
import { computed, onBeforeUnmount, ref } from 'vue'

import {
  getRoiPreviewAspectRatio,
  moveRoi,
  resizeSquareRoi,
  type RoiResizeHandle,
  type RoiSourceSize
} from './geometry'

type Roi = MinimapCalibration['roi']
type RoiInteraction = 'move' | RoiResizeHandle

const props = defineProps<{
  modelValue: Roi | null
  imageDataUrl?: string
  imageAlt: string
  emptyText: string
  roiAriaLabel: string
  sourceSize?: RoiSourceSize | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Roi]
}>()

const container = ref<HTMLElement | null>(null)
let stopActiveInteraction: (() => void) | null = null
const previewStyle = computed(() => {
  const aspectRatio = getRoiPreviewAspectRatio(props.sourceSize)
  return {
    aspectRatio: String(aspectRatio),
    // Preserve the real source ratio without letting a portrait or otherwise extreme capture
    // create a multi-thousand-pixel-tall editor inside the settings page.
    width: `min(100%, ${aspectRatio * 70}vh, ${aspectRatio * 720}px)`
  }
})
const roiStyle = computed(() => ({
  left: `${(props.modelValue?.x ?? 0) * 100}%`,
  top: `${(props.modelValue?.y ?? 0) * 100}%`,
  width: `${(props.modelValue?.width ?? 0) * 100}%`,
  height: `${(props.modelValue?.height ?? 0) * 100}%`
}))

function startInteraction(event: PointerEvent, mode: RoiInteraction) {
  if (!props.modelValue || !container.value) return
  event.preventDefault()
  stopActiveInteraction?.()

  const start = { ...props.modelValue }
  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  const previewWidth = container.value.clientWidth
  const previewHeight = container.value.clientHeight
  const sourceSize = props.sourceSize

  if (previewWidth <= 0 || previewHeight <= 0) return

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return
    const dx = (moveEvent.clientX - startX) / previewWidth
    const dy = (moveEvent.clientY - startY) / previewHeight

    if (mode === 'move') {
      emit('update:modelValue', moveRoi(start, dx, dy))
    } else {
      emit('update:modelValue', resizeSquareRoi(start, dx, dy, mode, sourceSize))
    }
  }

  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    if (stopActiveInteraction === stop) stopActiveInteraction = null
  }

  const onEnd = (endEvent: PointerEvent) => {
    if (endEvent.pointerId === pointerId) stop()
  }

  stopActiveInteraction = stop
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

onBeforeUnmount(() => stopActiveInteraction?.())

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
