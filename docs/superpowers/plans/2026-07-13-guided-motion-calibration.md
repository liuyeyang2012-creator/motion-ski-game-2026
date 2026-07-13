# Guided Half-Body and Full-Body Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the timer-driven calibration loop with a five-step, recognition-confirmed flow that uses a prominent camera framing guide and independent half-body and full-body profiles.

**Architecture:** Keep MediaPipe pose acquisition unchanged, but route every pose sample through a new pure `CalibrationSession` state machine. `calibration.ts` owns framing rules, profile construction, and action matching; `calibration-session.ts` owns progression and hold timing; `AppController` only renders state updates and starts the game after completion.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, Playwright, MediaPipe Tasks Vision, HTML/CSS, Sites hosting.

## Global Constraints

- Half-body mode must work without hips or knees visible and target a typical phone distance of about 50–80 cm.
- Full-body mode must require head, shoulders, hips, and knees before calibration begins.
- Calibration actions must be confirmed one at a time; waiting alone must never advance a step.
- An action must match continuously for 400 ms before success.
- Successful feedback remains visible for 450 ms before the next action.
- Pose loss longer than 1.5 seconds pauses only the current step and never clears completed steps.
- Use the approved A-style bright cyan body frame, dimmed exterior, green success border, check mark, and optional light vibration.
- Half-body actions are left lean, right lean, duck, hands up, and both arms extended.
- Full-body actions are left lean, right lean, duck, hands up, and a shallow squat.
- Camera processing stays on-device; no frames or landmarks are uploaded or persisted.

---

## File Structure

- `src/motion/calibration.ts`: mode-specific framing validation, baseline profile creation, and pure action matching.
- `src/motion/calibration-session.ts`: five-step calibration state machine and 400/450/1500 ms timing.
- `src/app/app-controller.ts`: connect pose samples to `CalibrationSession`, render updates, vibrate, and start the game.
- `src/ui/calibration-view.ts`: render the approved high-contrast framing overlay and calibration status.
- `src/style.css`: camera visibility, dimmed mask, half/full frame shapes, progress, and success styling.
- `src/camera/camera-controller.ts`: request the front camera and apply the minimum supported zoom.
- `src/motion/motion-detector.ts`: use shoulder-only center in half-body mode and hip-aware center in full-body mode.
- `tests/motion/calibration.test.ts`: framing, profile, and action predicate tests.
- `tests/motion/calibration-session.test.ts`: state progression, hold timing, wrong-action, and pose-loss tests.
- `tests/ui/calibration-view.test.ts`: frame variant, copy, progress, and success-state tests.
- `tests/camera/camera-controller.test.ts`: minimum-zoom camera behavior.
- `tests/motion/motion-detector.test.ts`: half-body detection without hip landmarks and full-body squat behavior.
- `e2e/happy-path.spec.ts`: fixture-mode calibration completion and result-page regression.

---

### Task 1: Mode-Specific Framing and Profiles

**Files:**
- Modify: `src/motion/calibration.ts`
- Create: `tests/motion/calibration.test.ts`
- Modify: `tests/motion/motion-detector.test.ts`

**Interfaces:**
- Produces: `CalibrationAction`, `FramingIssue`, `FramingResult`, `CalibrationProfile`, `getCalibrationActions(style)`, `checkFraming(sample, style)`, `buildCalibration(samples, style)`, and `matchesCalibrationAction(profile, sample, style, action)`.
- Consumes: `PlayStyle` and `PoseSample`.

- [ ] **Step 1: Write failing framing and profile tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildCalibration, checkFraming, getCalibrationActions } from '../../src/motion/calibration'
import { poseSample } from '../support/pose-sample'

describe('mode-specific calibration', () => {
  it('accepts half-body framing when hips and knees are absent', () => {
    const sample = poseSample(0, { hidden: [23, 24, 25, 26] })
    expect(checkFraming(sample, 'seated')).toEqual({ ok: true })
    expect(buildCalibration([sample], 'seated').ok).toBe(true)
  })

  it('requires hips and knees for full-body framing', () => {
    const sample = poseSample(0, { hidden: [23, 24, 25, 26] })
    expect(checkFraming(sample, 'standing')).toEqual({ ok: false, issue: 'lower-body-not-visible' })
  })

  it('uses reach for half-body and squat for full-body step five', () => {
    expect(getCalibrationActions('seated')).toEqual(['lean-left', 'lean-right', 'duck', 'hands-up', 'reach'])
    expect(getCalibrationActions('standing')).toEqual(['lean-left', 'lean-right', 'duck', 'hands-up', 'squat'])
  })
})
```

- [ ] **Step 2: Add the shared pose fixture used by new tests**

Create `tests/support/pose-sample.ts`:

```ts
import type { PoseSample } from '../../src/pose/types'

export function poseSample(capturedAt: number, options: { hidden?: number[]; changes?: Record<number, Partial<{ x: number; y: number; visibility: number }>> } = {}): PoseSample {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  Object.assign(landmarks[0], { x: 0.5, y: 0.2 })
  Object.assign(landmarks[11], { x: 0.4, y: 0.4 })
  Object.assign(landmarks[12], { x: 0.6, y: 0.4 })
  Object.assign(landmarks[15], { x: 0.4, y: 0.65 })
  Object.assign(landmarks[16], { x: 0.6, y: 0.65 })
  Object.assign(landmarks[23], { x: 0.43, y: 0.7 })
  Object.assign(landmarks[24], { x: 0.57, y: 0.7 })
  Object.assign(landmarks[25], { x: 0.43, y: 0.9 })
  Object.assign(landmarks[26], { x: 0.57, y: 0.9 })
  for (const index of options.hidden ?? []) landmarks[index].visibility = 0
  for (const [index, change] of Object.entries(options.changes ?? {})) Object.assign(landmarks[Number(index)], change)
  return { capturedAt, landmarks, confidence: 0.95 }
}
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `npm.cmd test -- --run tests/motion/calibration.test.ts`

Expected: FAIL because `checkFraming`, `getCalibrationActions`, and the new seated framing behavior do not exist.

- [ ] **Step 4: Implement mode-specific framing, profiles, and action predicates**

Use these public types and constants in `src/motion/calibration.ts`:

```ts
export type CalibrationAction = 'lean-left' | 'lean-right' | 'duck' | 'hands-up' | 'reach' | 'squat'
export type FramingIssue = 'pose-lost' | 'head-not-visible' | 'shoulders-not-visible' | 'hands-not-visible' | 'lower-body-not-visible'
export type FramingResult = { ok: true } | { ok: false; issue: FramingIssue }

export interface CalibrationProfile {
  shoulderWidth: number
  torsoCenterX: number
  headY: number
  wristY: number
  hipY: number | null
  kneeY: number | null
}

export const getCalibrationActions = (style: PlayStyle): readonly CalibrationAction[] => style === 'seated'
  ? ['lean-left', 'lean-right', 'duck', 'hands-up', 'reach']
  : ['lean-left', 'lean-right', 'duck', 'hands-up', 'squat']
```

Implement `checkFraming()` so seated requires landmarks `0, 11, 12, 15, 16` with visibility at least `0.6`, while standing additionally requires `23, 24, 25, 26`. Build seated `torsoCenterX` from shoulders only and set `hipY` and `kneeY` to `null`; standing uses shoulders and hips and records both lower-body values. Implement `matchesCalibrationAction()` with the existing ratios and return `false` whenever the landmarks required by that action are unavailable.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm.cmd test -- --run tests/motion/calibration.test.ts tests/motion/motion-detector.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/motion/calibration.ts tests/motion/calibration.test.ts tests/motion/motion-detector.test.ts tests/support/pose-sample.ts
git commit -m "feat: separate half and full body calibration profiles"
```

---

### Task 2: Recognition-Confirmed Calibration State Machine

**Files:**
- Create: `src/motion/calibration-session.ts`
- Create: `tests/motion/calibration-session.test.ts`

**Interfaces:**
- Consumes: `CalibrationAction`, `CalibrationProfile`, `buildCalibration`, `checkFraming`, `getCalibrationActions`, `matchesCalibrationAction`, `PlayStyle`, and `PoseSample`.
- Produces: `CalibrationSession`, `CalibrationSnapshot`, and `CalibrationPhase`.

- [ ] **Step 1: Write failing state-machine tests**

```ts
import { describe, expect, it } from 'vitest'
import { CalibrationSession } from '../../src/motion/calibration-session'
import { poseSample } from '../support/pose-sample'

describe('CalibrationSession', () => {
  it('does not advance for time or the wrong action', () => {
    const session = new CalibrationSession('seated')
    for (let time = 0; time <= 800; time += 80) session.update(poseSample(time))
    expect(session.snapshot().phase).toBe('action')
    expect(session.snapshot().stepIndex).toBe(0)
    for (let time = 880; time <= 1520; time += 80) session.update(poseSample(time, { changes: { 0: { y: 0.3 } } }))
    expect(session.snapshot().stepIndex).toBe(0)
  })

  it('confirms an action only after 400 ms of continuous matching', () => {
    const session = readyHalfBodySession()
    session.update(leftLean(1000))
    session.update(leftLean(1320))
    expect(session.snapshot().phase).toBe('action')
    session.update(leftLean(1400))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('keeps completed steps after pose loss longer than 1500 ms', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(poseSample(3000, { hidden: [0, 11, 12, 15, 16] }))
    session.update(poseSample(4600, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'framing', stepIndex: 1, completedSteps: 1 })
  })
})
```

The same test file must use these deterministic helpers; no timers or mocks are needed because sample timestamps drive the state machine:

```ts
function readyHalfBodySession(): CalibrationSession {
  const session = new CalibrationSession('seated')
  for (let time = 0; time <= 640; time += 80) session.update(poseSample(time))
  return session
}

function leftLean(time: number) {
  return poseSample(time, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 } } })
}

function sessionWithFirstStepCompleted(): CalibrationSession {
  const session = readyHalfBodySession()
  for (let time = 800; time <= 1200; time += 80) session.update(leftLean(time))
  session.update(poseSample(1650))
  return session
}
```

- [ ] **Step 2: Run the state-machine tests and verify RED**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts`

Expected: FAIL because `CalibrationSession` does not exist.

- [ ] **Step 3: Implement the state machine**

Create these exact public shapes:

```ts
export type CalibrationPhase = 'framing' | 'baseline' | 'action' | 'step-success' | 'complete'

export interface CalibrationSnapshot {
  phase: CalibrationPhase
  style: PlayStyle
  stepIndex: number
  totalSteps: 5
  completedSteps: number
  action: CalibrationAction | null
  holdProgress: number
  framingIssue: FramingIssue | null
  profile: CalibrationProfile | null
}

export class CalibrationSession {
  constructor(style: PlayStyle)
  update(sample: PoseSample): CalibrationSnapshot
  snapshot(): CalibrationSnapshot
}
```

Use `400` ms for action hold, `450` ms for success display, `1500` ms for pose-loss recovery, and collect at least `8` valid neutral samples spanning at least `600` ms before building the baseline. Reset only `candidateAt` when the current action stops matching. Preserve `stepIndex` and the profile during framing recovery. Return `complete` only after the fifth `step-success` has lasted 450 ms.

- [ ] **Step 4: Run the state-machine tests and verify GREEN**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/motion/calibration-session.ts tests/motion/calibration-session.test.ts
git commit -m "feat: confirm calibration actions one at a time"
```

---

### Task 3: High-Contrast Calibration Camera Overlay

**Files:**
- Create: `src/ui/calibration-view.ts`
- Create: `tests/ui/calibration-view.test.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `CalibrationSnapshot`.
- Produces: `renderCalibration(root, snapshot)` and `getCalibrationInstruction(snapshot)`.

- [ ] **Step 1: Write failing UI tests**

```ts
import { describe, expect, it } from 'vitest'
import { renderCalibration } from '../../src/ui/calibration-view'

describe('calibration view', () => {
  it('renders the approved half-body framing guide and progress', () => {
    const root = document.createElement('section')
    renderCalibration(root, snapshot({ style: 'seated', phase: 'action', stepIndex: 1, action: 'lean-right' }))
    expect(root.querySelector('.calibration-frame')?.classList).toContain('half-body')
    expect(root.textContent).toContain('第 2/5 步')
    expect(root.textContent).toContain('向右侧身')
  })

  it('renders a green check only for step success', () => {
    const root = document.createElement('section')
    renderCalibration(root, snapshot({ phase: 'step-success', completedSteps: 2 }))
    expect(root.querySelector('.calibration-frame')?.classList).toContain('success')
    expect(root.textContent).toContain('校准成功')
  })
})
```

Define the local `snapshot(overrides)` helper with a complete default `CalibrationSnapshot` object so tests do not cast partial data.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm.cmd test -- --run tests/ui/calibration-view.test.ts`

Expected: FAIL because `calibration-view.ts` does not exist.

- [ ] **Step 3: Implement the calibration view**

Render this stable structure so CSS and tests have explicit hooks:

```html
<div class="calibration-screen">
  <div class="calibration-shade"></div>
  <div class="calibration-frame half-body|full-body|success" aria-hidden="true"></div>
  <div class="calibration-status" role="status" aria-live="polite">
    <p class="calibration-step">第 2/5 步</p>
    <h2>向右侧身</h2>
    <div class="calibration-progress"><i style="--progress: 0.6"></i></div>
    <p class="calibration-help">保持动作，识别成功后自动进入下一步</p>
  </div>
</div>
```

Map framing issues to exact actionable copy: `head-not-visible` → `请调整手机角度，让头部进入框内`; `shoulders-not-visible` → `请把双肩放入高亮框`; `hands-not-visible` → `请把双手放入高亮框`; `lower-body-not-visible` → `请稍微后退，让髋部和膝盖进入框内`; `pose-lost` → `请回到高亮框中央`.

- [ ] **Step 4: Add the approved A-style CSS**

In `src/style.css`, make `#camera-preview` opacity `0.82` only while `body.calibrating` is present and keep it `0` otherwise. Add a cyan `4px` frame with an exterior dimming shadow, distinct half/full shapes, a green `.success` state, and bottom status card. Respect `prefers-reduced-motion` by disabling pulse/transition animation.

- [ ] **Step 5: Run UI and smoke tests and verify GREEN**

Run: `npm.cmd test -- --run tests/ui/calibration-view.test.ts tests/smoke.test.ts tests/ui/screens.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/ui/calibration-view.ts src/style.css tests/ui/calibration-view.test.ts
git commit -m "feat: add high contrast calibration framing guide"
```

---

### Task 4: Camera Wide-View Preference

**Files:**
- Modify: `src/camera/camera-controller.ts`
- Modify: `tests/camera/camera-controller.test.ts`

**Interfaces:**
- Produces: unchanged `CameraController.start(video): Promise<MediaStream>` API.
- Consumes: browser `MediaStreamTrack.getCapabilities()` and `applyConstraints()` when available.

- [ ] **Step 1: Write the failing minimum-zoom test**

Extend `tests/camera/camera-controller.test.ts`:

```ts
it('uses the minimum supported front-camera zoom for the widest view', async () => {
  const applyConstraints = vi.fn().mockResolvedValue(undefined)
  const track = {
    enabled: true,
    stop: vi.fn(),
    getCapabilities: () => ({ zoom: { min: 0.5, max: 3, step: 0.1 } }),
    applyConstraints,
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement
  await new CameraController().start(video)
  expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 0.5 }] })
})
```

- [ ] **Step 2: Run the camera tests and verify RED**

Run: `npm.cmd test -- --run tests/camera/camera-controller.test.ts`

Expected: FAIL because `applyConstraints()` is not called.

- [ ] **Step 3: Apply the widest supported view without breaking unsupported phones**

Request `facingMode: { ideal: 'user' }`, `width: { ideal: 1280 }`, and `height: { ideal: 720 }`. After receiving the stream, read the first video track. If its capabilities expose a finite `zoom.min`, call `applyConstraints({ advanced: [{ zoom: min }] })`; catch only that optional constraint failure and continue using the original stream.

- [ ] **Step 4: Run camera tests and verify GREEN**

Run: `npm.cmd test -- --run tests/camera/camera-controller.test.ts`

Expected: all tests PASS, including a second test where capabilities and `applyConstraints` are absent.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src/camera/camera-controller.ts tests/camera/camera-controller.test.ts
git commit -m "feat: prefer the widest available front camera view"
```

---

### Task 5: Controller Integration, Haptics, and Game Detection

**Files:**
- Modify: `src/app/app-controller.ts`
- Modify: `src/motion/motion-detector.ts`
- Modify: `tests/app/app-controller.test.ts`
- Modify: `tests/motion/motion-detector.test.ts`
- Modify: `e2e/happy-path.spec.ts`

**Interfaces:**
- Consumes: `CalibrationSession.update(sample)`, `renderCalibration(root, snapshot)`, and the completed `CalibrationProfile`.
- Produces: game start only after `snapshot.phase === 'complete'`.

- [ ] **Step 1: Write failing integration tests**

Add a pure helper exported by `app-controller.ts` and test it:

```ts
export function shouldVibrate(previous: CalibrationSnapshot, next: CalibrationSnapshot): boolean {
  return previous.phase !== 'step-success' && next.phase === 'step-success'
}
```

Tests must verify `true` only on the transition into `step-success` and `false` for repeated success snapshots. Extend motion tests so a seated profile with `hipY: null` detects lean from shoulder center and never reads hidden hips; standing squat still requires a numeric `hipY`.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts tests/motion/motion-detector.test.ts`

Expected: FAIL because `shouldVibrate` and null-safe half-body detection do not exist.

- [ ] **Step 3: Replace the timer-driven calibration loop**

In `AppController.beginCalibration()`, create `this.calibrationSession = new CalibrationSession(this.choice.playStyle)`, add `document.body.classList.add('calibrating')`, and render the initial framing snapshot. In `onPose()`, call `session.update(sample)` exactly once, render the returned snapshot, vibrate with `navigator.vibrate?.(35)` only when `shouldVibrate(previous, next)` is true, and create `MotionDetector` plus the countdown only when phase becomes `complete`. Remove `CALIBRATION_SAMPLES_PER_STEP`, `CALIBRATION_TOTAL_SAMPLES`, `getCalibrationPrompt`, and `validateCalibrationActions` from the controller.

Remove the `calibrating` body class when calibration stops, errors, orientation interruption occurs, the game starts, or the controller finishes the game.

- [ ] **Step 4: Make runtime motion detection mode-specific**

For seated mode, compute `centerX` from shoulders `11` and `12` only and never require hip landmarks. For standing mode, preserve shoulder-plus-hip center and squat calculation. Guard every optional lower-body read with `profile.hipY !== null` and landmark visibility checks.

- [ ] **Step 5: Update fixture-mode end-to-end coverage**

Keep `poseFixture=seated-quick-success`, but make fixture mode drive deterministic baseline and five action samples through `CalibrationSession` before starting the game. Update `e2e/happy-path.spec.ts` to assert `校准完成` becomes visible before the result page, while preserving the no-external-upload assertion.

- [ ] **Step 6: Run integration and E2E tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run
npm.cmd run test:e2e
```

Expected: all Vitest files and the Playwright happy path PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add src/app/app-controller.ts src/motion/motion-detector.ts tests/app/app-controller.test.ts tests/motion/motion-detector.test.ts e2e/happy-path.spec.ts
git commit -m "feat: integrate confirmed calibration into the game flow"
```

---

### Task 6: Final Verification and Sites Publication

**Files:**
- Verify: `package.json`
- Verify: `.openai/hosting.json`
- Verify: generated `dist/`
- No product source changes unless verification exposes a real defect.

**Interfaces:**
- Consumes: the complete implementation from Tasks 1–5.
- Produces: a validated public Sites deployment and a cache-busted phone test URL.

- [ ] **Step 1: Run the complete verification suite**

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
git diff --check
git status --short
```

Expected: 0 failed tests, typecheck exit code 0, build exit code 0, E2E exit code 0, no whitespace errors, and no uncommitted product changes.

- [ ] **Step 2: Verify the built calibration bundle**

Find the generated `dist/client/assets/index-*.js` or `game-client-*.js` and confirm it contains the strings `第 1/5 步`, `校准成功`, `lower-body-not-visible`, and the 400 ms hold constant. Confirm `dist/.openai/hosting.json` and `dist/server/index.js` exist.

- [ ] **Step 3: Publish with the Sites hosting workflow**

Use the existing project ID from `.openai/hosting.json`. Obtain a fresh source credential, push the exact verified HEAD to the configured Sites branch, save one version from that commit, deploy the public version, and poll until status is `succeeded` or `failed`. Do not create a new site.

- [ ] **Step 4: Verify the public deployment**

Request the deployed root, `pose_landmarker.task`, `vision_wasm_internal.wasm`, and the current JavaScript bundle with a cache-busting query. Expect HTTP 200 for all resources and verify the bundle contains `校准成功` and the new state-machine code.

- [ ] **Step 5: Provide the phone handoff**

Return the existing public URL with the new version query. Tell the user that half-body mode now works close to the phone, full-body mode requires knees visible, every action shows a green confirmation, and the approved A-style framing guide is visible during calibration.
