# Visual Soft Motion Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking phone calibration flow with visible skeleton feedback, action-specific landmark checks, forgiving multi-frame progress, and a safe per-action fallback that always lets the player reach the game.

**Architecture:** Pose samples carry per-landmark data without a misleading whole-body average. A focused pose-quality module and calibration evaluator produce structured evidence and feedback; a state machine accumulates that evidence over time. The UI renders a mirrored SVG skeleton and recovery controls, while the controller owns camera/model readiness and persistence.

**Tech Stack:** TypeScript 6, Vite 8, MediaPipe Tasks Vision 0.10, Vitest 4 with happy-dom, Playwright 1.61, CSS/SVG.

## Global Constraints

- Half-body calibration must not require hips, knees, ankles, or feet.
- Full-body baseline requires nose, shoulders, and hips; knees are required only for squat.
- Landmark visibility starts at `0.5`; tune only after real-device evidence.
- Baseline uses the median of a `0.8–1.2 second` sample window.
- Action evidence reaches success after `500 ms`; a bad frame decays evidence at `35%` of elapsed time and never resets it immediately.
- A step exposes recovery after `8,000 ms`.
- Recommended sensitivity skips only the current action and preserves completed actions.
- Camera and skeleton use the same mirrored coordinate system.
- Calibration profiles for `seated` and `standing` are stored separately.
- No pose image, video frame, or landmark history leaves the browser.

---

## File Structure

- Create `src/pose/pose-quality.ts`: reusable landmark visibility, confidence, and tracking checks.
- Modify `src/pose/types.ts`: remove whole-pose `confidence` from `PoseSample`.
- Modify `src/pose/direct-pose-client.ts` and `src/pose/pose-worker.ts`: emit only captured time and per-landmark results.
- Modify `src/motion/calibration.ts`: median baseline, action-specific requirements, structured feedback.
- Modify `src/motion/calibration-session.ts`: readiness phases, forgiving evidence accumulator, timeouts, retry, and recommended defaults.
- Create `src/ui/pose-overlay.ts`: mirrored SVG skeleton rendering.
- Modify `src/ui/calibration-view.ts` and `src/style.css`: self-check stages, feedback, progress, completed list, and recovery buttons.
- Modify `src/app/app-controller.ts`: camera/model readiness, UI callbacks, tracking checks, profile persistence.
- Create `src/storage/calibration-profiles.ts`: mode-specific profile persistence.
- Modify focused tests under `tests/pose`, `tests/motion`, `tests/ui`, `tests/app`, and `tests/storage`.
- Modify `e2e/happy-path.spec.ts`: verify visible calibration and fallback paths reach gameplay.

---

### Task 1: Per-landmark pose quality

**Files:**
- Create: `src/pose/pose-quality.ts`
- Modify: `src/pose/types.ts`
- Modify: `src/pose/direct-pose-client.ts`
- Modify: `src/pose/pose-worker.ts`
- Modify: `tests/support/pose-sample.ts`
- Test: `tests/pose/pose-quality.test.ts`
- Test: `tests/pose/direct-pose-client.test.ts`
- Test: `tests/pose/pose-client.test.ts`
- Test: `tests/motion/motion-detector.test.ts`

**Interfaces:**
- Produces: `MIN_LANDMARK_VISIBILITY`, `landmarkIsUsable(sample, index, threshold?)`, `assessLandmarks(sample, indices, threshold?)`, and `hasTrackingPose(sample, style)`.
- Produces: `PoseSample = { capturedAt: number; landmarks: PoseLandmark[] }`.
- Consumed by: calibration evaluation, gameplay motion detection, skeleton rendering, and controller pose-loss handling.

- [ ] **Step 1: Write failing pose-quality and direct-client tests**

```ts
it('accepts upper-body tracking when every lower-body point is hidden', () => {
  const sample = poseSample(0, { hidden: Array.from({ length: 16 }, (_, i) => i + 17) })
  expect(hasTrackingPose(sample, 'seated')).toBe(true)
  expect(hasTrackingPose(sample, 'standing')).toBe(false)
})

it('reports only the missing required landmarks', () => {
  const result = assessLandmarks(poseSample(0, { hidden: [15, 23] }), [11, 12, 15, 16])
  expect(result).toEqual({ ok: false, missing: [15], confidence: 0 })
})

expect(onSample).toHaveBeenCalledWith({
  capturedAt: 120,
  landmarks: [{ x: 0.4, y: 0.3, z: -0.1, visibility: 0.9 }],
})
```

- [ ] **Step 2: Run the focused tests and verify the old global-confidence API fails**

Run: `npm.cmd test -- tests/pose/pose-quality.test.ts tests/pose/direct-pose-client.test.ts`

Expected: FAIL because `pose-quality.ts` is absent and the direct client still emits `confidence`.

- [ ] **Step 3: Implement the quality helpers and remove whole-pose confidence**

```ts
import type { PlayStyle } from '../app/types'
import type { PoseSample } from './types'

export const MIN_LANDMARK_VISIBILITY = 0.5

export function landmarkIsUsable(sample: PoseSample, index: number, threshold = MIN_LANDMARK_VISIBILITY): boolean {
  const point = sample.landmarks[index]
  return Boolean(point)
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.visibility)
    && point.visibility >= threshold
}

export function assessLandmarks(sample: PoseSample, indices: readonly number[], threshold = MIN_LANDMARK_VISIBILITY) {
  const missing = indices.filter(index => !landmarkIsUsable(sample, index, threshold))
  const confidence = missing.length > 0
    ? 0
    : Math.min(...indices.map(index => sample.landmarks[index].visibility))
  return { ok: missing.length === 0, missing, confidence }
}

export function hasTrackingPose(sample: PoseSample, style: PlayStyle): boolean {
  const required = style === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12]
  return assessLandmarks(sample, required).ok
}
```

Update both MediaPipe clients to emit `{ capturedAt, landmarks }`. Update fixtures and lost-pose samples to use `{ capturedAt, landmarks: [] }`. In `MotionDetector`, remove the initial global confidence check and compute each emitted event confidence from the minimum visibility of that motion's required landmarks.

- [ ] **Step 4: Run all pose and motion tests**

Run: `npm.cmd test -- tests/pose tests/motion/motion-detector.test.ts`

Expected: all selected tests PASS; no test fixture contains `PoseSample.confidence`.

- [ ] **Step 5: Commit**

```powershell
git add src/pose src/motion/motion-detector.ts tests/pose tests/motion/motion-detector.test.ts tests/support/pose-sample.ts
git commit -m "refactor: evaluate pose quality per landmark"
```

---

### Task 2: Structured calibration evaluation and robust baseline

**Files:**
- Modify: `src/motion/calibration.ts`
- Test: `tests/motion/calibration.test.ts`

**Interfaces:**
- Consumes: `assessLandmarks()` from Task 1.
- Produces: `CalibrationFeedbackCode`, `CalibrationAssessment`, `requiredLandmarksFor(style, action)`, `assessCalibrationAction(profile, sample, style, action)`, and median-based `buildCalibration(samples, style)`.
- Consumed by: `CalibrationSession` and the skeleton/UI layers.

- [ ] **Step 1: Write failing tests for relevant landmarks, median baseline, and feedback**

```ts
it('ignores hidden legs and hands in the seated baseline', () => {
  const samples = [0, 80, 160, 240, 320].map(time => poseSample(time, {
    hidden: [15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
  }))
  expect(buildCalibration(samples, 'seated').ok).toBe(true)
})

it('uses a median baseline instead of an outlier-sensitive average', () => {
  const samples = [0.49, 0.5, 0.51, 0.5, 0.9].map((center, index) => poseSample(index * 80, {
    changes: { 11: { x: center - 0.1 }, 12: { x: center + 0.1 } },
  }))
  const result = buildCalibration(samples, 'seated')
  if (!result.ok) throw new Error('calibration failed')
  expect(result.profile.torsoCenterX).toBeCloseTo(0.5)
})

it('asks for only the missing hand during hands-up', () => {
  const result = assessCalibrationAction(profile, poseSample(0, { hidden: [15] }), 'seated', 'hands-up')
  expect(result).toMatchObject({ ok: false, feedback: 'left-hand-missing', requiredIndices: [11, 12, 15, 16] })
})
```

- [ ] **Step 2: Run calibration tests and verify failure**

Run: `npm.cmd test -- tests/motion/calibration.test.ts`

Expected: FAIL because the structured assessment API and median baseline do not exist.

- [ ] **Step 3: Implement action-specific requirements and assessment**

```ts
export type CalibrationFeedbackCode =
  | 'body-not-found' | 'head-missing' | 'shoulders-missing'
  | 'left-hand-missing' | 'right-hand-missing' | 'hips-missing' | 'knees-missing'
  | 'move-left' | 'move-right' | 'lower-head'
  | 'raise-left-hand' | 'raise-right-hand' | 'spread-hands' | 'lower-hips' | 'hold'

export interface CalibrationAssessment {
  ok: boolean
  feedback: CalibrationFeedbackCode
  requiredIndices: readonly number[]
  confidence: number
}

export function requiredLandmarksFor(style: PlayStyle, action: CalibrationAction | null): readonly number[] {
  if (action === 'duck') return [0, 11, 12]
  if (action === 'hands-up' || action === 'reach') return [11, 12, 15, 16]
  if (action === 'squat') return [23, 24, 25, 26]
  if (action === 'lean-left' || action === 'lean-right') return style === 'standing' ? [11, 12, 23, 24] : [11, 12]
  return style === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12]
}
```

Use a local `median(values)` helper for every profile field. When seated wrists are absent, set `wristY` to median shoulder Y plus shoulder width. Keep `hipY` and `kneeY` nullable; do not require knees while building a standing baseline. Replace boolean action matching internally with `CalibrationAssessment`, retaining a small `matchesCalibrationAction()` wrapper for existing callers until Task 3 is complete.

- [ ] **Step 4: Run calibration and motion tests**

Run: `npm.cmd test -- tests/motion/calibration.test.ts tests/motion/motion-detector.test.ts`

Expected: all selected tests PASS, including seated samples with invisible legs and hands.

- [ ] **Step 5: Commit**

```powershell
git add src/motion/calibration.ts tests/motion/calibration.test.ts
git commit -m "feat: add action-specific calibration feedback"
```

---

### Task 3: Forgiving calibration state machine and fallback

**Files:**
- Modify: `src/motion/calibration-session.ts`
- Test: `tests/motion/calibration-session.test.ts`

**Interfaces:**
- Consumes: `buildCalibration()`, `assessCalibrationAction()`, and `requiredLandmarksFor()` from Task 2.
- Produces: readiness methods `cameraReady()`, `modelReady()`, `modelFailed()`, `restartBodyCheck()`, `retryCurrentAction()`, and `useRecommendedSensitivity()`.
- Produces: expanded `CalibrationSnapshot` with `phase`, `feedback`, `requiredIndices`, `latestLandmarks`, `holdProgress`, `canRecover`, and `completedActions`.

- [ ] **Step 1: Replace continuous-hold tests with evidence accumulation and recovery tests**

```ts
it('keeps most progress across one bad frame', () => {
  const session = readyHalfBodySession()
  session.update(leftLean(1000))
  session.update(leftLean(1160))
  session.update(poseSample(1240))
  expect(session.snapshot().holdProgress).toBeGreaterThan(0.2)
})

it('passes after 500 ms of accumulated matching evidence', () => {
  const session = readyHalfBodySession()
  for (let time = 1000; time <= 1560; time += 80) session.update(leftLean(time))
  expect(session.snapshot()).toMatchObject({ phase: 'step-success', completedSteps: 1 })
})

it('offers recovery after eight seconds and skips only the current action', () => {
  const session = readyHalfBodySession()
  session.update(poseSample(9000))
  expect(session.snapshot().canRecover).toBe(true)
  session.useRecommendedSensitivity()
  expect(session.snapshot()).toMatchObject({ phase: 'step-success', completedSteps: 1 })
})
```

- [ ] **Step 2: Run session tests and verify old reset behavior fails**

Run: `npm.cmd test -- tests/motion/calibration-session.test.ts`

Expected: FAIL because bad frames currently reset progress and recovery methods are absent.

- [ ] **Step 3: Implement readiness phases and the evidence accumulator**

```ts
const REQUIRED_EVIDENCE_MS = 500
const MAX_SAMPLE_DELTA_MS = 120
const MISS_DECAY_RATE = 0.35
const ACTION_RECOVERY_MS = 8_000
const SUCCESS_DISPLAY_MS = 450

export type CalibrationPhase =
  | 'camera-check' | 'model-check' | 'model-error' | 'body-check'
  | 'baseline' | 'action' | 'step-success' | 'complete'

private updateEvidence(matches: boolean, deltaMs: number): void {
  const bounded = Math.max(0, Math.min(MAX_SAMPLE_DELTA_MS, deltaMs))
  this.evidenceMs = matches
    ? Math.min(REQUIRED_EVIDENCE_MS, this.evidenceMs + bounded)
    : Math.max(0, this.evidenceMs - bounded * MISS_DECAY_RATE)
}

retryCurrentAction(): CalibrationSnapshot {
  this.evidenceMs = 0
  this.actionStartedAt = this.lastCapturedAt
  return this.snapshot()
}

useRecommendedSensitivity(): CalibrationSnapshot {
  if (this.phase !== 'action' || !this.profile) return this.snapshot()
  this.completedSteps = this.stepIndex + 1
  this.phase = 'step-success'
  this.successAt = this.lastCapturedAt
  this.evidenceMs = 0
  return this.snapshot()
}
```

Start baseline after a valid body-check sample. Collect at least eight valid samples spanning at least 800 ms, without the old strict neutral geometry. Preserve the 450 ms success display and completed steps across pose loss. Set `canRecover` when the current action has lasted 8,000 ms.

- [ ] **Step 4: Run motion tests**

Run: `npm.cmd test -- tests/motion/calibration-session.test.ts tests/motion/calibration.test.ts`

Expected: all selected tests PASS; bad frames decay rather than clear progress.

- [ ] **Step 5: Commit**

```powershell
git add src/motion/calibration-session.ts tests/motion/calibration-session.test.ts
git commit -m "feat: make action calibration forgiving"
```

---

### Task 4: Mirrored skeleton overlay

**Files:**
- Create: `src/ui/pose-overlay.ts`
- Test: `tests/ui/pose-overlay.test.ts`

**Interfaces:**
- Consumes: `PoseLandmark[]`, required landmark indices, and `MIN_LANDMARK_VISIBILITY`.
- Produces: `renderPoseOverlay(landmarks, requiredIndices): SVGSVGElement` and `projectPosePoint(point): { x: number; y: number }`.
- Consumed by: `renderCalibration()` in Task 5.

- [ ] **Step 1: Write failing overlay tests**

```ts
it('mirrors MediaPipe x coordinates to match the front camera', () => {
  expect(projectPosePoint({ x: 0.2, y: 0.3, z: 0, visibility: 1 })).toEqual({ x: 80, y: 30 })
})

it('colors required stable points green and missing required points yellow', () => {
  const sample = poseSample(0, { hidden: [15] })
  const svg = renderPoseOverlay(sample.landmarks, [11, 12, 15, 16])
  expect(svg.querySelector('[data-landmark="11"]')?.classList.contains('stable')).toBe(true)
  expect(svg.querySelector('[data-landmark="15"]')?.classList.contains('missing')).toBe(true)
})
```

- [ ] **Step 2: Run overlay tests and verify the module is missing**

Run: `npm.cmd test -- tests/ui/pose-overlay.test.ts`

Expected: FAIL because `pose-overlay.ts` does not exist.

- [ ] **Step 3: Implement a focused SVG overlay**

```ts
const SVG_NS = 'http://www.w3.org/2000/svg'
const CONNECTIONS = [[11, 12], [11, 15], [12, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26]] as const

export function projectPosePoint(point: PoseLandmark): { x: number; y: number } {
  return { x: (1 - point.x) * 100, y: point.y * 100 }
}

export function renderPoseOverlay(landmarks: PoseLandmark[], requiredIndices: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('pose-overlay')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  const required = new Set(requiredIndices)
  for (const [fromIndex, toIndex] of CONNECTIONS) {
    const from = landmarks[fromIndex]
    const to = landmarks[toIndex]
    if (!from || !to) continue
    const start = projectPosePoint(from)
    const end = projectPosePoint(to)
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(start.x))
    line.setAttribute('y1', String(start.y))
    line.setAttribute('x2', String(end.x))
    line.setAttribute('y2', String(end.y))
    const requiredLine = required.has(fromIndex) || required.has(toIndex)
    const stableLine = from.visibility >= MIN_LANDMARK_VISIBILITY && to.visibility >= MIN_LANDMARK_VISIBILITY
    line.classList.add(requiredLine ? (stableLine ? 'stable' : 'missing') : 'optional')
    svg.append(line)
  }
  const supported = new Set([0, ...CONNECTIONS.flat()])
  for (const index of supported) {
    const point = landmarks[index]
    if (!point) continue
    const projected = projectPosePoint(point)
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.dataset.landmark = String(index)
    circle.setAttribute('cx', String(projected.x))
    circle.setAttribute('cy', String(projected.y))
    circle.setAttribute('r', '1.4')
    circle.classList.add(required.has(index)
      ? (point.visibility >= MIN_LANDMARK_VISIBILITY ? 'stable' : 'missing')
      : 'optional')
    svg.append(circle)
  }
  return svg
}
```

Missing required landmarks remain visible at their last supplied coordinates in yellow; absent array entries are omitted and the textual feedback carries the missing-part message.

- [ ] **Step 4: Run overlay tests**

Run: `npm.cmd test -- tests/ui/pose-overlay.test.ts`

Expected: all selected tests PASS with mirrored coordinates and status classes.

- [ ] **Step 5: Commit**

```powershell
git add src/ui/pose-overlay.ts tests/ui/pose-overlay.test.ts
git commit -m "feat: render calibration pose overlay"
```

---

### Task 5: Self-check and recovery calibration UI

**Files:**
- Modify: `src/ui/calibration-view.ts`
- Modify: `src/style.css`
- Test: `tests/ui/calibration-view.test.ts`

**Interfaces:**
- Consumes: expanded `CalibrationSnapshot` and `renderPoseOverlay()`.
- Produces: `CalibrationViewActions` and `renderCalibration(root, snapshot, actions)`.
- Consumed by: `AppController` in Task 6.

- [ ] **Step 1: Write failing UI tests for stages, skeleton, completed list, and recovery buttons**

```ts
const actions = {
  onRetryModel: vi.fn(), onRetryBody: vi.fn(),
  onRetryAction: vi.fn(), onUseRecommended: vi.fn(),
}

it('shows model and body self-check stages before action calibration', () => {
  renderCalibration(root, snapshot({ phase: 'model-check' }), actions)
  expect(root.textContent).toContain('识别组件加载中')
  renderCalibration(root, snapshot({ phase: 'body-check' }), actions)
  expect(root.textContent).toContain('人体识别 2/3')
})

it('offers retry and recommended sensitivity after timeout', () => {
  renderCalibration(root, snapshot({ canRecover: true }), actions)
  root.querySelector<HTMLButtonElement>('[data-action="use-recommended"]')!.click()
  expect(actions.onUseRecommended).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run calibration-view tests and verify failure**

Run: `npm.cmd test -- tests/ui/calibration-view.test.ts`

Expected: FAIL because the view has no readiness stages, callbacks, skeleton, or recovery controls.

- [ ] **Step 3: Implement the feedback map and interactive view**

```ts
export interface CalibrationViewActions {
  onRetryModel(): void
  onRetryBody(): void
  onRetryAction(): void
  onUseRecommended(): void
}

const feedbackCopy: Record<CalibrationFeedbackCode, string> = {
  'body-not-found': '请站到高亮框内',
  'head-missing': '请调整手机，让头部进入画面',
  'shoulders-missing': '请把双肩放入高亮框',
  'left-hand-missing': '请让左手进入画面',
  'right-hand-missing': '请让右手进入画面',
  'hips-missing': '请调整手机，让髋部进入画面',
  'knees-missing': '请稍微后退，让膝盖进入画面',
  'move-left': '身体已识别，请再向左一点',
  'move-right': '身体已识别，请再向右一点',
  'lower-head': '头部已识别，请再低一点',
  'raise-left-hand': '右手已识别，请抬高左手',
  'raise-right-hand': '左手已识别，请抬高右手',
  'spread-hands': '双手已识别，请再向两侧伸展',
  'lower-hips': '身体已识别，请缓慢下蹲',
  hold: '动作正确，保持一下',
}
```

Render `pose-overlay` before the frame, stage text above the status card, completed action chips inside it, and two recovery buttons only when `canRecover` is true. Add `body.calibrating #camera-preview { transform: scaleX(-1); }` and high-contrast `.pose-overlay .stable/.missing/.optional` styles. Keep reduced-motion support.

- [ ] **Step 4: Run UI and smoke tests**

Run: `npm.cmd test -- tests/ui/calibration-view.test.ts tests/ui/pose-overlay.test.ts tests/smoke.test.ts`

Expected: all selected tests PASS and existing welcome/setup rendering remains intact.

- [ ] **Step 5: Commit**

```powershell
git add src/ui/calibration-view.ts src/style.css tests/ui/calibration-view.test.ts
git commit -m "feat: show calibration status and recovery controls"
```

---

### Task 6: Controller readiness and retry integration

**Files:**
- Modify: `src/app/app-controller.ts`
- Test: `tests/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `CalibrationSession` readiness/recovery methods, `CalibrationViewActions`, and `hasTrackingPose()`.
- Produces: controller flow that keeps the camera alive during model retry and re-renders every explicit session transition.
- Consumed by: the live mobile page and E2E fixture.

- [ ] **Step 1: Write failing controller tests for readiness and model retry**

```ts
it('shows camera, model, then body readiness without entering action early', async () => {
  const pendingPose = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
  dependencies.createPoseClient.mockReturnValueOnce(pendingPose.promise)
  const { root } = startCalibration()
  await vi.waitFor(() => expect(root.textContent).toContain('识别组件加载中'))
  pendingPose.resolve({ detect: vi.fn(), dispose: vi.fn() })
  await vi.waitFor(() => expect(root.textContent).toContain('请站到高亮框内'))
})

it('retries model loading without reopening the camera', async () => {
  dependencies.createPoseClient.mockRejectedValueOnce(new Error('load failed'))
    .mockResolvedValueOnce({ detect: vi.fn(), dispose: vi.fn() })
  const { root } = startCalibration()
  await vi.waitFor(() => expect(root.textContent).toContain('识别组件加载失败'))
  root.querySelector<HTMLButtonElement>('[data-action="retry-model"]')!.click()
  await vi.waitFor(() => expect(dependencies.createPoseClient).toHaveBeenCalledTimes(2))
  expect(dependencies.camera.start).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run controller tests and verify failure**

Run: `npm.cmd test -- tests/app/app-controller.test.ts`

Expected: FAIL because the controller currently replaces recoverable model errors with a terminal message screen.

- [ ] **Step 3: Refactor pose initialization and render callbacks**

```ts
private calibrationViewActions(session: CalibrationSession): CalibrationViewActions {
  return {
    onRetryModel: () => { void this.initializePoseForCalibration(session) },
    onRetryBody: () => {
      session.restartBodyCheck()
      this.renderCalibrationSession(session)
    },
    onRetryAction: () => {
      session.retryCurrentAction()
      this.renderCalibrationSession(session)
    },
    onUseRecommended: () => {
      session.useRecommendedSensitivity()
      this.renderCalibrationSession(session)
    },
  }
}

private renderCalibrationSession(session: CalibrationSession): void {
  if (!this.isCurrentCalibration(session)) return
  renderCalibration(this.root, session.snapshot(), this.calibrationViewActions(session))
}
```

After the preview plays, call `session.cameraReady()`. Before loading MediaPipe, render `model-check`; on success call `session.modelReady()` and start the capture loop. On failure call `session.modelFailed()` and leave the camera stream attached. Replace gameplay `sample.confidence < 0.6` with `!hasTrackingPose(sample, this.choice.playStyle)`.

Update fixture mode to call `cameraReady()` and `modelReady()` before feeding samples. Keep all existing stale-attempt cleanup guarantees.

- [ ] **Step 4: Run controller, calibration, and lifecycle tests**

Run: `npm.cmd test -- tests/app/app-controller.test.ts tests/motion/calibration-session.test.ts tests/platform/lifecycle.test.ts`

Expected: all selected tests PASS, including late camera/pose promise settlement tests.

- [ ] **Step 5: Commit**

```powershell
git add src/app/app-controller.ts tests/app/app-controller.test.ts
git commit -m "feat: integrate recoverable calibration startup"
```

---

### Task 7: Store mode-specific calibration profiles

**Files:**
- Create: `src/storage/calibration-profiles.ts`
- Modify: `src/app/app-controller.ts`
- Test: `tests/storage/calibration-profiles.test.ts`
- Test: `tests/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `CalibrationProfile` and `PlayStyle`.
- Produces: `loadCalibrationProfiles(storage)` and `saveCalibrationProfile(storage, style, profile)`.
- Consumed by: controller completion flow; saved profiles remain available for later settings/recalibration work.

- [ ] **Step 1: Write failing persistence tests**

```ts
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
```

- [ ] **Step 2: Run storage tests and verify the module is missing**

Run: `npm.cmd test -- tests/storage/calibration-profiles.test.ts`

Expected: FAIL because `calibration-profiles.ts` does not exist.

- [ ] **Step 3: Implement validated local persistence and controller save**

```ts
const STORAGE_KEY = 'motion-ski.calibration.v1'
export type CalibrationProfiles = Partial<Record<PlayStyle, CalibrationProfile>>

export function saveCalibrationProfile(storage: RecordStorage, style: PlayStyle, profile: CalibrationProfile): void {
  const profiles = loadCalibrationProfiles(storage)
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ ...profiles, [style]: profile })) } catch { /* Calibration remains usable in memory. */ }
}
```

Validate every numeric field as finite, require `shoulderWidth > 0`, and permit only `null` or finite numbers for `hipY` and `kneeY`. In `AppController.onPose`, save the profile once when the session first enters `complete`, immediately before constructing `MotionDetector`.

- [ ] **Step 4: Run storage and controller tests**

Run: `npm.cmd test -- tests/storage tests/app/app-controller.test.ts`

Expected: all selected tests PASS; completing seated calibration writes only the seated key.

- [ ] **Step 5: Commit**

```powershell
git add src/storage/calibration-profiles.ts src/app/app-controller.ts tests/storage/calibration-profiles.test.ts tests/app/app-controller.test.ts
git commit -m "feat: save calibration profiles by mode"
```

---

### Task 8: Mobile path fixtures, full verification, and Pages artifact

**Files:**
- Modify: `src/app/app-controller.ts`
- Modify: `src/main.ts`
- Modify: `e2e/happy-path.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the completed calibration flow from Tasks 1–7.
- Produces: deterministic development-only fixtures for successful soft calibration and recommended-sensitivity recovery.

- [ ] **Step 1: Add failing E2E coverage for visible calibration and recovery**

```ts
test('shows a moving skeleton and completes soft seated calibration', async ({ page }) => {
  await page.goto('/?poseFixture=seated-soft-success')
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByRole('button', { name: '开始校准' }).click()
  await expect(page.locator('.pose-overlay [data-landmark="11"]')).toBeVisible()
  await expect(page.getByText('校准完成')).toBeVisible()
})

test('recommended sensitivity escapes a stuck action', async ({ page }) => {
  await page.goto('/?poseFixture=seated-stuck-action')
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByRole('button', { name: '开始校准' }).click()
  await page.getByRole('button', { name: '使用推荐灵敏度' }).click()
  await expect(page.getByText(/第 2\/5 步|校准成功/)).toBeVisible()
})
```

- [ ] **Step 2: Run E2E and verify the new fixture names fail**

Run: `npm.cmd run build:pages && npm.cmd run test:e2e`

Expected: the new tests FAIL because only `seated-quick-success` exists.

- [ ] **Step 3: Add deterministic fixture scenarios and update test documentation**

Use a development-only `poseFixture` union with `seated-soft-success` and `seated-stuck-action`. The success fixture includes hidden lower-body landmarks and intermittent empty samples so it proves irrelevant landmarks and short dropouts do not block progress. The stuck fixture advances captured timestamps past 8,000 ms on action one without a matching lean so the recovery controls appear immediately in E2E. Document both URLs in `README.md` under local testing.

- [ ] **Step 4: Run the complete verification gates**

Run: `npm.cmd test -- --run`

Expected: all Vitest files and tests PASS.

Run: `npm.cmd run typecheck`

Expected: TypeScript exits with code 0.

Run: `npm.cmd run build:pages`

Expected: Vite build and `verify-pages-build.mjs` exit with code 0; HTML, JS, CSS, MediaPipe WASM, and `pose_landmarker.task` are present under `dist`.

Run: `npm.cmd run test:e2e`

Expected: every Playwright test PASS, including soft calibration and recommended sensitivity.

- [ ] **Step 5: Commit**

```powershell
git add src/app/app-controller.ts src/main.ts e2e/happy-path.spec.ts README.md
git commit -m "test: verify mobile soft calibration paths"
```

---

## Final Review Checklist

- [ ] Compare implementation against every acceptance criterion in `docs/superpowers/specs/2026-07-13-visual-soft-motion-calibration-design.md`.
- [ ] Confirm no code path computes the average visibility of all 33 landmarks.
- [ ] Confirm seated baseline and seated game tracking work with all lower-body landmarks hidden.
- [ ] Confirm standing baseline does not require knees and squat does require knees.
- [ ] Confirm a single empty or mismatching sample cannot zero action progress.
- [ ] Confirm model failure and action timeout provide working recovery controls.
- [ ] Confirm SVG coordinates and the camera preview are both mirrored exactly once.
- [ ] Confirm no camera frame or landmark data is sent off-device.
- [ ] Confirm `git status --short` contains no unrelated changes before publishing.
