import { describe, expect, it } from 'vitest'
import type { CalibrationProfile } from '../../src/motion/calibration'
import { loadCalibrationProfiles, saveCalibrationProfile } from '../../src/storage/calibration-profiles'

class MapStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private values = new Map<string, string>()

  constructor(entries: [string, string][] = []) { this.values = new Map(entries) }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const seatedProfile: CalibrationProfile = {
  shoulderWidth: 0.2,
  torsoCenterX: 0.5,
  headY: 0.2,
  wristY: 0.65,
  hipY: null,
  kneeY: null,
}
const standingProfile: CalibrationProfile = { ...seatedProfile, hipY: 0.7, kneeY: 0.9 }

describe('calibration profile storage', () => {
  it('stores seated and standing profiles independently', () => {
    const storage = new MapStorage()

    saveCalibrationProfile(storage, 'seated', seatedProfile)
    saveCalibrationProfile(storage, 'standing', standingProfile)

    expect(loadCalibrationProfiles(storage)).toEqual({ seated: seatedProfile, standing: standingProfile })
  })

  it('rejects malformed stored profile values', () => {
    const storage = new MapStorage([['motion-ski.calibration.v1', '{"seated":{"shoulderWidth":0}}']])

    expect(loadCalibrationProfiles(storage)).toEqual({})
  })
})
