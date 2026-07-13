import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseSample } from './types'

interface PoseResult {
  landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>
}

export interface PoseLandmarkerPort {
  detectForVideo(frame: HTMLVideoElement, capturedAt: number): PoseResult
  close(): void
}

interface PoseClientDependencies {
  forVisionTasks(baseUrl: string): ReturnType<typeof FilesetResolver.forVisionTasks>
  createFromOptions(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, options: {
    baseOptions: { modelAssetPath: string }
    runningMode: 'VIDEO'
    numPoses: number
    outputSegmentationMasks: boolean
  }): Promise<PoseLandmarkerPort>
}

const defaultDependencies: PoseClientDependencies = {
  forVisionTasks: baseUrl => FilesetResolver.forVisionTasks(baseUrl),
  createFromOptions: (fileset, options) => PoseLandmarker.createFromOptions(fileset, options),
}

export class DirectPoseClient {
  private landmarker: PoseLandmarkerPort
  private onSample: (sample: PoseSample) => void
  private onError: (error: Error) => void

  constructor(
    landmarker: PoseLandmarkerPort,
    onSample: (sample: PoseSample) => void,
    onError: (error: Error) => void = () => {},
  ) {
    this.landmarker = landmarker
    this.onSample = onSample
    this.onError = onError
  }

  detect(video: HTMLVideoElement, capturedAt: number): boolean {
    try {
      const result = this.landmarker.detectForVideo(video, capturedAt)
      const landmarks = result.landmarks[0]?.map(point => ({
        x: point.x,
        y: point.y,
        z: point.z,
        visibility: point.visibility ?? 0,
      })) ?? []
      const confidence = landmarks.length === 0
        ? 0
        : landmarks.reduce((sum, point) => sum + point.visibility, 0) / landmarks.length
      this.onSample({ capturedAt, landmarks, confidence })
      return true
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('姿态识别失败'))
      return false
    }
  }

  dispose(): void {
    this.landmarker.close()
  }
}

export async function createDirectPoseClient(
  baseUrl: string,
  onSample: (sample: PoseSample) => void,
  onError: (error: Error) => void,
  dependencies: PoseClientDependencies = defaultDependencies,
): Promise<DirectPoseClient> {
  const assetBaseUrl = new URL('.', baseUrl).href
  const fileset = await dependencies.forVisionTasks(assetBaseUrl)
  const landmarker = await dependencies.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('pose_landmarker.task', assetBaseUrl).href },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: false,
  })
  return new DirectPoseClient(landmarker, onSample, onError)
}
