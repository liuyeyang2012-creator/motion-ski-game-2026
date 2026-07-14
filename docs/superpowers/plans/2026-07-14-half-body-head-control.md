# Half-Body Head Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace seated-mode body-lean calibration and controls with a visible five-step face calibration and personalized head controls for lane changes, jumping, and ducking.

**Architecture:** A new pure `head-control.ts` module measures mirrored head geometry from the existing Pose Landmarker and owns all neutral/action assessments. `CalibrationSession` orchestrates the seated five-step flow while retaining the standing flow; the UI renders a dedicated realistic SVG guide, and the game layer consumes new head motion events without changing standing-mode events.

**Tech Stack:** TypeScript 6, MediaPipe Tasks Vision Pose Landmarker 0.10, DOM/SVG/CSS, Canvas 2D, Vitest 4, Playwright 1.61, Vite 8, GitHub Pages

## Global Constraints

- Change seated/half-body mode only; standing/full-body calibration, controls, and obstacle combinations must retain their current behavior.
- Continue using one Pose Landmarker. Do not add Face Landmarker, remote recognition, uploads, identity matching, or camera-data persistence.
- The nose is the primary head-motion signal; eyes, ears, and shoulders must provide supporting evidence for every accepted seated action.
- Seated calibration order is exactly: neutral face, turn left, turn right, look up, look down.
- Each step shows live feedback and progress, confirms success with a green check and one vibration, and exposes recovery controls after 6,000 ms.
- The neutral guide is a realistic front-facing head, ears, thick neck, and naturally sloping shoulders. It shows exactly five weak markers: head top, two cheeks, and two shoulders.
- Preserve the existing 15,000 ms model initialization limit and non-SIMD CPU compatibility retry.
- Seated game obstacles are exactly lane change, jump, and duck. Remove seated hands-up obstacles.
- Use TDD for every behavior: add a focused test, observe the expected failure, implement the minimum production change, then rerun focused and regression tests.

---

## File Structure

- Create `src/motion/head-control.ts`: pure landmark measurement, framing, action assessment, personalized thresholds, and game-condition calculation.
- Modify `src/motion/calibration.ts`: extend the common profile/action/feedback types and delegate seated geometry to `head-control.ts`; retain standing calculations.
- Modify `src/motion/calibration-session.ts`: run the five visible seated steps and the existing standing flow behind the current public class.
- Create `src/ui/head-calibration-guide.ts`: build the realistic SVG guide and exactly five visual markers.
- Modify `src/ui/calibration-view.ts`: render seated status, step copy, feedback, success, and recovery without exposing the full skeleton.
- Modify `src/style.css`: style the realistic guide, five weak points, status chips, and reduced glow.
- Modify `src/motion/motion-detector.ts`: emit personalized seated head events and preserve standing events.
- Modify `src/game/types.ts` and `src/game/game-engine.ts`: schedule seated head obstacles and record short jump/duck display state.
- Modify `src/render/ski-renderer.ts`: draw distinct seated obstacles and player jump/duck feedback.
- Modify `src/ui/screens.ts`: update seated setup, hints, and result statistics to head-control language.
- Modify `src/storage/calibration-profiles.ts`: validate and round-trip the nested head-control profile.
- Modify `src/app/app-controller.ts`: generate deterministic seated head fixtures and mode-specific game hints.
- Modify `tests/support/pose-sample.ts`: provide realistic default eye and ear landmarks for all head-control tests.
- Update focused unit, controller, storage, renderer, UI, and E2E tests listed in each task.

### Task 1: Pure Head Geometry and Persisted Profile

**Files:**
- Create: `src/motion/head-control.ts`
- Modify: `src/motion/calibration.ts`
- Modify: `src/storage/calibration-profiles.ts`
- Modify: `tests/support/pose-sample.ts`
- Create: `tests/motion/head-control.test.ts`
- Modify: `tests/motion/calibration.test.ts`
- Modify: `tests/motion/motion-detector.test.ts` (legacy prompt/validation fixtures only; runtime detector changes remain in Task 4)
- Modify: `tests/storage/calibration-profiles.test.ts`

**Interfaces:**
- Consumes: `PoseSample`, `assessLandmarks`, and existing `CalibrationProfile` construction.
- Produces: `HeadCalibrationAction`, `HeadFeedbackCode`, `HeadPoseMetrics`, `HeadControlProfile`, `assessHeadFraming()`, `buildHeadControlProfile()`, `assessHeadAction()`, `recordHeadThreshold()`, and `assessHeadGameConditions()`.

- [ ] **Step 1: Add realistic default face landmarks to the pose fixture**

Extend `poseSample()` immediately after landmark 0 so tests represent the seven internally required points:

```ts
Object.assign(landmarks[0], { x: 0.5, y: 0.2 })
Object.assign(landmarks[2], { x: 0.47, y: 0.18 })
Object.assign(landmarks[5], { x: 0.53, y: 0.18 })
Object.assign(landmarks[7], { x: 0.43, y: 0.21 })
Object.assign(landmarks[8], { x: 0.57, y: 0.21 })
```

- [ ] **Step 2: Write failing tests for neutral framing, supported turns, pitch, and body-shift rejection**

Create `tests/motion/head-control.test.ts` with these concrete cases:

```ts
import { describe, expect, it } from 'vitest'
import {
  assessHeadAction,
  assessHeadFraming,
  buildHeadControlProfile,
} from '../../src/motion/head-control'
import { poseSample } from '../support/pose-sample'

const moveFace = (capturedAt: number, dx: number, dy = 0) => poseSample(capturedAt, {
  changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
    x: poseSample(0).landmarks[index].x + dx,
    y: poseSample(0).landmarks[index].y + dy,
  }])),
})

describe('head control geometry', () => {
  it('accepts a centered neutral face with visible eyes ears and shoulders', () => {
    expect(assessHeadFraming(poseSample(0))).toMatchObject({
      ok: true,
      headRecognized: true,
      shouldersRecognized: true,
    })
  })

  it.each([
    [0.12, 'move-closer'],
    [0.48, 'move-back'],
  ] as const)('reports distance feedback for shoulder width %s', (width, feedback) => {
    expect(assessHeadFraming(withShoulderWidth(poseSample(0), width))).toMatchObject({ ok: false, feedback })
  })

  it('reports center-head when the otherwise valid face is outside the guide region', () => {
    expect(assessHeadFraming(moveFace(0, 0.22))).toMatchObject({ ok: false, feedback: 'center-head' })
  })

  it('requires the face support points instead of accepting the nose alone', () => {
    expect(assessHeadFraming(poseSample(0, { hidden: [2, 5, 7, 8] }))).toMatchObject({
      ok: false,
      feedback: 'head-missing',
    })
  })

  it('recognizes player-left turn from mirrored nose and face motion with stable shoulders', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    expect(assessHeadAction(profile, moveFace(160, 0.04), 'turn-left')).toMatchObject({ ok: true })
  })

  it('rejects whole-body translation as a head turn', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    const shifted = poseSample(160, {
      changes: Object.fromEntries([0, 2, 5, 7, 8, 11, 12].map(index => [index, {
        x: poseSample(0).landmarks[index].x + 0.04,
      }])),
    })
    expect(assessHeadAction(profile, shifted, 'turn-left')).toMatchObject({
      ok: false,
      feedback: 'shoulders-moving',
    })
  })

  it('recognizes look-up and look-down with face support and stable shoulders', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    expect(assessHeadAction(profile, moveFace(160, 0, -0.03), 'look-up').ok).toBe(true)
    expect(assessHeadAction(profile, moveFace(240, 0, 0.03), 'look-down').ok).toBe(true)
  })

  it('records demonstrated signs and requires the paired action to be opposite', () => {
    let profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    profile = recordHeadThreshold(profile, 'turn-left', -0.14)
    expect(profile.directions['turn-left']).toBe(-1)
    expect(assessHeadAction(profile, moveFace(160, 0.04), 'turn-right').ok).toBe(false)
    expect(assessHeadAction(profile, moveFace(240, -0.04), 'turn-right').ok).toBe(true)
  })
})
```

- [ ] **Step 3: Run the new test and verify RED**

Run: `npm.cmd test -- --run tests/motion/head-control.test.ts`

Expected: FAIL because `src/motion/head-control.ts` and all exported interfaces are missing.

- [ ] **Step 4: Implement the pure geometry module**

Create the module with these exact public contracts and constants:

```ts
export const HEAD_REQUIRED_INDICES = [0, 2, 5, 7, 8, 11, 12] as const
export type HeadCalibrationAction = 'face-neutral' | 'turn-left' | 'turn-right' | 'look-up' | 'look-down'
export type HeadMotionAction = Exclude<HeadCalibrationAction, 'face-neutral'>
export type HeadFeedbackCode =
  | 'head-missing' | 'shoulders-missing' | 'move-closer' | 'move-back'
  | 'center-head' | 'shoulders-moving' | 'turn-left-more' | 'turn-right-more'
  | 'look-up-more' | 'look-down-more' | 'hold'

export interface HeadPoseMetrics {
  shoulderWidth: number
  shoulderCenterX: number
  shoulderCenterY: number
  noseOffsetX: number
  noseOffsetY: number
  supportOffsetX: number
  supportOffsetY: number
  confidence: number
}

export interface HeadControlProfile {
  neutral: HeadPoseMetrics
  thresholds: Record<HeadMotionAction, number>
  directions: Record<HeadMotionAction, -1 | 0 | 1>
}

export interface HeadAssessment {
  ok: boolean
  recordable: boolean
  feedback: HeadFeedbackCode
  confidence: number
  strength: number
  headRecognized: boolean
  shouldersRecognized: boolean
}

export interface HeadGameSignals {
  trackable: boolean
  confidence: number
  strengths: Record<HeadMotionAction, number>
  triggered: Record<HeadMotionAction, boolean>
  neutral: Record<HeadMotionAction, boolean>
}

export function assessHeadGameConditions(
  profile: HeadControlProfile,
  sample: PoseSample,
): HeadGameSignals
```

For neutral framing, require normalized shoulder width in `[0.16, 0.44]`; widths below the range return `move-closer` and widths above it return `move-back`. Require nose center x in `[0.34, 0.66]`, nose y in `[0.10, 0.34]`, shoulder center x in `[0.30, 0.70]`, shoulder center y in `[0.30, 0.62]`, and the nose to remain at least `0.10` above the shoulder line; otherwise return `center-head`. Keep these constants named and unit-tested so later phone tuning is localized.

Use mirrored horizontal coordinates (`1 - point.x`) for user-facing feedback, but do not hardcode raw-coordinate signs as semantic directions. During calibration, accept either significant signed direction for the first horizontal action and record it as the demonstrated `turn-left`; require `turn-right` to use the opposite sign. Apply the same demonstrated-direction rule to `look-up` and `look-down`, so front-camera mirroring or device coordinate differences cannot reverse gameplay. Neutral framing requires both ears, while an action requires both eyes and at least one usable ear. Normalize nose and face-support centers by shoulder width. Require stable shoulders (`center movement <= shoulderWidth * 0.12`), a primary nose delta, and a same-direction support delta at least 35% as large. Use default minimum strengths `0.10` for turns and `0.08` for pitch.

`recordable` is true only when all required geometry is finite, the current action's visibility rule is satisfied, shoulders are stable, primary and support deltas agree, and the signed direction is correct for a paired action; it may still be below the success threshold. Missing landmarks, shoulder/body movement, conflicting support, or the wrong paired direction must set `recordable: false`. The session may personalize a threshold only from recordable evidence.

For game signals, project each live signed yaw/pitch strength onto that action's recorded direction so positive means “toward this calibrated action.” Set `triggered[action]` only when the sample is trackable, supporting evidence agrees, shoulders are stable, the recorded direction is non-zero, and projected strength reaches the personalized threshold. Set `neutral[action]` only when the same axis is trackable and absolute raw strength is at most 45% of that threshold. Return all-false maps with `trackable: false` for malformed input. Keep time, velocity, hold duration, and the 320 ms quick-head-up window out of this pure function; `MotionDetector` owns those stateful rules.

Implement threshold personalization with an exact bounded formula:

```ts
const MIN_THRESHOLD: Record<HeadMotionAction, number> = {
  'turn-left': 0.07,
  'turn-right': 0.07,
  'look-up': 0.055,
  'look-down': 0.055,
}
const MAX_THRESHOLD: Record<HeadMotionAction, number> = {
  'turn-left': 0.22,
  'turn-right': 0.22,
  'look-up': 0.18,
  'look-down': 0.18,
}

export function recordHeadThreshold(
  profile: HeadControlProfile,
  action: HeadMotionAction,
  signedStrength: number,
): HeadControlProfile {
  const finiteStrength = Number.isFinite(signedStrength) ? signedStrength : 0
  const value = Math.min(MAX_THRESHOLD[action], Math.max(MIN_THRESHOLD[action], Math.abs(finiteStrength) * 0.7))
  const direction = finiteStrength < 0 ? -1 : finiteStrength > 0 ? 1 : 0
  return {
    ...profile,
    thresholds: { ...profile.thresholds, [action]: value },
    directions: { ...profile.directions, [action]: direction },
  }
}
```

Add regression cases proving that moving the face and shoulders together vertically returns `shoulders-moving` for pitch, and that any required coordinate containing `NaN` or `Infinity` returns a safe non-success assessment without throwing.

- [ ] **Step 5: Run the geometry test and verify GREEN**

Run: `npm.cmd test -- --run tests/motion/head-control.test.ts`

Expected: all head geometry tests PASS.

- [ ] **Step 6: Extend the common calibration profile and seated delegation with failing tests first**

In `tests/motion/calibration.test.ts`, change the seated action expectation to:

```ts
expect(getCalibrationActions('seated')).toEqual([
  'face-neutral', 'turn-left', 'turn-right', 'look-up', 'look-down',
])
```

Add an assertion that seated `buildCalibration()` returns a non-null `headControl`, while standing returns `headControl: null`. Run:

`npm.cmd test -- --run tests/motion/calibration.test.ts`

Expected: FAIL because the profile and action unions still describe body-lean seated calibration.

- [ ] **Step 7: Implement profile/action delegation**

In `calibration.ts`:

```ts
export type CalibrationAction =
  | HeadCalibrationAction
  | 'lean-left' | 'lean-right' | 'duck' | 'hands-up' | 'reach' | 'squat'

export interface CalibrationProfile {
  shoulderWidth: number
  torsoCenterX: number
  headY: number
  wristY: number
  hipY: number | null
  kneeY: number | null
  headControl?: HeadControlProfile | null
}

export const getCalibrationActions = (style: PlayStyle): readonly CalibrationAction[] => style === 'seated'
  ? ['face-neutral', 'turn-left', 'turn-right', 'look-up', 'look-down']
  : ['lean-left', 'lean-right', 'duck', 'hands-up', 'squat']
```

For new seated baselines, call `buildHeadControlProfile(usableSamples)` and put the result into non-null `headControl`; for newly built standing profiles set `headControl: null`. Keep the field optional at the shared type boundary so existing standing fixtures and legacy stored values remain source-compatible, but reject a seated game start unless its newly completed profile has non-null head data. Delegate seated head actions from `assessCalibrationAction()` to `assessHeadAction()` and preserve existing standing branches unchanged.

Update the legacy batch helpers in the same task: seated `getCalibrationPrompt()` must use the five head-action labels, and `validateCalibrationActions()` must assess the new seated action list against `headControl` rather than indexing the old lean/hand issue map. Preserve the standing prompt and validation paths byte-for-byte where possible. Update the existing seated helper cases in `tests/motion/motion-detector.test.ts` now so Task 2's typecheck is green before the runtime detector is changed in Task 4.

- [ ] **Step 8: Make storage validation round-trip the nested profile**

First extend the storage test's seated profile with a valid `headControl` and the standing profile with `headControl: null`; observe the focused test fail. Add a save-seated-then-save-standing regression test proving the nested seated profile is not discarded. Then validate every neutral metric and the four thresholds as finite numbers, and validate every recorded direction as exactly `-1`, `0`, or `1`. Reject a seated nested profile containing non-finite or non-positive shoulder width values or an out-of-range direction. Treat a legacy standing profile with no `headControl` key as `headControl: null`; do not allow a legacy seated profile without head data to enter the new detector.

Run: `npm.cmd test -- --run tests/storage/calibration-profiles.test.ts tests/motion/calibration.test.ts tests/motion/motion-detector.test.ts`

Expected: both files PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add src/motion/head-control.ts src/motion/calibration.ts src/storage/calibration-profiles.ts tests/support/pose-sample.ts tests/motion/head-control.test.ts tests/motion/calibration.test.ts tests/motion/motion-detector.test.ts tests/storage/calibration-profiles.test.ts
git commit -m "feat: add personalized head geometry"
```

### Task 2: Five-Step Seated Calibration Session

**Files:**
- Modify: `src/motion/calibration-session.ts`
- Modify: `src/app/app-controller.ts` (time-only session ticks and state-change rendering)
- Modify: `tests/motion/calibration-session.test.ts`
- Modify: `tests/app/app-controller.test.ts`

**Interfaces:**
- Consumes: the Task 1 seated action list, `HeadAssessment.recordable`, signed `HeadAssessment.strength`, `recordHeadThreshold()`, and the existing `CalibrationSession` public API.
- Produces: seated snapshots with `face-neutral` as visible step one, `headRecognized`, `shouldersRecognized`, 6-second recovery, and a completed personalized `CalibrationProfile`.

- [ ] **Step 1: Write a failing ordered-flow test**

Add fixture helpers that move only indices `[0, 2, 5, 7, 8]`, and add:

```ts
it('completes seated neutral left right up and down in visible order', () => {
  const session = new CalibrationSession('seated')
  session.cameraReady()
  session.modelReady()

  feedNeutral(session, 0)
  expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral', completedSteps: 1 })
  session.update(poseSample(1_600))
  expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left', stepIndex: 1 })

  feedHeadAction(session, 1_680, { dx: 0.04 })
  advanceSuccess(session, 2_800)
  expect(session.snapshot().action).toBe('turn-right')

  feedHeadAction(session, 2_880, { dx: -0.04 })
  advanceSuccess(session, 4_000)
  expect(session.snapshot().action).toBe('look-up')

  feedHeadAction(session, 4_080, { dy: -0.03 })
  advanceSuccess(session, 5_200)
  expect(session.snapshot().action).toBe('look-down')

  feedHeadAction(session, 5_280, { dy: 0.03 })
  advanceSuccess(session, 6_400)
  expect(session.snapshot()).toMatchObject({ phase: 'complete', completedSteps: 5 })
  expect(session.snapshot().profile?.headControl).not.toBeNull()
})
```

Add a second test that feeds 900 ms of valid neutral evidence and expects the step to remain incomplete, feeds one bad frame and expects progress to decay but stay above zero, then reaches at least 1,000 ms of accumulated valid evidence and expects `face-neutral` success. This locks the neutral hold to approximately one second without making a single bad frame reset all progress.

- [ ] **Step 2: Run the session test and verify RED**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts`

Expected: FAIL because neutral baseline is not a visible completed step and seated actions still follow the old session behavior.

- [ ] **Step 3: Implement the seated branch without changing the standing branch**

Make these exact behavioral changes:

- `ACTION_RECOVERY_MS = 6_000` and `SUCCESS_DISPLAY_MS = 600`.
- Add `NEUTRAL_REQUIRED_EVIDENCE_MS = 1_000`; accumulate valid neutral evidence with the existing bounded sample delta and apply the existing miss-decay rate on bad frames while retaining valid baseline samples for profile construction.
- On seated `body-check`, start `baseline`, set `actionStartedAt`, and expose action `face-neutral`.
- After the seated neutral baseline builds a profile, call `confirmCurrentStep()` instead of entering action directly.
- After neutral success, advance to `stepIndex = 1` and action `turn-left`.
- For seated head steps, retain only `assessment.recordable === true` evidence, choosing the finite `assessment.strength` with the largest absolute magnitude while preserving its sign; on success call `recordHeadThreshold()` before `confirmCurrentStep()`. Never personalize from a missing-landmark, moving-shoulder, conflicting-support, or wrong-direction failure.
- Reset the observed strength when entering a new step.
- Keep the current standing baseline behavior: standing neutral baseline is not one of its five action steps.

Add an explicit time-only update so recovery can appear even when the recognizer stops yielding usable samples:

```ts
tick(now: number): CalibrationSnapshot {
  if (Number.isFinite(now)) this.lastCapturedAt = Math.max(this.lastCapturedAt, now)
  if (this.phase === 'step-success' && this.successAt !== null
    && this.lastCapturedAt - this.successAt >= SUCCESS_DISPLAY_MS) this.advanceAfterSuccess()
  return this.snapshot()
}
```

Call `tick(now)` from the controller capture loop and re-render whenever phase, action, or `canRecover` changes. This prevents both the six-second recovery UI and the 600 ms success-to-next-step transition from depending on another pose result arriving.

Expose status fields in `CalibrationSnapshot`:

```ts
headRecognized: boolean
shouldersRecognized: boolean
```

Derive them from the latest seated assessment using the current step's visibility rule: neutral requires both eyes and both ears for `headRecognized`, while turn/pitch actions require both eyes plus at least one usable ear. `shouldersRecognized` always reflects both usable shoulders. This prevents a valid real turn, where the far ear naturally loses confidence, from showing “头部未识别” at the same moment the action succeeds. Standing snapshots may continue to use existing required-landmark status.

- [ ] **Step 4: Write and run failing recovery tests**

Add:

```ts
it('offers recovery after six seconds during neutral or an action', () => {
  const neutral = new CalibrationSession('seated')
  neutral.cameraReady(); neutral.modelReady()
  neutral.update(poseSample(0))
  neutral.tick(6_100)
  expect(neutral.snapshot().canRecover).toBe(true)

  const action = readySeatedHeadSession()
  action.tick(8_000)
  expect(action.snapshot().canRecover).toBe(true)
})

it('retries only the current step and applies a bounded recommended profile', () => {
  const session = readySeatedHeadSession()
  const completedBefore = session.snapshot().completedActions
  session.tick(8_000)
  session.retryCurrentAction()
  expect(session.snapshot()).toMatchObject({ completedActions: completedBefore, holdProgress: 0, canRecover: false })

  session.tick(14_100)
  session.update(subthresholdRecordableHeadTurn(14_120))
  session.useRecommendedSensitivity()
  expect(session.snapshot().phase).toBe('step-success')
  expect(session.snapshot().profile?.headControl?.directions['turn-left']).not.toBe(0)
})

it('does not recommend-complete an action without recordable evidence', () => {
  const session = readySeatedHeadSession()
  session.update(shouldersMovingSample(7_000))
  session.tick(8_000)
  session.useRecommendedSensitivity()
  expect(session.snapshot()).toMatchObject({ phase: 'action', canRecover: true })
})

it('advances from success after 600 ms even when no new pose sample arrives', () => {
  const { session, successAt } = readySeatedHeadSessionAtSuccess()
  const action = session.snapshot().action
  session.tick(successAt + 599)
  expect(session.snapshot()).toMatchObject({ phase: 'step-success', action })
  session.tick(successAt + 600)
  expect(session.snapshot()).toMatchObject({ phase: 'action' })
  expect(session.snapshot().action).not.toBe(action)
})
```

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts -t "six seconds"`

Expected: FAIL until `canRecover` covers both seated `baseline` and `action` using the active step start time.

- [ ] **Step 5: Implement safe recovery**

`retryCurrentAction()` resets only current evidence, observed strength, and current step start. `useRecommendedSensitivity()` behaves as follows:

- During seated neutral: require at least one valid framed sample; build the profile and confirm neutral. If no valid sample exists, remain on neutral and show missing-face feedback.
- During a head action: if and only if at least one recordable signed strength exists, use the one with the largest absolute magnitude, bound it with Task 1's minimum and maximum threshold logic, and confirm only the current step. If no recordable evidence exists, remain on the step, keep recovery visible, and show the current corrective feedback; never substitute a direction or silently skip.
- During standing action: retain the existing recommended-sensitivity behavior.

- [ ] **Step 6: Update explicit snapshot fixtures and controller expectations**

Add `headRecognized` and `shouldersRecognized` to the `CalibrationSnapshot` fixture in `tests/app/app-controller.test.ts`. Change any seated action expectation from `lean-left` to `turn-left`; leave standing expectations unchanged. Add a controller clock test proving a session receives time-only ticks while calibration is active and re-renders on the 6-second recovery transition and the 600 ms success transition even when the pose recognizer yields no new result.

- [ ] **Step 7: Run focused and full session tests**

Run:

```powershell
npm.cmd test -- --run tests/motion/calibration-session.test.ts tests/app/app-controller.test.ts
npm.cmd run typecheck
```

Expected: all focused tests and TypeScript PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add src/motion/calibration-session.ts src/app/app-controller.ts tests/motion/calibration-session.test.ts tests/app/app-controller.test.ts
git commit -m "feat: add five-step head calibration"
```

### Task 3: Realistic Seated Guide and Continuous Feedback

**Files:**
- Create: `src/ui/head-calibration-guide.ts`
- Create: `tests/ui/head-calibration-guide.test.ts`
- Modify: `src/ui/calibration-view.ts`
- Modify: `src/style.css`
- Modify: `tests/ui/calibration-view.test.ts`

**Interfaces:**
- Consumes: seated `CalibrationSnapshot.action`, `headRecognized`, `shouldersRecognized`, feedback, progress, success, and recovery state.
- Produces: `renderHeadCalibrationGuide(snapshot)` with one realistic SVG outline and exactly five weak markers.

- [ ] **Step 1: Write the failing guide structure test**

Create:

```ts
import { describe, expect, it } from 'vitest'
import { renderHeadCalibrationGuide } from '../../src/ui/head-calibration-guide'

describe('head calibration guide', () => {
  it('renders a human outline with exactly five weak markers', () => {
    const guide = renderHeadCalibrationGuide({ headRecognized: true, shouldersRecognized: true })
    expect(guide.classList.contains('head-calibration-guide')).toBe(true)
    expect(guide.querySelector('[data-outline="human-head-shoulders"]')).not.toBeNull()
    expect(guide.querySelectorAll('[data-guide-point]')).toHaveLength(5)
    expect([...guide.querySelectorAll('[data-guide-point]')].map(node => node.getAttribute('data-guide-point'))).toEqual([
      'head-top', 'left-cheek', 'right-cheek', 'left-shoulder', 'right-shoulder',
    ])
  })
})
```

- [ ] **Step 2: Run the guide test and verify RED**

Run: `npm.cmd test -- --run tests/ui/head-calibration-guide.test.ts`

Expected: FAIL because the guide module does not exist.

- [ ] **Step 3: Implement the realistic SVG guide**

Build a `viewBox="0 0 300 360"` SVG with the approved outline path and five small circles. Anchor the rounded head top near y=20, natural cheeks/chin near y=180 (about 45% of the guide height), and the neck-to-shoulder transition near y=223 (about 12% neck height). The neck section must use x positions approximately 123 and 177 (about half the face width); include simple ear curves, and slope the shoulders naturally to x positions 15 and 285 so the visible shoulder width is about 1.8–2.2 times the head width. Use the approved visible point names from Step 1. Do not add nose, eye, ear, mesh, or skeleton circles.

The public function is:

```ts
export function renderHeadCalibrationGuide(status: {
  headRecognized: boolean
  shouldersRecognized: boolean
}): SVGSVGElement
```

Apply `recognized` only to the relevant head points/outline or shoulder points/outline so the view can change from cyan to green without changing geometry.

- [ ] **Step 4: Run the guide test and verify GREEN**

Run: `npm.cmd test -- --run tests/ui/head-calibration-guide.test.ts`

Expected: PASS with exactly five markers.

- [ ] **Step 5: Write failing seated view tests**

Update the snapshot factory with `headRecognized` and `shouldersRecognized`, then add:

```ts
it('renders seated neutral as a realistic face guide with explicit status', () => {
  const root = document.createElement('section')
  renderCalibration(root, snapshot({
    style: 'seated', phase: 'baseline', action: 'face-neutral', stepIndex: 0,
    headRecognized: true, shouldersRecognized: true,
  }), actions)

  expect(root.querySelector('.head-calibration-guide')).not.toBeNull()
  expect(root.querySelectorAll('[data-guide-point]')).toHaveLength(5)
  expect(root.querySelector('.pose-overlay')).toBeNull()
  expect(root.textContent).toContain('请正对手机')
  expect(root.textContent).toContain('头部已识别')
  expect(root.textContent).toContain('双肩已识别')
  expect(root.textContent).toContain('请将头部和双肩置于引导框内，保持正对手机。')
})

it.each([
  ['turn-left', '向左转头'],
  ['turn-right', '向右转头'],
  ['look-up', '抬头'],
  ['look-down', '低头'],
] as const)('renders %s seated prompt', (action, prompt) => {
  const root = document.createElement('section')
  renderCalibration(root, snapshot({ style: 'seated', phase: 'action', action }), actions)
  expect(root.querySelector('.calibration-instruction')?.textContent).toBe(prompt)
})
```

- [ ] **Step 6: Run the seated view tests and verify RED**

Run: `npm.cmd test -- --run tests/ui/calibration-view.test.ts`

Expected: FAIL because seated mode still renders the full pose overlay and generic rounded frame.

- [ ] **Step 7: Implement mode-specific view and copy**

- Seated calibration renders `renderHeadCalibrationGuide()` and never renders `renderPoseOverlay()`.
- Standing calibration retains its full-body frame and pose overlay.
- Add action copy for the five seated actions.
- Add feedback copy for all Task 1 codes, including `请只转头，双肩保持不动`.
- Show head and shoulder status chips during seated neutral/action steps.
- Keep the current success check and recovery buttons, but rename retry action text to `重新识别`.
- Keep model-loading and compatibility-mode UI unchanged.

- [ ] **Step 8: Implement approved CSS without changing page structure**

Add `.head-calibration-guide`, `.head-guide-outline`, `.head-guide-point`, and status-chip styles. Use a 3px cyan stroke, weak `drop-shadow(0 0 4px rgba(70,216,220,.28))`, 7px markers, and green recognized state. Add an explicit `head-guide-frame` class from the view and use that class to remove the old rounded border and pulse; do not rely on the newer CSS `:has()` selector on target Android browsers. Preserve status panel, progress, step header, and reduced-motion behavior.

- [ ] **Step 9: Run all UI tests and typecheck**

Run:

```powershell
npm.cmd test -- --run tests/ui/head-calibration-guide.test.ts tests/ui/calibration-view.test.ts tests/ui/pose-overlay.test.ts
npm.cmd run typecheck
```

Expected: seated guide and copy tests PASS; the standing pose-overlay test remains green.

- [ ] **Step 10: Commit Task 3**

```powershell
git add src/ui/head-calibration-guide.ts src/ui/calibration-view.ts src/style.css tests/ui/head-calibration-guide.test.ts tests/ui/calibration-view.test.ts
git commit -m "feat: render realistic head calibration guide"
```

### Task 4: Personalized Head Events and Seated Game Rules

**Files:**
- Modify: `src/motion/motion-detector.ts`
- Modify: `tests/motion/motion-detector.test.ts`
- Modify: `src/game/types.ts`
- Modify: `src/game/game-engine.ts`
- Modify: `tests/game/game-engine.test.ts`

**Interfaces:**
- Consumes: `HeadControlProfile` and `assessHeadGameConditions()` from Task 1.
- Produces: seated motion events `turn-left`, `turn-right`, `head-up`, `head-down`; `GameState.playerAction` and `playerActionUntil`.

- [ ] **Step 1: Write failing seated detector tests**

Add a calibrated head profile fixture, then test:

```ts
it('emits seated head controls and no seated lean or hands-up events', () => {
  const detector = new MotionDetector(seatedHeadProfile, 'seated')
  const samples = [
    moveFace(0, 0.04, 0), moveFace(140, 0.04, 0),
    poseSample(360), poseSample(560),
    moveFace(640, 0, -0.03), moveFace(760, 0, -0.03),
    poseSample(980), poseSample(1_180),
    moveFace(1_260, 0, 0.03), moveFace(1_460, 0, 0.03),
  ]
  const types = samples.flatMap(sample => detector.update(sample)).map(event => event.type)
  expect(types).toContain('turn-left')
  expect(types).toContain('head-up')
  expect(types).toContain('head-down')
  expect(types).not.toContain('lean-left')
  expect(types).not.toContain('hands-up')
})

it('requires neutral before the same seated head action can fire again', () => {
  const detector = new MotionDetector(seatedHeadProfile, 'seated')
  const held = [moveFace(0, 0.04), moveFace(140, 0.04), moveFace(280, 0.04), moveFace(420, 0.04)]
  expect(held.flatMap(sample => detector.update(sample)).filter(event => event.type === 'turn-left')).toHaveLength(1)
})

it('does not re-arm at 70 percent strength and re-arms only inside the 45 percent neutral zone', () => {
  const detector = new MotionDetector(seatedHeadProfile, 'seated')
  const first = fireTurnLeft(detector, 0)
  const notNeutral = holdTurnStrength(detector, first.occurredAt + 200, 0.70, 240)
  const blocked = fireTurnLeft(detector, first.occurredAt + 500)
  expect([...notNeutral, ...blocked].filter(event => event.type === 'turn-left')).toHaveLength(0)

  holdTurnStrength(detector, first.occurredAt + 900, 0.40, 180)
  expect(fireTurnLeft(detector, first.occurredAt + 1_200).type).toBe('turn-left')
})

it('accepts a quick head-up transition but rejects slow vertical drift', () => {
  const quick = new MotionDetector(seatedHeadProfile, 'seated')
  expect([
    poseSample(0), moveFace(120, 0, -0.03), moveFace(220, 0, -0.03),
  ].flatMap(sample => quick.update(sample)).some(event => event.type === 'head-up')).toBe(true)

  const slow = new MotionDetector(seatedHeadProfile, 'seated')
  expect([
    poseSample(0), moveFace(250, 0, -0.008), moveFace(500, 0, -0.016),
    moveFace(750, 0, -0.024), moveFace(1_000, 0, -0.03),
  ].flatMap(sample => slow.update(sample)).some(event => event.type === 'head-up')).toBe(false)
})

it('emits no legacy seated body events when headControl is absent', () => {
  const detector = new MotionDetector({ ...standingProfile, headControl: null }, 'seated')
  expect([leanSample(0), handsUpSample(200), duckSample(400)].flatMap(sample => detector.update(sample))).toEqual([])
})
```

- [ ] **Step 2: Run detector tests and verify RED**

Run: `npm.cmd test -- --run tests/motion/motion-detector.test.ts`

Expected: FAIL because the new event types and seated head-condition branch do not exist.

- [ ] **Step 3: Implement seated event detection and preserve standing conditions**

Extend `MotionType` with `turn-left | turn-right | head-up | head-down`. For seated profiles with non-null `headControl`, consume `HeadGameSignals.triggered`, `.neutral`, `.strengths`, `.trackable`, and `.confidence` exclusively from `assessHeadGameConditions()`. A seated detector constructed without `headControl` must return no motion events and must never fall back to the old seated lean/duck/hands branch; the app boundary requires recalibration instead. Compare live projected strengths with the recorded directions rather than assuming fixed coordinate signs; opposite directions must remain mutually exclusive. For standing, execute the existing lean, duck, hands-up, and squat calculation unchanged. Keep the 320 ms quick-head-up transition state and all hold/re-arm timestamps inside `MotionDetector`, not the pure geometry module.

Use hold durations:

```ts
const holdDuration = (type: MotionType): number =>
  type === 'head-up' ? 80 : type === 'head-down' ? 180 : 120
```

Keep the existing 160 ms neutral release gate. Define seated neutral as absolute signed strength at or below 45% of that action's personalized trigger threshold; an action cannot re-arm until this zone is held for the full gate. For `head-up`, additionally require the motion to travel from the neutral zone to its trigger threshold within 320 ms; gradual drift must not trigger. `head-down` uses the 180 ms sustained hold instead. Require indices `[0, 2, 5, 11, 12]` plus at least one usable ear for seated confidence.

- [ ] **Step 4: Run detector tests and verify GREEN**

Run: `npm.cmd test -- --run tests/motion/motion-detector.test.ts`

Expected: all detector tests PASS, including existing standing cases.

- [ ] **Step 5: Write failing seated game tests**

Replace the old seated “no squat” test with exact obstacle semantics:

```ts
it('schedules only lane jump and duck head controls for seated mode', () => {
  const state = createGame({ playStyle: 'seated', sessionKind: 'standard', seed: 4 })
  const allowed = new Set(['turn-left', 'turn-right', 'head-up', 'head-down'])
  expect(state.obstacles.every(obstacle => allowed.has(obstacle.requiredMotion))).toBe(true)
  expect(state.obstacles.some(obstacle => obstacle.requiredMotion === 'hands-up')).toBe(false)
})

it('turns lanes and records short jump and duck display states', () => {
  let state = createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 3 })
  state = advanceGame(state, 100, [{ type: 'turn-left', occurredAt: 100, confidence: 0.9 }]).state
  expect(state.playerLane).toBe(-1)
  state = advanceGame(state, 100, [{ type: 'head-up', occurredAt: 200, confidence: 0.9 }]).state
  expect(state.playerAction).toBe('jump')
  state = advanceGame(state, 700, []).state
  expect(state.playerAction).toBe('neutral')
  state = advanceGame(state, 100, [{ type: 'head-down', occurredAt: 1_000, confidence: 0.9 }]).state
  expect(state.playerAction).toBe('duck')
})

it('resolves jump and duck obstacles only with their matching head events without changing scoring rules', () => {
  const jump = gameAtObstacle('seated', 'head-up')
  expect(advanceGame(jump, 100, [headEvent('head-down')]).state.collisions).toBe(jump.collisions + 1)
  expect(advanceGame(jump, 100, [headEvent('head-up')]).state.collisions).toBe(jump.collisions)

  const duck = gameAtObstacle('seated', 'head-down')
  expect(advanceGame(duck, 100, [headEvent('head-up')]).state.collisions).toBe(duck.collisions + 1)
  expect(advanceGame(duck, 100, [headEvent('head-down')]).state.collisions).toBe(duck.collisions)
})
```

- [ ] **Step 6: Run game tests and verify RED**

Run: `npm.cmd test -- --run tests/game/game-engine.test.ts`

Expected: FAIL because seated obstacles still use lean/duck/hands-up and the game has no display action state.

- [ ] **Step 7: Implement seated obstacle selection and action state**

Add to `GameState`:

```ts
playerAction: 'neutral' | 'jump' | 'duck'
playerActionUntil: number
```

Initialize both in `createGame()`. Seated obstacle motions are `turn-left`, `turn-right`, `head-up`, and `head-down`; standing motions remain unchanged. Treat both `turn-*` and `lean-*` as lane motions through one `isLaneMotion()` helper. Set jump for 600 ms and duck for 650 ms; reset to neutral when `elapsedMs >= playerActionUntil`.

- [ ] **Step 8: Run game and detector regression tests**

Run: `npm.cmd test -- --run tests/game/game-engine.test.ts tests/motion/motion-detector.test.ts`

Expected: PASS with seated and standing behaviors separated.

- [ ] **Step 9: Commit Task 4**

```powershell
git add src/motion/motion-detector.ts src/game/types.ts src/game/game-engine.ts tests/motion/motion-detector.test.ts tests/game/game-engine.test.ts
git commit -m "feat: control seated game with head gestures"
```

### Task 5: Game Visuals, Copy, Fixtures, and Mobile Flow

**Files:**
- Modify: `src/render/ski-renderer.ts`
- Modify: `tests/render/ski-renderer.test.ts`
- Modify: `src/ui/screens.ts`
- Modify: `tests/ui/screens.test.ts`
- Modify: `src/app/app-controller.ts`
- Modify: `src/main.ts`
- Modify: `package.json`
- Modify: `tests/app/app-controller.test.ts`
- Modify: `tests/smoke.test.ts`
- Modify: `e2e/happy-path.spec.ts`
- Create: `e2e/deployed-smoke.spec.ts`

**Interfaces:**
- Consumes: Task 4 obstacle motion types and `GameState.playerAction`.
- Produces: distinct lane/jump/duck obstacle visuals, player jump/duck transforms, seated copy, deterministic head fixtures, and a complete mobile E2E path.

- [ ] **Step 1: Write failing pure renderer mapping tests**

Export and test:

```ts
expect(getObstacleVisual('turn-left')).toBe('lane')
expect(getObstacleVisual('head-up')).toBe('jump')
expect(getObstacleVisual('head-down')).toBe('duck')
expect(getPlayerTransform({ action: 'jump', lane: 0, width: 390, height: 844 }).y).toBeLessThan(
  getPlayerTransform({ action: 'neutral', lane: 0, width: 390, height: 844 }).y,
)
expect(getPlayerTransform({ action: 'duck', lane: 0, width: 390, height: 844 }).scaleY).toBeLessThan(1)
expect(shouldDrawHeadControlSkier('seated')).toBe(true)
expect(shouldDrawHeadControlSkier('standing')).toBe(false)
```

Run: `npm.cmd test -- --run tests/render/ski-renderer.test.ts`

Expected: FAIL because the mapping and player transform functions do not exist.

- [ ] **Step 2: Implement distinct visuals and player feedback**

Add:

```ts
export type ObstacleVisual = 'lane' | 'jump' | 'duck' | 'hands' | 'squat'
export function getObstacleVisual(motion: MotionType): ObstacleVisual
export function shouldDrawHeadControlSkier(style: PlayStyle): boolean
export function getPlayerTransform(options: {
  action: GameState['playerAction']; lane: -1 | 0 | 1; width: number; height: number
}): { x: number; y: number; scaleY: number }
```

Draw a low horizontal log for `jump`, an overhead gate with open lower space for `duck`, and a lane blocker for `lane`. Draw the new skier after obstacles and before the HUD only when `state.playStyle === 'seated'`; jump moves the skier upward and duck compresses the skier vertically. Do not add or alter a standing-mode character layer. Keep low-quality mode free of shadows and extra snow.

- [ ] **Step 3: Run renderer tests and verify GREEN**

Run: `npm.cmd test -- --run tests/render/ski-renderer.test.ts`

Expected: all renderer tests PASS.

- [ ] **Step 4: Write failing copy/result tests**

Add `playStyle: PlayStyle` to `ResultView`. Update the result test:

```ts
renderResults(root, {
  playStyle: 'seated', score: 900, distance: 320, bestCombo: 7,
  collisions: 1, activeMs: 30_000,
  motionCounts: { 'turn-left': 3, 'head-up': 2, 'head-down': 1 },
}, vi.fn())
expect(root.textContent).toContain('转头变道 3 次')
expect(root.textContent).toContain('跳跃 2 次')
expect(root.textContent).toContain('俯身 1 次')
```

Also assert seated setup copy contains `转头变道 · 抬头跳跃 · 低头躲避` and standing copy retains existing full-body semantics.

- [ ] **Step 5: Implement mode-specific screen copy**

- Welcome lead: use general head/body motion language valid for both modes.
- Seated setup: `转头变道 · 抬头跳跃 · 低头躲避`.
- Standing setup: retain side-body, hands, low-head, and squat wording.
- Seated results count both turn directions, `head-up`, and `head-down`.
- Standing results retain current lean, duck, hands-up, and squat counts.

Run: `npm.cmd test -- --run tests/ui/screens.test.ts`

Expected: PASS.

- [ ] **Step 6: Replace seated fixture motion with head-only samples**

In `createSeatedFixtureSamples()`, initialize indices 2, 5, 7, and 8. Replace shoulder-shift/hands actions with:

```ts
...action(1_000, faceChanges({ dx: 0.04 })),
...action(2_300, faceChanges({ dx: -0.04 })),
...action(3_600, faceChanges({ dy: -0.03 })),
...action(4_900, faceChanges({ dy: 0.03 })),
```

The neutral samples remain first. Change start/resume game hints to `转头变道 · 抬头跳跃 · 低头躲避` for seated and preserve standing hints. Update the quick fixture result counts to the new seated motion types. Add `standing-soft-success` as a separate deterministic fixture that keeps the existing standing calibration actions and full-body landmarks; fixture dispatch must select samples by both fixture mode and chosen play style.

- [ ] **Step 7: Update controller tests for deterministic head fixtures**

Assert that completed seated calibration creates a `MotionDetector` with non-null `headControl`, that seated hints use head language, and that standing start still uses the existing full-body language.

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts`

Expected: PASS.

- [ ] **Step 8: Update mobile E2E tests**

Replace the moving-skeleton seated assertion with the approved guide assertions:

```ts
await expect(page.locator('.head-calibration-guide')).toBeVisible()
await expect(page.locator('[data-guide-point]')).toHaveCount(5)
await expect(page.locator('.pose-overlay')).toHaveCount(0)
await expect(page.getByText('请正对手机')).toBeVisible()
await expect(page.getByText('校准完成')).toBeVisible({ timeout: 8_000 })
```

Keep the no-external-upload assertion. Update the stuck-action test to provide subthreshold-but-recordable motion, expect `重新识别` and `使用推荐灵敏度` after six seconds, click the recommendation, and verify that seated step succeeds. Add a negative fixture with only shoulder/body movement and assert the recommendation cannot complete that step. Add a standing fixture test that selects standing mode, verifies the existing full-body overlay, completes calibration, and reaches the game/result flow without any head-guide UI.

In the seated quick fixture, drive all four game events against deterministic matching obstacles and expose stable DOM diagnostics (for test builds only) for last motion, resolved obstacle kind, collision count, and player action. Assert left/right change lanes, `head-up` resolves only the jump obstacle, `head-down` resolves only the duck obstacle, and the jump/duck player state becomes visible. This is the integration proof required before deployment; it must exercise the controller, detector, game engine, and renderer rather than only unit helpers.

Create `e2e/deployed-smoke.spec.ts` gated by `PUBLIC_BASE_URL`. It opens `${PUBLIC_BASE_URL}/?poseFixture=seated-soft-success` with the existing 390×844 mobile context, completes the public fixture calibration, verifies the five-point guide and seated game hint, then opens `standing-soft-success` and verifies the standing entry/full-body overlay. Skip this file when `PUBLIC_BASE_URL` is absent so local full-suite behavior stays deterministic.

Make that public fixture path executable without enabling fixtures in ordinary hosting builds: change `src/main.ts` to read the query only when `import.meta.env.DEV || import.meta.env.MODE === 'pages'`, while still accepting only the explicit `PoseFixtureMode` allowlist. Change `build:pages` to invoke `vite build --mode pages ...`; the normal `build:hosting` command remains in ordinary production mode with fixtures disabled. Add a main bootstrap test or extracted pure allowlist parser test proving an arbitrary query value is ignored and a known mode is accepted only when the gate is enabled.

Keep every fixture calibration step observable for at least one browser frame (or expose a deterministic completion marker before advancing). Do not let the 20 ms fixture cadence skip the 600 ms success state that the E2E test must verify.

- [ ] **Step 9: Run focused integration and E2E tests**

Run:

```powershell
npm.cmd test -- --run tests/smoke.test.ts tests/render/ski-renderer.test.ts tests/ui/screens.test.ts tests/app/app-controller.test.ts
npm.cmd run test:e2e
```

Expected: all selected tests and all mobile E2E paths PASS.

- [ ] **Step 10: Commit Task 5**

```powershell
git add package.json src/main.ts src/render/ski-renderer.ts src/ui/screens.ts src/app/app-controller.ts tests/smoke.test.ts tests/render/ski-renderer.test.ts tests/ui/screens.test.ts tests/app/app-controller.test.ts e2e/happy-path.spec.ts e2e/deployed-smoke.spec.ts
git commit -m "feat: finish seated head-control experience"
```

### Task 6: Full Verification, Integration, and GitHub Pages Publication

**Files:**
- Verify: all files changed in Tasks 1-5
- Build output: `dist/` (generated, not committed)

**Interfaces:**
- Consumes: the complete seated head-control feature and existing GitHub Pages workflow.
- Produces: verified `master` deployed at `https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`.

- [ ] **Step 1: Run fresh complete verification**

Run each command and stop on the first non-zero exit:

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build:pages
npm.cmd run test:e2e
```

Expected: all unit files and tests PASS, TypeScript exits 0, Pages assets verify, and every Playwright test passes.

- [ ] **Step 2: Review spec coverage and final diff**

Run:

```powershell
git diff master...HEAD --check
git diff master...HEAD --stat
git status --short
```

Manually confirm from the diff that seated mode has five head steps, exactly five visible guide markers, 6-second recovery, new game actions, no hands-up seated obstacles, and that standing branches remain present.

- [ ] **Step 3: Finish and merge the development branch**

Invoke `superpowers:finishing-a-development-branch`. Use the previously approved local-merge workflow: merge `codex/half-body-head-control` into `master`, rerun the complete verification commands on merged `master`, then remove the owned worktree and feature branch only after successful verification.

- [ ] **Step 4: Push the verified master branch**

Run: `git push github master`

Expected: remote `master` advances to the verified head-control commit.

- [ ] **Step 5: Wait for Pages and verify public resources**

Wait for the workflow associated with the pushed HEAD to report `completed/success`. Request the public page, its referenced JavaScript bundle, `pose_landmarker.task`, and both SIMD/non-SIMD WASM resources. Every request must return HTTP 200.

Confirm the deployed bundle contains `head-calibration-guide`, `turn-left`, `head-up`, and `使用推荐灵敏度`, and that the deployed HTML references the new bundle hash.

Then run the public mobile fixture smoke against the deployed origin:

```powershell
$env:PUBLIC_BASE_URL='https://liuyeyang2012-creator.github.io/motion-ski-game-2026'
npx.cmd playwright test e2e/deployed-smoke.spec.ts
Remove-Item Env:PUBLIC_BASE_URL
```

Expected: both seated and standing public fixture paths PASS at the mobile viewport. This complements, but does not replace, the user's final real-camera phone acceptance because browser automation cannot prove physical head tracking on the target handset.

- [ ] **Step 6: Report the phone acceptance path**

Give the user the public URL and this exact flow: allow camera once; align head, ears, thick neck, and shoulders with the realistic guide; wait for neutral success; complete left, right, up, and down one at a time; use recovery controls if a step exceeds six seconds; enter the game and verify turn-to-lane, head-up jump, and head-down duck.
