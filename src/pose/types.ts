export interface PoseLandmark {
  x: number
  y: number
  z: number
  visibility: number
}

export interface PoseSample {
  capturedAt: number
  landmarks: PoseLandmark[]
}

export type PoseWorkerRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; capturedAt: number }

export type PoseWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; sample: PoseSample }
  | { type: 'error'; message: string }
