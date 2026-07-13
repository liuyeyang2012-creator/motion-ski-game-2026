# Pose Initialization Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent mobile calibration from remaining forever on “识别组件加载中” by adding a 15-second initialization limit and a user-triggered non-SIMD CPU compatibility retry that keeps the active camera stream.

**Architecture:** `direct-pose-client.ts` selects either the existing automatic MediaPipe fileset or an explicit non-SIMD CPU fileset. `app-controller.ts` owns bounded initialization, attempt identity, late-result disposal, and mode switching; `calibration-session.ts` exposes the active model mode to the view so `calibration-view.ts` can render precise recovery copy.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, MediaPipe Tasks Vision 0.10, Playwright 1.61, GitHub Pages

## Global Constraints

- Every standard or compatibility initialization attempt must settle in the UI within 15,000 ms.
- Compatibility mode must load `vision_wasm_nosimd_internal.js` and `vision_wasm_nosimd_internal.wasm` and set MediaPipe delegate to `CPU`.
- Retrying model initialization must reuse the current camera stream and must not call camera permission startup again.
- A client that resolves after timeout or after a newer attempt has started must be disposed and must never replace the current client or UI.
- Only one initialization attempt may be active from the current UI; repeated retry clicks must not create parallel current attempts.
- Do not change the accepted pose model, calibration actions, sensitivity rules, remote services, logging, or camera-data handling.
- Use test-driven development: add one behavior test, run it to observe the expected failure, then add the minimum production change and rerun it.

---

## File Structure

- `src/pose/direct-pose-client.ts`: owns standard versus compatibility MediaPipe runtime selection.
- `src/motion/calibration-session.ts`: owns the serializable `modelMode` state shown by the calibration UI.
- `src/app/app-controller.ts`: owns the 15-second deadline, attempt cancellation identity, late-client cleanup, and compatibility retry behavior.
- `src/ui/calibration-view.ts`: owns loading/failure instructions and retry-button labels for each runtime mode.
- `tests/pose/direct-pose-client.test.ts`: verifies exact fileset paths and CPU delegate.
- `tests/motion/calibration-session.test.ts`: verifies runtime mode state transitions.
- `tests/app/app-controller.test.ts`: reproduces the never-settling mobile initialization and verifies recovery lifecycle.
- `tests/ui/calibration-view.test.ts`: verifies all four user-visible model loading/error states.

### Task 1: Add Explicit Compatibility Runtime Selection

**Files:**
- Modify: `src/pose/direct-pose-client.ts`
- Test: `tests/pose/direct-pose-client.test.ts`

**Interfaces:**
- Consumes: deployed asset base URL and existing `PoseClientDependencies` test seam.
- Produces: `PoseRuntimeMode = 'standard' | 'compatibility'`, `PoseClientOptions`, and `createDirectPoseClient(..., dependencies?, options?)`.

- [ ] **Step 1: Write failing tests for standard and compatibility filesets**

Append tests that keep the existing standard assertion and add this compatibility behavior:

```ts
it('uses explicit non-SIMD WASM and CPU delegate in compatibility mode', async () => {
  const landmarker = { detectForVideo: vi.fn(), close: vi.fn() }
  const forVisionTasks = vi.fn()
  const createFromOptions = vi.fn().mockResolvedValue(landmarker)

  await createDirectPoseClient(
    'https://example.test/motion-ski-game-2026/',
    vi.fn(),
    vi.fn(),
    { forVisionTasks, createFromOptions },
    { mode: 'compatibility' },
  )

  expect(forVisionTasks).not.toHaveBeenCalled()
  expect(createFromOptions).toHaveBeenCalledWith(
    {
      wasmLoaderPath: 'https://example.test/motion-ski-game-2026/vision_wasm_nosimd_internal.js',
      wasmBinaryPath: 'https://example.test/motion-ski-game-2026/vision_wasm_nosimd_internal.wasm',
    },
    expect.objectContaining({
      baseOptions: {
        modelAssetPath: 'https://example.test/motion-ski-game-2026/pose_landmarker.task',
        delegate: 'CPU',
      },
    }),
  )
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- --run tests/pose/direct-pose-client.test.ts`

Expected: FAIL because `createDirectPoseClient` does not accept compatibility options and still calls `forVisionTasks`.

- [ ] **Step 3: Implement the runtime-mode interface and compatibility fileset**

Use a local fileset type and preserve the existing fourth dependency argument:

```ts
export type PoseRuntimeMode = 'standard' | 'compatibility'

export interface PoseClientOptions {
  mode?: PoseRuntimeMode
}

interface VisionFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

interface PoseClientDependencies {
  forVisionTasks(baseUrl: string): Promise<VisionFileset>
  createFromOptions(fileset: VisionFileset, options: {
    baseOptions: { modelAssetPath: string; delegate?: 'CPU' | 'GPU' }
    runningMode: 'VIDEO'
    numPoses: number
    outputSegmentationMasks: boolean
  }): Promise<PoseLandmarkerPort>
}
```

Select the fileset and base options inside `createDirectPoseClient`:

```ts
const mode = options.mode ?? 'standard'
const fileset = mode === 'compatibility'
  ? {
      wasmLoaderPath: new URL('vision_wasm_nosimd_internal.js', assetBaseUrl).href,
      wasmBinaryPath: new URL('vision_wasm_nosimd_internal.wasm', assetBaseUrl).href,
    }
  : await dependencies.forVisionTasks(assetBaseUrl)
const modelAssetPath = new URL('pose_landmarker.task', assetBaseUrl).href
const landmarker = await dependencies.createFromOptions(fileset, {
  baseOptions: mode === 'compatibility'
    ? { modelAssetPath, delegate: 'CPU' }
    : { modelAssetPath },
  runningMode: 'VIDEO',
  numPoses: 1,
  outputSegmentationMasks: false,
})
```

The final signature is:

```ts
export async function createDirectPoseClient(
  baseUrl: string,
  onSample: (sample: PoseSample) => void,
  onError: (error: Error) => void,
  dependencies: PoseClientDependencies = defaultDependencies,
  options: PoseClientOptions = {},
): Promise<DirectPoseClient>
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm.cmd test -- --run tests/pose/direct-pose-client.test.ts`

Expected: all direct pose client tests PASS; the standard test still proves automatic fileset resolution.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/pose/direct-pose-client.ts tests/pose/direct-pose-client.test.ts
git commit -m "feat: add compatible pose runtime"
```

### Task 2: Track Model Runtime Mode and Render Recovery Copy

**Files:**
- Modify: `src/motion/calibration-session.ts`
- Modify: `src/ui/calibration-view.ts`
- Test: `tests/motion/calibration-session.test.ts`
- Test: `tests/ui/calibration-view.test.ts`

**Interfaces:**
- Consumes: `CalibrationPhase` and existing view action callbacks.
- Produces: `CalibrationModelMode`, `CalibrationSnapshot.modelMode`, and `beginModelLoading(mode)`.

- [ ] **Step 1: Write failing session-state tests**

Add tests proving the initial mode and compatibility transition:

```ts
it('tracks the active model loading mode through failure', () => {
  const session = new CalibrationSession('seated')

  expect(session.cameraReady().modelMode).toBe('standard')
  expect(session.beginModelLoading('compatibility').modelMode).toBe('compatibility')
  expect(session.modelFailed()).toMatchObject({ phase: 'model-error', modelMode: 'compatibility' })
})
```

Update every explicit `CalibrationSnapshot` test fixture with `modelMode: 'standard'` so type checking remains exact.

- [ ] **Step 2: Run the session test and confirm RED**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts`

Expected: FAIL because `modelMode` and the `beginModelLoading(mode)` parameter do not exist.

- [ ] **Step 3: Implement the session mode state**

Add the type, snapshot field, private field, and mode-aware loader:

```ts
export type CalibrationModelMode = 'standard' | 'compatibility'

export interface CalibrationSnapshot {
  phase: CalibrationPhase
  modelMode: CalibrationModelMode
  // existing fields remain unchanged
}

private modelMode: CalibrationModelMode = 'standard'

beginModelLoading(mode: CalibrationModelMode = 'standard'): CalibrationSnapshot {
  if (this.phase !== 'complete') {
    this.modelMode = mode
    this.phase = 'model-check'
  }
  return this.snapshot()
}
```

Return `modelMode: this.modelMode` from `snapshot()`.

- [ ] **Step 4: Run the session test and confirm GREEN**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts`

Expected: all calibration session tests PASS.

- [ ] **Step 5: Write failing view tests for all four states**

Add one table-driven test:

```ts
it.each([
  ['model-check', 'standard', '识别组件加载中', '首次加载可能需要一些时间'],
  ['model-error', 'standard', '普通模式未能启动', '兼容模式重试'],
  ['model-check', 'compatibility', '兼容模式加载中', '请保持竖屏'],
  ['model-error', 'compatibility', '兼容模式未能启动', '再次尝试兼容模式'],
] as const)('renders %s copy for %s mode', (phase, modelMode, title, detail) => {
  const root = document.createElement('section')
  renderCalibration(root, snapshot({ phase, modelMode, action: null }), actions)
  expect(root.textContent).toContain(title)
  expect(root.textContent).toContain(detail)
})
```

- [ ] **Step 6: Run the view test and confirm RED**

Run: `npm.cmd test -- --run tests/ui/calibration-view.test.ts`

Expected: FAIL because all modes still use generic loading/failure copy and the generic “重新加载” button.

- [ ] **Step 7: Implement mode-specific view copy**

Use mode-aware instructions:

```ts
if (snapshot.phase === 'model-check') {
  return snapshot.modelMode === 'compatibility' ? '兼容模式加载中' : '识别组件加载中'
}
if (snapshot.phase === 'model-error') {
  return snapshot.modelMode === 'compatibility' ? '兼容模式未能启动' : '普通模式未能启动'
}
```

Use mode-aware retry labels:

```ts
const retryLabel = snapshot.modelMode === 'compatibility'
  ? '再次尝试兼容模式'
  : '兼容模式重试'
status.append(actionButton(retryLabel, 'retry-model', actions.onRetryModel))
```

Use a standard-mode first-load note while retaining existing portrait/light guidance elsewhere:

```ts
const help = snapshot.phase === 'model-check' && snapshot.modelMode === 'standard'
  ? '首次加载可能需要一些时间，请保持竖屏。'
  : snapshot.phase === 'action'
    ? '动作正确时进度会增加，短暂识别不稳不会清零。'
    : '请保持竖屏，并让身体处在光线充足的位置。'
```

- [ ] **Step 8: Run focused session and view tests and confirm GREEN**

Run: `npm.cmd test -- --run tests/motion/calibration-session.test.ts tests/ui/calibration-view.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
git add src/motion/calibration-session.ts src/ui/calibration-view.ts tests/motion/calibration-session.test.ts tests/ui/calibration-view.test.ts tests/app/app-controller.test.ts
git commit -m "feat: show pose recovery states"
```

### Task 3: Bound Initialization and Dispose Late Clients

**Files:**
- Modify: `src/app/app-controller.ts`
- Test: `tests/app/app-controller.test.ts`

**Interfaces:**
- Consumes: `CalibrationModelMode`, `PoseRuntimeMode`, and `createDirectPoseClient(..., dependencies?, options?)`.
- Produces: exported `POSE_INITIALIZATION_TIMEOUT_MS`, `PoseInitializationTimeoutError`, and `initializePoseClientWithTimeout(task, timeoutMs?)` for deterministic lifecycle tests.

- [ ] **Step 1: Write failing timeout and late-disposal tests**

Import the new helper and add:

```ts
it('times out a pose initialization that never settles', async () => {
  vi.useFakeTimers()
  const pending = deferred<{ dispose(): void }>()
  const result = initializePoseClientWithTimeout(pending.promise)

  await vi.advanceTimersByTimeAsync(15_000)

  await expect(result).rejects.toBeInstanceOf(PoseInitializationTimeoutError)
  vi.useRealTimers()
})

it('disposes a pose client that resolves after its timeout', async () => {
  vi.useFakeTimers()
  const pending = deferred<{ dispose(): void }>()
  const client = { dispose: vi.fn() }
  const result = initializePoseClientWithTimeout(pending.promise)

  await vi.advanceTimersByTimeAsync(15_000)
  await expect(result).rejects.toBeInstanceOf(PoseInitializationTimeoutError)
  pending.resolve(client)
  await Promise.resolve()

  expect(client.dispose).toHaveBeenCalledOnce()
  vi.useRealTimers()
})
```

Wrap timer restoration in `try/finally` in the final test implementation so a failed assertion cannot contaminate later tests.

- [ ] **Step 2: Run the controller test and confirm RED**

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts`

Expected: FAIL because the timeout constant, error, and helper are not defined.

- [ ] **Step 3: Implement the bounded initialization helper**

Add:

```ts
export const POSE_INITIALIZATION_TIMEOUT_MS = 15_000

export class PoseInitializationTimeoutError extends Error {
  constructor() {
    super('Pose initialization timed out')
    this.name = 'PoseInitializationTimeoutError'
  }
}

export function initializePoseClientWithTimeout<T extends { dispose(): void }>(
  task: Promise<T>,
  timeoutMs = POSE_INITIALIZATION_TIMEOUT_MS,
): Promise<T> {
  let timedOut = false
  let timer = 0
  task.then(client => {
    if (timedOut) client.dispose()
  }).catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      timedOut = true
      reject(new PoseInitializationTimeoutError())
    }, timeoutMs)
  })
  return Promise.race([task, timeout]).finally(() => window.clearTimeout(timer))
}
```

- [ ] **Step 4: Run timeout tests and confirm GREEN**

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts -t "times out|resolves after its timeout"`

Expected: both timeout lifecycle tests PASS.

- [ ] **Step 5: Write failing integration tests for recovery without camera restart**

Update the existing retry test to assert both mode calls and one camera startup:

```ts
expect(dependencies.createPoseClient.mock.calls[0]?.[4]).toEqual({ mode: 'standard' })
expect(dependencies.createPoseClient.mock.calls[1]?.[4]).toEqual({ mode: 'compatibility' })
expect(dependencies.camera.start).toHaveBeenCalledOnce()
```

Add a never-settling controller test using fake timers:

```ts
it('leaves model loading after fifteen seconds when initialization never settles', async () => {
  vi.useFakeTimers()
  try {
    dependencies.createPoseClient.mockReturnValueOnce(deferred<never>().promise)
    const { root } = startCalibration()
    await vi.advanceTimersByTimeAsync(0)
    expect(dependencies.createPoseClient).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(15_000)

    expect(root.textContent).toContain('普通模式未能启动')
    expect(root.querySelector('[data-action="retry-model"]')?.textContent).toBe('兼容模式重试')
  } finally {
    vi.useRealTimers()
  }
})
```

Extend the retry test to verify the loading render removes the retry button before another click can schedule work:

```ts
const retry = root.querySelector('[data-action="retry-model"]') as HTMLButtonElement
retry.click()
expect(root.textContent).toContain('兼容模式加载中')
expect(root.querySelector('[data-action="retry-model"]')).toBeNull()
expect(dependencies.createPoseClient).toHaveBeenCalledTimes(2)
```

- [ ] **Step 6: Run the integration tests and confirm RED**

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts -t "retries model loading|never settles"`

Expected: FAIL because initialization is unbounded and retry still starts the standard mode.

- [ ] **Step 7: Make controller initialization mode-aware and bounded**

Change the method signature and beginning:

```ts
private async initializePoseForCalibration(
  session: CalibrationSession,
  video?: HTMLVideoElement,
  mode: CalibrationModelMode = 'standard',
): Promise<void> {
  const preview = video ?? document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined
  if (!preview || !this.isCurrentCalibration(session)) return
  const initialization = ++this.poseInitialization
  session.beginModelLoading(mode)
  this.renderCalibrationSession(session)
  this.poseClient?.dispose()
  this.poseClient = null
```

Wrap creation while preserving the closure that checks the actual current client:

```ts
client = await initializePoseClientWithTimeout(createDirectPoseClient(
  document.baseURI,
  sample => {
    if (this.isCurrentCalibration(session) && client !== null && this.poseClient === client) this.onPose(sample)
  },
  () => {
    if (!this.isCurrentCalibration(session) || client === null || this.poseClient !== client) return
    client.dispose()
    this.poseClient = null
    session.modelFailed()
    this.renderCalibrationSession(session)
  },
  undefined,
  { mode },
))
```

Retain the existing `initialization !== this.poseInitialization` check so superseded clients are disposed. Change the retry action to the final form:

```ts
onRetryModel: () => { void this.initializePoseForCalibration(session, undefined, 'compatibility') },
```

The immediate `session.beginModelLoading()` render replaces the retry button, preventing duplicate current clicks; attempt identity and late disposal protect against stale asynchronous completion.

- [ ] **Step 8: Run the full controller test and confirm GREEN**

Run: `npm.cmd test -- --run tests/app/app-controller.test.ts`

Expected: all controller tests PASS, including timeout, late disposal, compatibility mode, and one camera startup.

- [ ] **Step 9: Run all unit tests to catch snapshot or mock signature regressions**

Run: `npm.cmd test -- --run`

Expected: all 18 test files and the existing 104 tests plus the new recovery tests PASS with zero failures.

- [ ] **Step 10: Commit Task 3**

```powershell
git add src/app/app-controller.ts tests/app/app-controller.test.ts
git commit -m "fix: recover from stalled pose initialization"
```

### Task 4: Verify, Integrate, Publish, and Check the Phone URL

**Files:**
- Verify: all source and test files changed in Tasks 1-3
- Build output: `dist/` (generated and not committed)

**Interfaces:**
- Consumes: completed recovery implementation and existing GitHub Pages workflow.
- Produces: a verified `master` build deployed at `https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`.

- [ ] **Step 1: Run fresh full verification**

Run each command separately:

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build:pages
npm.cmd run test:e2e
```

Expected: unit tests PASS, TypeScript exits 0, Pages build verifies required assets, and all mobile E2E tests PASS.

- [ ] **Step 2: Inspect the final diff and commit state**

Run:

```powershell
git status --short
git diff master...HEAD --check
git log --oneline --decorate -6
```

Expected: no unstaged source changes, no whitespace errors, and three focused implementation commits after the plan commit.

- [ ] **Step 3: Complete the feature branch using the finishing workflow**

Invoke `superpowers:finishing-a-development-branch`, rerun its required verification, merge the verified `codex/pose-init-recovery` branch into local `master`, and retain no unrelated workspace changes.

- [ ] **Step 4: Push the verified master branch**

```powershell
git push github master
```

Expected: the remote `master` advances to the recovery merge/fast-forward commit.

- [ ] **Step 5: Verify GitHub Pages deployment and public assets**

Poll the latest Pages workflow until it reports `completed/success`, then request:

```text
https://liuyeyang2012-creator.github.io/motion-ski-game-2026/
https://liuyeyang2012-creator.github.io/motion-ski-game-2026/vision_wasm_nosimd_internal.js
https://liuyeyang2012-creator.github.io/motion-ski-game-2026/vision_wasm_nosimd_internal.wasm
https://liuyeyang2012-creator.github.io/motion-ski-game-2026/pose_landmarker.task
```

Expected: the workflow succeeds and all four URLs return HTTP 200. Confirm the deployed HTML references the newly generated JavaScript bundle rather than the previous `assets/index-B6xyTlrd.js`.

- [ ] **Step 6: Report the phone acceptance path**

Give the user the public URL and this exact acceptance sequence: open the page, allow camera once, wait no more than 15 seconds; if ordinary mode cannot start, tap “兼容模式重试”; confirm the camera preview remains visible and the flow advances to “人体识别”.
