import { describe, expect, it, vi } from 'vitest'
import { LifecycleMonitor } from '../../src/platform/lifecycle'

describe('LifecycleMonitor', () => {
  it('emits one rest reminder after five active minutes', () => {
    const emit = vi.fn()
    const monitor = new LifecycleMonitor(emit)
    monitor.addActiveTime(299_999)
    expect(emit).not.toHaveBeenCalledWith('rest-due')
    monitor.addActiveTime(1)
    monitor.addActiveTime(60_000)
    expect(emit.mock.calls.filter(([event]) => event === 'rest-due')).toHaveLength(1)
  })

  it('maps visibility and orientation to lifecycle events', () => {
    const emit = vi.fn()
    const monitor = new LifecycleMonitor(emit)
    monitor.handleVisibility(true)
    monitor.handleOrientation(false)
    expect(emit).toHaveBeenCalledWith('backgrounded')
    expect(emit).toHaveBeenCalledWith('landscape')
  })
})
