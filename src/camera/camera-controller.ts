export class CameraController {
  private stream: MediaStream | null = null

  async start(video: HTMLVideoElement): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    })
    video.srcObject = this.stream
    await video.play()
    return this.stream
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
