import { describe, expect, it } from 'vitest'
import { loadRecords, recordResult, saveRecords } from '../../src/storage/player-records'

class MapStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private values = new Map<string, string>()

  constructor(entries: [string, string][] = []) {
    this.values = new Map(entries)
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('player records', () => {
  it('recovers from malformed local data', () => {
    const storage = new MapStorage([['motion-ski.records.v1', '{bad']])

    expect(loadRecords(storage)).toMatchObject({
      bestScore: 0,
      bestCombo: 0,
      totalActiveMs: 0,
      lastPlayStyle: 'seated',
      lastSessionKind: 'quick',
    })
  })

  it('keeps best values and accumulates activity time', () => {
    const next = recordResult(loadRecords(new MapStorage()), {
      score: 800,
      bestCombo: 12,
      activeMs: 30_000,
      playStyle: 'seated',
      sessionKind: 'quick',
    })

    expect(next).toMatchObject({
      bestScore: 800,
      bestCombo: 12,
      totalActiveMs: 30_000,
      lastPlayStyle: 'seated',
      lastSessionKind: 'quick',
    })
  })

  it('saves only aggregate records and preferences', () => {
    const storage = new MapStorage()
    const records = recordResult(loadRecords(storage), {
      score: 120,
      bestCombo: 3,
      activeMs: 10_000,
      playStyle: 'standing',
      sessionKind: 'standard',
    })

    saveRecords(storage, records)
    expect(loadRecords(storage)).toEqual(records)
  })

  it('does not block results when storage rejects writes', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => saveRecords(storage, loadRecords(storage))).not.toThrow()
  })
})
