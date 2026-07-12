import type { PlayStyle, SessionKind, SessionResult } from '../app/types'

const STORAGE_KEY = 'motion-ski.records.v1'

export interface PlayerRecords {
  bestScore: number
  bestCombo: number
  totalActiveMs: number
  lastPlayStyle: PlayStyle
  lastSessionKind: SessionKind
}

const DEFAULT_RECORDS: PlayerRecords = Object.freeze({
  bestScore: 0,
  bestCombo: 0,
  totalActiveMs: 0,
  lastPlayStyle: 'seated',
  lastSessionKind: 'quick',
})

type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPlayStyle(value: unknown): value is PlayStyle {
  return value === 'seated' || value === 'standing'
}

function isSessionKind(value: unknown): value is SessionKind {
  return value === 'quick' || value === 'standard' || value === 'endless'
}

function parseRecords(value: unknown): PlayerRecords | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    !isNonNegativeNumber(record.bestScore) ||
    !isNonNegativeNumber(record.bestCombo) ||
    !isNonNegativeNumber(record.totalActiveMs) ||
    !isPlayStyle(record.lastPlayStyle) ||
    !isSessionKind(record.lastSessionKind)
  ) return null

  return {
    bestScore: record.bestScore,
    bestCombo: record.bestCombo,
    totalActiveMs: record.totalActiveMs,
    lastPlayStyle: record.lastPlayStyle,
    lastSessionKind: record.lastSessionKind,
  }
}

export function loadRecords(storage: RecordStorage): PlayerRecords {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_RECORDS }
    return parseRecords(JSON.parse(raw)) ?? { ...DEFAULT_RECORDS }
  } catch {
    return { ...DEFAULT_RECORDS }
  }
}

export function saveRecords(storage: RecordStorage, records: PlayerRecords): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(records)) } catch { /* Results remain usable without persistence. */ }
}

export function recordResult(records: PlayerRecords, result: SessionResult): PlayerRecords {
  return {
    bestScore: Math.max(records.bestScore, result.score),
    bestCombo: Math.max(records.bestCombo, result.bestCombo),
    totalActiveMs: records.totalActiveMs + Math.max(0, result.activeMs),
    lastPlayStyle: result.playStyle,
    lastSessionKind: result.sessionKind,
  }
}
