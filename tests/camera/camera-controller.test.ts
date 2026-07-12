import { describe, expect, it, vi } from 'vitest'
import { CameraController } from '../../src/camera/camera-controller'

describe('CameraController', () => {
  it('starts the front camera without audio and stops every track', async () => {
    const stop = vi.fn()
    const track = { enabled: true, stop }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia }, configurable: true,
    })
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement
    const camera = new CameraController()

    await camera.start(video)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'user' }, audio: false,
    })
    expect(video.srcObject).toBe(stream)

    camera.stop(video)
    expect(stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
  })
})
