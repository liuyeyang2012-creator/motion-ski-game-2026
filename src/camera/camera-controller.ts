export class CameraController {
  private stream: MediaStream | null = null

  async start(video: HTMLVideoElement): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })

    await this.applyMinimumZoom(this.stream)
    video.srcObject = this.stream
    await video.play()
    return this.stream
  }

  private async applyMinimumZoom(stream: MediaStream): Promise<void> {
    const optionalStream = stream as MediaStream & {
      getVideoTracks?: () => MediaStreamTrack[]
    }
    const track = optionalStream.getVideoTracks?.()[0] as unknown as {
      getCapabilities?: () => { zoom?: { min?: unknown } }
      applyConstraints?: (constraints: unknown) => Promise<void>
    } | undefined

    if (!track?.getCapabilities || !track.applyConstraints) return

    const minZoom = track.getCapabilities().zoom?.min
    if (typeof minZoom !== 'number' || !Number.isFinite(minZoom)) return

    try {
      await track.applyConstraints({ advanced: [{ zoom: minZoom }] })
    } catch {
      // Zoom is an optional enhancement; camera startup must continue.
    }
  }

  pause(): void {
    this.stream?.getTracks().forEach(track => { track.enabled = false })
  }

  async resume(video: HTMLVideoElement): Promise<void> {
    this.stream?.getTracks().forEach(track => { track.enabled = true })
    await video.play()
  }

  stop(video?: HTMLVideoElement): void {
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (video) video.srcObject = null
  }
}
