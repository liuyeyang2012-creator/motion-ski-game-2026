import type { PoseSample, PoseWorkerRequest, PoseWorkerResponse } from './types'

export interface WorkerPort {
  onmessage: ((event: MessageEvent<PoseWorkerResponse>) => void) | null
  postMessage(message: PoseWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export class PoseClient {
  private nextId = 1
  private newestResultId = 0
  private busy = false
  private worker: WorkerPort
  private onSample: (sample: PoseSample) => void

  constructor(
    worker: WorkerPort,
    onSample: (sample: PoseSample) => void,
  ) {
    this.worker = worker
    this.onSample = onSample
    this.worker.onmessage = event => {
      if (event.data.type === 'error') { this.busy = false; return }
      if (event.data.type !== 'result') return
      this.busy = false
      if (event.data.id <= this.newestResultId) return
      this.newestResultId = event.data.id
      this.onSample(event.data.sample)
    }
  }

  start(): void {
    this.worker.postMessage({ type: 'init', baseUrl: document.baseURI })
  }

  detect(bitmap: ImageBitmap, capturedAt: number): boolean {
    if (this.busy) { bitmap.close?.(); return false }
    this.busy = true
    const id = this.nextId++
    this.worker.postMessage({ type: 'detect', id, bitmap, capturedAt }, [bitmap])
    return true
  }

  dispose(): void {
    this.worker.terminate()
  }
}
