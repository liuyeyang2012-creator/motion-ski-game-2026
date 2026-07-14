import { describe, expect, it } from 'vitest'
import type { CalibrationProfile } from '../../src/motion/calibration'
import type { HeadControlProfile } from '../../src/motion/head-control'
import { loadCalibrationProfiles, saveCalibrationProfile } from '../../src/storage/calibration-profiles'

class MapStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private values = new Map<string, string>()

  constructor(entries: [string, string][] = []) { this.values = new Map(entries) }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const headControl: HeadControlProfile = {
  neutral: {
    shoulderWidth: 0.2,
    shoulderCenterX: 0.5,
    shoulderCenterY: 0.4,
    noseOffsetX: 0,
    noseOffsetY: -1,
    supportOffsetX: 0,
    supportOffsetY: -1.025,
    confidence: 1,
  },
  thresholds: {
    'turn-left': 0.1,
    'turn-right': 0.11,
    'look-up': 0.08,
    'look-down': 0.09,
  },
  directions: {
    'turn-left': -1,
    'turn-right': 1,
    'look-up': -1,
    'look-down': 1,
  },
}

const seatedProfile: CalibrationProfile = {
  shoulderWidth: 0.2,
  torsoCenterX: 0.5,
  headY: 0.2,
  wristY: 0.65,
  hipY: null,
  kneeY: null,
  headControl,
}
const standingProfile: CalibrationProfile = { ...seatedProfile, hipY: 0.7, kneeY: 0.9, headControl: null }

describe('calibration profile storage', () => {
  it('stores seated and standing profiles independently', () => {
    const storage = new MapStorage()

    saveCalibrationProfile(storage, 'seated', seatedProfile)
    saveCalibrationProfile(storage, 'standing', standingProfile)

    expect(loadCalibrationProfiles(storage)).toEqual({ seated: seatedProfile, standing: standingProfile })
  })

  it('keeps nested seated head data when standing is saved afterward', () => {
    const storage = new MapStorage()

    saveCalibrationProfile(storage, 'seated', seatedProfile)
    saveCalibrationProfile(storage, 'standing', standingProfile)

    expect(loadCalibrationProfiles(storage).seated?.headControl).toEqual(headControl)
  })

  it('rejects malformed stored profile values', () => {
    const storage = new MapStorage([['motion-ski.calibration.v1', '{"seated":{"shoulderWidth":0}}']])

    expect(loadCalibrationProfiles(storage)).toEqual({})
  })

  it.each([
    ['non-positive neutral shoulder width', { neutral: { ...headControl.neutral, shoulderWidth: 0 } }],
    ['non-finite neutral metric', { neutral: { ...headControl.neutral, noseOffsetX: Number.POSITIVE_INFINITY } }],
    ['non-finite threshold', { thresholds: { ...headControl.thresholds, 'look-up': Number.NaN } }],
    ['out-of-range direction', { directions: { ...headControl.directions, 'turn-right': 2 } }],
  ])('rejects seated head data with %s', (_name, change) => {
    const storage = new MapStorage()
    saveCalibrationProfile(storage, 'seated', {
      ...seatedProfile,
      headControl: { ...headControl, ...change } as HeadControlProfile,
    })

    expect(loadCalibrationProfiles(storage)).toEqual({})
  })

  it('normalizes a legacy standing profile without head data to null', () => {
    const { headControl: _headControl, ...legacyStanding } = standingProfile
    const storage = new MapStorage([['motion-ski.calibration.v1', JSON.stringify({ standing: legacyStanding })]])

    expect(loadCalibrationProfiles(storage)).toEqual({
      standing: { ...legacyStanding, headControl: null },
    })
  })

  it('rejects a legacy seated profile without head data', () => {
    const { headControl: _headControl, ...legacySeated } = seatedProfile
    const storage = new MapStorage([['motion-ski.calibration.v1', JSON.stringify({ seated: legacySeated })]])

    expect(loadCalibrationProfiles(storage)).toEqual({})
  })
})
