export type PlayStyle = 'seated' | 'standing'
export type SessionKind = 'quick' | 'standard' | 'endless'

export interface SessionResult {
  score: number
  bestCombo: number
  activeMs: number
  playStyle: PlayStyle
  sessionKind: SessionKind
}
