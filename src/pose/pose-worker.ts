/// <reference lib="webworker" />

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseWorkerRequest, PoseWorkerResponse } from './types'

const context = self as unknown as DedicatedWorkerGlobalScope
let landmarker: PoseLandmarker | null = null
let initialization: Promise<void> | null = null
let assetBaseUrl = self.location.origin + '/'

async function initialize(): Promise<void> {
  if (landmarker) return
  initialization ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(new URL('.', assetBaseUrl).href)
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL('pose_landmarker.task', assetBaseUrl).href },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
    })
  })()
  await initialization
}

function send(message: PoseWorkerResponse): void {
  context.postMessage(message)
}

context.onmessage = async (event: MessageEvent<PoseWorkerRequest>) => {
  const bitmap = event.data.type === 'detect' ? event.data.bitmap : null
  try {
    if (event.data.type === 'init') {
      assetBaseUrl = event.data.baseUrl
      await initialize()
      send({ type: 'ready' })
      return
    }

    await initialize()
    const { id, capturedAt } = event.data
    const result = landmarker!.detectForVideo(bitmap!, capturedAt)
    const landmarks = result.landmarks[0]?.map(point => ({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility ?? 0,
    })) ?? []
    const confidence = landmarks.length === 0
      ? 0
      : landmarks.reduce((sum, point) => sum + point.visibility, 0) / landmarks.length
    send({ type: 'result', id, sample: { capturedAt, landmarks, confidence } })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '姿态识别失败' })
  } finally {
    bitmap?.close()
  }
}
