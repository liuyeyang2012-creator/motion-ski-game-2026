import { describe, expect, it, vi } from 'vitest'
import { PoseClient, type WorkerPort } from '../../src/pose/pose-client'
import type { PoseSample } from '../../src/pose/types'

class FakeWorker implements WorkerPort {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  emit(id: number, sample: PoseSample): void {
    this.onmessage?.({ data: { type: 'result', id, sample } } as MessageEvent)
  }
}

describe('PoseClient', () => {
  it('emits only the newest pose result', () => {
    const worker = new FakeWorker()
    const received: PoseSample[] = []
    const client = new PoseClient(worker, (sample) => received.push(sample))
    const bitmap = {} as ImageBitmap

    client.detect(bitmap, 100)
    client.detect(bitmap, 200)
    worker.emit(2, { capturedAt: 200, landmarks: [], confidence: 0.9 })
    worker.emit(1, { capturedAt: 100, landmarks: [], confidence: 0.9 })

    expect(received.map(sample => sample.capturedAt)).toEqual([200])
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'detect', id: 1, bitmap, capturedAt: 100 },
      [bitmap],
    )
  })
})
