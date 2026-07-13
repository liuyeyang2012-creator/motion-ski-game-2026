import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../../src/camera/camera-controller'

function installGetUserMedia(stream: MediaStream) {
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia }, configurable: true,
  })
  return getUserMedia
}

function createVideo() {
  return {
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
  } as unknown as HTMLVideoElement
}

describe('CameraController', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests an ideal user-facing 1280x720 camera without audio', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const getUserMedia = installGetUserMedia(stream)
    const video = createVideo()

    await new CameraController().start(video)

    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalledOnce()
  })

  it('applies the minimum supported zoom to the first video track', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined)
    const firstTrack = {
      getCapabilities: vi.fn().mockReturnValue({ zoom: { min: 0.5, max: 4 } }),
      applyConstraints,
    }
    const secondTrack = {
      getCapabilities: vi.fn().mockReturnValue({ zoom: { min: 1, max: 2 } }),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    }
    const stream = {
      getVideoTracks: () => [firstTrack, secondTrack],
      getTracks: () => [firstTrack, secondTrack],
    } as unknown as MediaStream
    installGetUserMedia(stream)

    await new CameraController().start(createVideo())

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: 0.5 }],
    })
    expect(secondTrack.applyConstraints).not.toHaveBeenCalled()
  })

  it.each([
    ['missing getVideoTracks', { getTracks: () => [] }],
    ['missing video track', { getVideoTracks: () => [], getTracks: () => [] }],
    ['missing getCapabilities', {
      getVideoTracks: () => [{ applyConstraints: vi.fn() }], getTracks: () => [],
    }],
    ['missing applyConstraints', {
      getVideoTracks: () => [{ getCapabilities: () => ({ zoom: { min: 0.5 } }) }],
      getTracks: () => [],
    }],
    ['missing zoom capability', {
      getVideoTracks: () => [{ getCapabilities: () => ({}) }], getTracks: () => [],
    }],
    ['non-finite zoom minimum', {
      getVideoTracks: () => [{
        getCapabilities: () => ({ zoom: { min: Number.NaN } }),
        applyConstraints: vi.fn(),
      }],
      getTracks: () => [],
    }],
  ])('starts and plays when the browser has %s', async (_label, streamShape) => {
    const stream = streamShape as unknown as MediaStream
    installGetUserMedia(stream)
    const video = createVideo()

    const result = await new CameraController().start(video)

    expect(result).toBe(stream)
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalledOnce()
  })

  it('still starts and plays when applying optional zoom rejects', async () => {
    const applyConstraints = vi.fn().mockRejectedValue(new Error('zoom unavailable'))
    const track = {
      getCapabilities: () => ({ zoom: { min: 0.5 } }),
      applyConstraints,
    }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    installGetUserMedia(stream)
    const video = createVideo()

    const result = await new CameraController().start(video)

    expect(applyConstraints).toHaveBeenCalledOnce()
    expect(result).toBe(stream)
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalledOnce()
  })

  it('stops every track and clears the video source', async () => {
    const stop = vi.fn()
    const track = { enabled: true, stop }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    installGetUserMedia(stream)
    const video = createVideo()
    const camera = new CameraController()
    await camera.start(video)

    camera.stop(video)

    expect(stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
  })
})
