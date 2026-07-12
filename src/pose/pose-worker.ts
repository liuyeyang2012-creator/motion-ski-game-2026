/// <reference lib="webworker" />

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseWorkerRequest, PoseWorkerResponse } from './types'

const context = self as unknown as DedicatedWorkerGlobalScope
let landmarker: PoseLandmarker | null = null

async function initialize(): Promise<void> {
  if (landmarker) return
  const vision = await FilesetResolver.forVisionTasks('/wasm')
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker.task' },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: false,
  })
}

function send(message: PoseWorkerResponse): void {
  context.postMessage(message)
}

context.onmessage = async (event: MessageEvent<PoseWorkerRequest>) => {
  try {
    if (event.data.type === 'init') {
      await initialize()
      send({ type: 'ready' })
      return
    }

    await initialize()
    const { id, bitmap, capturedAt } = event.data
    const result = landmarker!.detectForVideo(bitmap, capturedAt)
    bitmap.close()
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
  }
}
