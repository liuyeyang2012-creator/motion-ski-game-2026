import { describe, expect, it, vi } from 'vitest'
import { createDirectPoseClient, DirectPoseClient } from '../../src/pose/direct-pose-client'

describe('DirectPoseClient', () => {
  it('runs pose detection directly against the video element', () => {
    const video = document.createElement('video')
    const onSample = vi.fn()
    const landmarker = {
      detectForVideo: vi.fn(() => ({
        landmarks: [[{ x: 0.4, y: 0.3, z: -0.1, visibility: 0.9 }]],
      })),
      close: vi.fn(),
    }
    const client = new DirectPoseClient(landmarker, onSample)

    expect(client.detect(video, 120)).toBe(true)
    expect(landmarker.detectForVideo).toHaveBeenCalledWith(video, 120)
    expect(onSample).toHaveBeenCalledWith({
      capturedAt: 120,
      landmarks: [{ x: 0.4, y: 0.3, z: -0.1, visibility: 0.9 }],
    })
  })

  it('reports inference errors instead of silently freezing calibration', () => {
    const onError = vi.fn()
    const client = new DirectPoseClient({
      detectForVideo: () => { throw new Error('GPU unavailable') },
      close: vi.fn(),
    }, vi.fn(), onError)

    expect(client.detect(document.createElement('video'), 120)).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'GPU unavailable' }))
  })
})

describe('createDirectPoseClient', () => {
  it('loads local WASM and model assets from the deployed site root', async () => {
    const landmarker = { detectForVideo: vi.fn(() => ({ landmarks: [] })), close: vi.fn() }
    const forVisionTasks = vi.fn(async () => ({ wasmLoaderPath: '', wasmBinaryPath: '' }))
    const createFromOptions = vi.fn(async () => landmarker)

    const client = await createDirectPoseClient('https://game.example/', vi.fn(), vi.fn(), {
      forVisionTasks,
      createFromOptions,
    })

    expect(forVisionTasks).toHaveBeenCalledWith('https://game.example/')
    expect(createFromOptions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      baseOptions: { modelAssetPath: 'https://game.example/pose_landmarker.task' },
      runningMode: 'VIDEO',
    }))
    client.dispose()
    expect(landmarker.close).toHaveBeenCalled()
  })

  it('uses explicit non-SIMD WASM and CPU delegate in compatibility mode', async () => {
    const landmarker = { detectForVideo: vi.fn(() => ({ landmarks: [] })), close: vi.fn() }
    const forVisionTasks = vi.fn()
    const createFromOptions = vi.fn(async () => landmarker)

    await createDirectPoseClient(
      'https://example.test/motion-ski-game-2026/',
      vi.fn(),
      vi.fn(),
      { forVisionTasks, createFromOptions },
      { mode: 'compatibility' },
    )

    expect(forVisionTasks).not.toHaveBeenCalled()
    expect(createFromOptions).toHaveBeenCalledWith(
      {
        wasmLoaderPath: 'https://example.test/motion-ski-game-2026/vision_wasm_nosimd_internal.js',
        wasmBinaryPath: 'https://example.test/motion-ski-game-2026/vision_wasm_nosimd_internal.wasm',
      },
      expect.objectContaining({
        baseOptions: {
          modelAssetPath: 'https://example.test/motion-ski-game-2026/pose_landmarker.task',
          delegate: 'CPU',
        },
      }),
    )
  })
})
