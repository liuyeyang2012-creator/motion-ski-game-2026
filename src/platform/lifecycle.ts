export type LifecycleEvent = 'backgrounded' | 'foregrounded' | 'portrait' | 'landscape' | 'rest-due'

export class LifecycleMonitor {
  private activeMs = 0
  private restEmitted = false
  private emit: (event: LifecycleEvent) => void
  private orientationQuery: MediaQueryList | null = null

  constructor(emit: (event: LifecycleEvent) => void) { this.emit = emit }

  attach(): () => void {
    const visibility = () => this.handleVisibility(document.hidden)
    this.orientationQuery = window.matchMedia('(orientation: portrait)')
    const orientation = () => this.handleOrientation(this.orientationQuery!.matches)
    document.addEventListener('visibilitychange', visibility)
    this.orientationQuery.addEventListener('change', orientation)
    orientation()
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      this.orientationQuery?.removeEventListener('change', orientation)
    }
  }

  addActiveTime(deltaMs: number): void {
    this.activeMs += Math.max(0, deltaMs)
    if (this.activeMs >= 300_000 && !this.restEmitted) {
      this.restEmitted = true
      this.emit('rest-due')
    }
  }

  resetAfterLeavingGame(): void { this.activeMs = 0; this.restEmitted = false }
  handleVisibility(hidden: boolean): void { this.emit(hidden ? 'backgrounded' : 'foregrounded') }
  handleOrientation(portrait: boolean): void { this.emit(portrait ? 'portrait' : 'landscape') }
}
