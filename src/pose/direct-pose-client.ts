import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseSample } from './types'

interface PoseResult {
  landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>
}

export interface PoseLandmarkerPort {
  detectForVideo(frame: HTMLVideoElement, capturedAt: number): PoseResult
  close(): void
}

export type PoseRuntimeMode = 'standard' | 'compatibility'

export interface PoseClientOptions {
  mode?: PoseRuntimeMode
}

interface VisionFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

interface PoseClientDependencies {
  forVisionTasks(baseUrl: string): Promise<VisionFileset>
  createFromOptions(fileset: VisionFileset, options: {
    baseOptions: { modelAssetPath: string; delegate?: 'CPU' | 'GPU' }
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
      this.onSample({ capturedAt, landmarks })
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
  options: PoseClientOptions = {},
): Promise<DirectPoseClient> {
  const assetBaseUrl = new URL('.', baseUrl).href
  const mode = options.mode ?? 'standard'
  const fileset = mode === 'compatibility'
    ? {
        wasmLoaderPath: new URL('vision_wasm_nosimd_internal.js', assetBaseUrl).href,
        wasmBinaryPath: new URL('vision_wasm_nosimd_internal.wasm', assetBaseUrl).href,
      }
    : await dependencies.forVisionTasks(assetBaseUrl)
  const modelAssetPath = new URL('pose_landmarker.task', assetBaseUrl).href
  const landmarker = await dependencies.createFromOptions(fileset, {
    baseOptions: mode === 'compatibility'
      ? { modelAssetPath, delegate: 'CPU' }
      : { modelAssetPath },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: false,
  })
  return new DirectPoseClient(landmarker, onSample, onError)
}
