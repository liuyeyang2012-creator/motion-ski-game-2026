# Mobile Motion Ski Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portrait mobile web game in which office workers use locally detected body motions to steer through a first-person 2.5D ski course in seated or standing mode.

**Architecture:** A framework-free TypeScript application separates camera/pose acquisition, calibrated motion detection, deterministic game rules, Canvas rendering, local persistence, and screen orchestration. MediaPipe Pose Landmarker runs locally in video mode behind a narrow adapter; game rules consume normalized motion events and never depend on camera or model details.

**Tech Stack:** Vite, TypeScript, Canvas 2D, `@mediapipe/tasks-vision`, Vitest with happy-dom, Playwright, browser MediaDevices and Web Storage APIs.

## Global Constraints

- The application is a portrait-oriented mobile website and requires no account or installation.
- Raw camera frames, landmarks, and frame-by-frame motion data never leave the device and are never persisted.
- First release contains the 2.5D first-person alpine skiing map only.
- Supported play styles are `seated` and `standing`; only standing mode includes squat obstacles.
- Supported sessions are `quick` (30 seconds), `standard` (120 seconds), and `endless` (ends after three severe collisions).
- A normal collision slows the player and clears the combo; it does not end timed sessions.
- Uncertain pose input must not penalize the player.
- Do not require jumping, fast head turns, back bends, or body spins.
- After five cumulative continuous minutes, show a non-blocking rest reminder.
- Persist only best score, best combo, cumulative activity duration, and last selections in local storage.
- Vite requires Node.js 20.19+ or 22.12+; verify the installed runtime before scaffolding.
- Before implementation, install Git for Windows or otherwise provide `git`; the current environment has no Git executable, so commit steps cannot run until this prerequisite is satisfied.

---

## File Structure

```text
index.html                         App entry document
package.json                       Commands and locked dependency declarations
vite.config.ts                     Vite and Vitest configuration
playwright.config.ts               Mobile end-to-end configuration
public/models/pose_landmarker.task Local pose model asset
src/main.ts                        Composition root and browser startup
src/styles.css                     Portrait mobile screens and accessible controls
src/app/app-controller.ts          Screen flow and dependency orchestration
src/app/types.ts                   Shared product-level types
src/camera/camera-controller.ts    Camera permission and stream lifecycle
src/pose/pose-worker.ts             MediaPipe worker implementation
src/pose/pose-client.ts             Worker-facing pose adapter
src/pose/types.ts                   Landmark/result contracts
src/motion/calibration.ts           Player-specific neutral baselines
src/motion/motion-detector.ts       Debounced motion event detection
src/game/types.ts                   Pure game state and obstacle types
src/game/config.ts                  Session curves and obstacle definitions
src/game/game-engine.ts             Deterministic rules and scoring
src/render/ski-renderer.ts          Canvas 2.5D scene and quality levels
src/storage/player-records.ts       Validated local-only records
src/platform/lifecycle.ts           Visibility, orientation, and rest timer
src/ui/screens.ts                   DOM screen construction and announcements
tests/**/*.test.ts                  Vitest unit and integration tests
e2e/happy-path.spec.ts              Playwright flow and privacy assertions
e2e/error-states.spec.ts            Permission, orientation, and recovery tests
README.md                           Setup, privacy, controls, and QA instructions
```

---

### Task 1: Project Foundation and Mobile Shell

**Files:**
- Create: `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `playwright.config.ts`
- Create: `src/main.ts`, `src/styles.css`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm commands `dev`, `build`, `test`, `test:e2e`, and `typecheck`.
- Produces: DOM roots `#app`, `#game-canvas`, and `#camera-preview` for later tasks.

- [ ] **Step 1: Verify prerequisites and initialize version control**

Run:

```powershell
node --version
git --version
git init
```

Expected: Node reports `v20.19.0` or newer in the 20.x line, or `v22.12.0` or newer; Git reports a version and initializes the repository. Stop and install/enable the missing prerequisite if either command fails.

- [ ] **Step 2: Scaffold the TypeScript app and install test dependencies**

Run:

```powershell
npm create vite@latest . -- --template vanilla-ts --no-interactive
npm install @mediapipe/tasks-vision
npm install -D vitest happy-dom @playwright/test
npx playwright install chromium
```

Expected: dependencies install successfully and `package-lock.json` is created.

- [ ] **Step 3: Write the failing smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mountShell } from '../src/main';

describe('mobile shell', () => {
  it('mounts the game, camera, and status regions', () => {
    document.body.innerHTML = '<div id="app"></div>';
    mountShell(document.querySelector('#app')!);
    expect(document.querySelector('#game-canvas')).toBeInstanceOf(HTMLCanvasElement);
    expect(document.querySelector('#camera-preview')).toBeInstanceOf(HTMLVideoElement);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('准备');
  });
});
```

- [ ] **Step 4: Run the test and confirm failure**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL because `mountShell` is not exported.

- [ ] **Step 5: Implement the minimal shell and configuration**

In `src/main.ts` export:

```ts
import './styles.css';

export function mountShell(root: Element): void {
  root.innerHTML = `
    <main class="app-shell">
      <video id="camera-preview" muted playsinline aria-label="摄像头取景"></video>
      <canvas id="game-canvas" width="720" height="1280" aria-label="滑雪游戏画面"></canvas>
      <section id="screen-layer"></section>
      <p class="sr-only" role="status" aria-live="polite">准备开始</p>
    </main>`;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#app');
  if (root) mountShell(root);
}
```

Set Vitest to `environment: 'happy-dom'` in `vite.config.ts`, add scripts `"test": "vitest"`, `"typecheck": "tsc --noEmit"`, and `"test:e2e": "playwright test"` to `package.json`. Set `playwright.config.ts` to use a 390×844 portrait viewport and Vite web server.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run tests/smoke.test.ts
npm run typecheck
npm run build
git add package.json package-lock.json index.html vite.config.ts playwright.config.ts src tests
git commit -m "chore: scaffold motion ski web app"
```

Expected: one passing test, clean typecheck, successful production build, and one commit.

---

### Task 2: Product Types and Local Player Records

**Files:**
- Create: `src/app/types.ts`, `src/storage/player-records.ts`
- Test: `tests/storage/player-records.test.ts`

**Interfaces:**
- Produces: `PlayStyle = 'seated' | 'standing'` and `SessionKind = 'quick' | 'standard' | 'endless'`.
- Produces: `PlayerRecords`, `loadRecords(storage)`, `saveRecords(storage, records)`, and `recordResult(records, result)`.

- [ ] **Step 1: Write failing storage tests**

```ts
import { describe, expect, it } from 'vitest';
import { loadRecords, recordResult, saveRecords } from '../../src/storage/player-records';

describe('player records', () => {
  it('recovers from malformed local data', () => {
    const storage = new MapStorage([['motion-ski.records.v1', '{bad']]);
    expect(loadRecords(storage)).toMatchObject({ bestScore: 0, totalActiveMs: 0 });
  });

  it('keeps best values and accumulates activity time', () => {
    const next = recordResult(loadRecords(new MapStorage()), {
      score: 800, bestCombo: 12, activeMs: 30_000,
      playStyle: 'seated', sessionKind: 'quick'
    });
    expect(next).toMatchObject({ bestScore: 800, bestCombo: 12, totalActiveMs: 30_000 });
  });
});
```

Define `MapStorage` in the test as an in-memory object implementing `Pick<Storage, 'getItem' | 'setItem'>`.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run tests/storage/player-records.test.ts`

Expected: FAIL because the storage module does not exist.

- [ ] **Step 3: Implement validated records**

Define in `src/app/types.ts`:

```ts
export type PlayStyle = 'seated' | 'standing';
export type SessionKind = 'quick' | 'standard' | 'endless';
export interface SessionResult {
  score: number; bestCombo: number; activeMs: number;
  playStyle: PlayStyle; sessionKind: SessionKind;
}
```

Implement immutable defaults and explicit runtime number/string checks in `player-records.ts`; use storage key `motion-ski.records.v1`. Never store pose or camera data.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- --run tests/storage/player-records.test.ts
npm run typecheck
git add src/app/types.ts src/storage/player-records.ts tests/storage/player-records.test.ts
git commit -m "feat: persist local-only player records"
```

Expected: storage tests pass and typecheck succeeds.

---

### Task 3: Camera Lifecycle and Pose Adapter

**Files:**
- Create: `src/camera/camera-controller.ts`, `src/pose/types.ts`, `src/pose/pose-client.ts`, `src/pose/pose-worker.ts`
- Add: `public/models/pose_landmarker.task`
- Test: `tests/camera/camera-controller.test.ts`, `tests/pose/pose-client.test.ts`

**Interfaces:**
- Produces: `CameraController.start(video): Promise<MediaStream>`, `pause()`, `resume(video)`, and `stop()`.
- Produces: `PoseSample { capturedAt, landmarks, confidence }` and `PoseClient.start()`, `detect(bitmap, capturedAt)`, `dispose()`.
- Consumes: a locally stored MediaPipe-compatible pose model.

- [ ] **Step 1: Write camera lifecycle tests**

Test a mocked `navigator.mediaDevices.getUserMedia` and assert exact constraints `{ video: { facingMode: 'user' }, audio: false }`; assert `stop()` calls `stop()` on every track and clears `video.srcObject`.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --run tests/camera/camera-controller.test.ts`

Expected: FAIL because `CameraController` does not exist.

- [ ] **Step 3: Implement camera controller**

```ts
export class CameraController {
  private stream: MediaStream | null = null;
  async start(video: HTMLVideoElement): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' }, audio: false
    });
    video.srcObject = this.stream;
    await video.play();
    return this.stream;
  }
  pause(): void { this.stream?.getTracks().forEach(track => { track.enabled = false; }); }
  async resume(video: HTMLVideoElement): Promise<void> {
    this.stream?.getTracks().forEach(track => { track.enabled = true; });
    await video.play();
  }
  stop(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}
```

- [ ] **Step 4: Write pose-client contract tests**

Use a fake Worker and verify `detect()` transfers one `ImageBitmap`, ignores out-of-order result IDs, and emits only the newest `PoseSample` through a subscribed callback.

- [ ] **Step 5: Implement worker adapter**

Use `FilesetResolver.forVisionTasks()` and `PoseLandmarker.createFromOptions()` with `runningMode: 'VIDEO'`, `numPoses: 1`, and segmentation masks disabled. Call `detectForVideo(bitmap, capturedAt)` inside the Worker. Map the 33 returned landmarks to plain `{x,y,z,visibility}` objects and transfer only that result back. Keep model and WASM assets local; do not use `@latest` CDN URLs.

- [ ] **Step 6: Verify model licensing and source**

Download a compatible official Pose Landmarker model into `public/models/pose_landmarker.task`, record its source URL and license in `README.md`, and verify no application URL references a third-party CDN.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- --run tests/camera tests/pose
npm run typecheck
git add src/camera src/pose tests/camera tests/pose public/models README.md
git commit -m "feat: add local camera and pose pipeline"
```

Expected: all camera/pose tests pass and no network upload code exists.

---

### Task 4: Calibration and Debounced Motion Detection

**Files:**
- Create: `src/motion/calibration.ts`, `src/motion/motion-detector.ts`
- Test: `tests/motion/calibration.test.ts`, `tests/motion/motion-detector.test.ts`

**Interfaces:**
- Consumes: `PoseSample`, `PlayStyle`.
- Produces: `CalibrationProfile` and `MotionEvent { type, occurredAt, confidence }`.
- Motion types: `lean-left`, `lean-right`, `duck`, `squat`, `hands-up`, `reach-left`, `reach-right`, `pose-lost`.

- [ ] **Step 1: Write failing calibration tests**

Use fixed landmark fixtures and assert that five stable neutral samples produce normalized shoulder width, hip height, head height, and torso center baselines; samples with required landmark visibility below `0.6` must return a specific issue such as `hips-not-visible`.

- [ ] **Step 2: Write failing detector tests**

Cover these exact behaviors:

```ts
expect(detect(sequenceLeanLeft)).toEqual(['lean-left']);
expect(detect(sequenceHeldLeft)).toEqual(['lean-left']); // no repeat while held
expect(detect(sequenceReturnThenLeft)).toEqual(['lean-left', 'lean-left']);
expect(detect(lowConfidenceSequence)).toEqual([]);
expect(detect(squatSequence, 'seated')).not.toContain('squat');
expect(detect(squatSequence, 'standing')).toContain('squat');
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test -- --run tests/motion`

Expected: FAIL because calibration and detection functions do not exist.

- [ ] **Step 4: Implement calibration and stateful detection**

Expose:

```ts
export function buildCalibration(samples: PoseSample[], style: PlayStyle): CalibrationResult;
export class MotionDetector {
  constructor(profile: CalibrationProfile, style: PlayStyle) {}
  update(sample: PoseSample): MotionEvent[] { return []; }
  reset(): void {}
}
```

Use body-relative ratios rather than pixels. Require a threshold to remain crossed for 120 ms, emit once, and re-arm only after returning inside the neutral band for 160 ms. Keep thresholds in one exported `MOTION_THRESHOLDS` object so device testing can tune them without touching rule logic.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- --run tests/motion
npm run typecheck
git add src/motion tests/motion
git commit -m "feat: calibrate and detect safe body motions"
```

Expected: all motion fixture tests pass.

---

### Task 5: Deterministic Game Engine

**Files:**
- Create: `src/game/types.ts`, `src/game/config.ts`, `src/game/game-engine.ts`
- Test: `tests/game/game-engine.test.ts`

**Interfaces:**
- Consumes: `MotionEvent`, `PlayStyle`, `SessionKind`, elapsed milliseconds, and injected seeded random function.
- Produces: immutable `GameState`, `GameEvent[]`, and final `SessionResult` plus motion counts.

- [ ] **Step 1: Write failing rule tests**

Test that quick ends at `30_000`, standard ends at `120_000`, endless ends on the third severe collision, and timed modes continue after any number of normal collisions. Test that collision sets combo to zero and applies a finite slowdown. Test that low-confidence/`pose-lost` input never creates a collision.

- [ ] **Step 2: Add obstacle generation tests**

Assert that the first 10 seconds contain lane-change obstacles only, seated mode never emits `squat` requirements, every obstacle has `warningLeadMs` between 1500 and 2000, and seeded input produces identical obstacle sequences.

- [ ] **Step 3: Run and confirm failure**

Run: `npm test -- --run tests/game/game-engine.test.ts`

Expected: FAIL because `createGame` and `advanceGame` do not exist.

- [ ] **Step 4: Implement pure engine functions**

```ts
export function createGame(options: {
  playStyle: PlayStyle; sessionKind: SessionKind; seed: number;
}): GameState;

export function advanceGame(
  state: GameState,
  deltaMs: number,
  motions: MotionEvent[]
): { state: GameState; events: GameEvent[] };
```

Keep obstacle schedules in `config.ts`. Count completed motions only when the corresponding event changes game outcome. Set maximum speed explicitly in configuration. Define severe collisions only for endless mode when pose confidence is sufficient and the warning window elapsed without the required action.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- --run tests/game/game-engine.test.ts
npm run typecheck
git add src/game tests/game
git commit -m "feat: implement deterministic ski game rules"
```

Expected: all deterministic rules pass.

---

### Task 6: 2.5D Ski Renderer and Quality Degradation

**Files:**
- Create: `src/render/ski-renderer.ts`
- Test: `tests/render/ski-renderer.test.ts`

**Interfaces:**
- Consumes: readonly `GameState`, canvas dimensions, and `QualityLevel = 'high' | 'medium' | 'low'`.
- Produces: `SkiRenderer.render(state)`, `resize(width,height,dpr)`, `setQuality(level)`, and `dispose()`.

- [ ] **Step 1: Write failing renderer tests**

Use a mocked 2D context and assert a frame clears the canvas, draws sky/slope before obstacles, scales near obstacles larger than far obstacles, and omits particles and shadows at low quality.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --run tests/render/ski-renderer.test.ts`

Expected: FAIL because `SkiRenderer` does not exist.

- [ ] **Step 3: Implement the renderer**

```ts
export class SkiRenderer {
  constructor(private canvas: HTMLCanvasElement) {}
  resize(width: number, height: number, dpr: number): void {}
  setQuality(level: QualityLevel): void {}
  render(state: Readonly<GameState>): void {}
  dispose(): void {}
}
```

Use normalized world coordinates and a single perspective projection helper. Draw layers in order: gradient sky, distant mountains, slope, lane guides, obstacles/rewards, snow effects, speed vignette, HUD. Do not read camera or pose state here.

- [ ] **Step 4: Add frame-budget degradation**

Track a rolling 120-frame average. Drop from high to medium above 20 ms average and from medium to low above 28 ms; never automatically raise quality during an active session. Low removes particles, shadows, and one distant layer while preserving obstacles and HUD.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- --run tests/render/ski-renderer.test.ts
npm run build
git add src/render tests/render
git commit -m "feat: render adaptive 2.5d ski course"
```

Expected: renderer tests and build pass.

---

### Task 7: Screens, Calibration Flow, and Results

**Files:**
- Create: `src/ui/screens.ts`, `src/app/app-controller.ts`
- Modify: `src/main.ts`, `src/styles.css`
- Test: `tests/app/app-controller.test.ts`, `tests/ui/screens.test.ts`

**Interfaces:**
- Consumes: camera, pose, motion, engine, renderer, storage, and lifecycle interfaces.
- Produces: application states `welcome`, `permissions`, `setup`, `calibrating`, `countdown`, `playing`, `paused`, `results`, and `error`.

- [ ] **Step 1: Write failing flow tests**

Using fake dependencies, assert:

```ts
welcome -> permissions -> setup -> calibrating -> countdown -> playing -> results
```

Assert previous play style/session values preselect on setup, calibration errors display exact corrective copy, and results show score, distance, combo, collisions, action counts, and activity duration.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --run tests/app tests/ui`

Expected: FAIL because controller and screens do not exist.

- [ ] **Step 3: Implement accessible screen builders**

Provide functions returning `HTMLElement` for each screen. Controls must use native buttons/radio inputs, minimum 44×44 CSS pixel targets, visible focus styles, and Chinese copy. Keep a persistent privacy label: `摄像头画面仅在本机识别，不上传、不保存`.

- [ ] **Step 4: Implement controller transitions**

Inject dependencies through the constructor. The controller owns transitions but delegates all domain work. During calibration show specific issues: `光线太暗`, `请后退一点，让肩膀和髋部进入画面`, or `请保持身体稳定`. Count down `3, 2, 1` only after a valid profile exists.

- [ ] **Step 5: Wire the animation and inference loops**

Run rendering with `requestAnimationFrame`. Request pose inference at a separately capped cadence starting at 15 Hz; keep at most one inference in flight. Feed pose results into `MotionDetector`, pass resulting events to `advanceGame`, and release temporary samples at session end.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run tests/app tests/ui
npm run typecheck
npm run build
git add src/app src/ui src/main.ts src/styles.css tests/app tests/ui
git commit -m "feat: connect complete mobile game flow"
```

Expected: app flow tests, typecheck, and production build pass.

---

### Task 8: Lifecycle, Safety, and Recoverable Errors

**Files:**
- Create: `src/platform/lifecycle.ts`
- Modify: `src/app/app-controller.ts`, `src/ui/screens.ts`
- Test: `tests/platform/lifecycle.test.ts`, `tests/app/error-recovery.test.ts`

**Interfaces:**
- Produces: lifecycle events `backgrounded`, `foregrounded`, `portrait`, `landscape`, and `rest-due`.
- Consumes: controller methods `pause(reason)` and `resumeAfterPositionCheck()`.

- [ ] **Step 1: Write failing lifecycle tests**

Fake `visibilitychange`, orientation media query, and clock. Assert backgrounding pauses camera/game, returning requires position confirmation plus countdown, landscape blocks play, and exactly one rest reminder fires after 300,000 active milliseconds.

- [ ] **Step 2: Write failing recovery tests**

Mock `NotAllowedError`, absent `mediaDevices`, pose loss over two seconds, and corrupted local storage. Assert each maps to actionable Chinese copy and that storage corruption never blocks play.

- [ ] **Step 3: Run and confirm failure**

Run: `npm test -- --run tests/platform tests/app/error-recovery.test.ts`

Expected: FAIL because lifecycle service and recovery mappings do not exist.

- [ ] **Step 4: Implement lifecycle service and safety copy**

Accumulate only foreground playing time toward the five-minute reminder. Add first-use/setup safety copy: clear nearby obstacles, use gentle motions, and stop immediately if uncomfortable. Rest reminder is dismissible and never terminates a session.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- --run tests/platform tests/app/error-recovery.test.ts
npm run typecheck
git add src/platform src/app/app-controller.ts src/ui/screens.ts tests/platform tests/app/error-recovery.test.ts
git commit -m "feat: handle lifecycle safety and recovery"
```

Expected: lifecycle and recovery tests pass.

---

### Task 9: End-to-End Flow, Privacy Guard, and Documentation

**Files:**
- Create: `e2e/happy-path.spec.ts`, `e2e/error-states.spec.ts`, `e2e/fixtures/fake-pose.ts`
- Modify: `playwright.config.ts`, `README.md`

**Interfaces:**
- Consumes: stable `data-testid` attributes exposed by UI screens and an injected development-only fake pose provider selected by `?poseFixture=`.
- Produces: repeatable browser-level acceptance checks without requiring a real camera in CI.

- [ ] **Step 1: Add the test-only pose fixture seam**

In the composition root, allow fixture injection only when `import.meta.env.MODE === 'test'` or `import.meta.env.DEV` and the URL includes a recognized fixture name. Production builds must ignore this query parameter.

- [ ] **Step 2: Write the failing happy-path test**

```ts
import { expect, test } from '@playwright/test';

test('completes a seated quick session', async ({ page }) => {
  await page.goto('/?poseFixture=seated-quick-success');
  await page.getByRole('button', { name: '开始滑雪' }).click();
  await page.getByLabel('坐姿模式').check();
  await page.getByLabel('30 秒快速局').check();
  await page.getByRole('button', { name: '开始校准' }).click();
  await expect(page.getByText('本次身体活动')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/侧身 \d+ 次/)).toBeVisible();
});
```

- [ ] **Step 3: Add privacy and error-state tests**

Intercept all network requests during a fixture session. Allow only same-origin document, scripts, styles, model, and WASM assets; fail if any request method sends a body or targets an unapproved origin. Add tests for denied permission instructions, landscape blocking, pose loss pause, and return-from-background countdown.

- [ ] **Step 4: Run and fix only acceptance gaps**

Run: `npm run test:e2e`

Expected: initial failures identify missing test IDs, fixture wiring, or copy; make the minimum production changes necessary for the tests to pass.

- [ ] **Step 5: Complete README**

Document prerequisites, install/run/build/test commands, supported controls, camera privacy behavior, local-only stored fields, model source/license, device QA matrix, and manual checks for normal/low light and seated/standing framing.

- [ ] **Step 6: Run the full verification suite**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
npm run test:e2e
```

Expected: all unit tests pass, typecheck exits zero, production build succeeds, and all Playwright tests pass.

- [ ] **Step 7: Commit the acceptance suite**

Run:

```powershell
git add e2e playwright.config.ts README.md src
git commit -m "test: verify mobile flow privacy and recovery"
git status --short
```

Expected: commit succeeds and `git status --short` is empty.

---

## Manual Device Acceptance

- [ ] Test on one lower-performance Android phone, one mainstream Android phone, and one recent iPhone.
- [ ] On each device, complete seated quick, standing quick, and standing standard sessions in portrait orientation.
- [ ] Verify left/right lean, gentle duck, hands up, and standing squat respond without obvious game-breaking delay.
- [ ] Verify uncertain tracking pauses or holds state instead of causing a collision.
- [ ] Verify a two-minute session has no severe stutter and quality degradation preserves obstacles and HUD.
- [ ] Verify background/foreground recovery, rotation blocking, camera denial guidance, and local record persistence.
- [ ] Inspect browser network traffic and confirm no camera frames, pose landmarks, or motion streams are sent.
- [ ] Run a 5–8 person office-worker pilot and record time-to-first-game, false detections, unnatural actions, immediate replay intent, and qualitative discomfort reports.

## Implementation References

- Google MediaPipe Pose Landmarker for Web: `https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js`
- Vite Getting Started: `https://vite.dev/guide/`
- Vitest Getting Started: `https://vitest.dev/guide/`
- Playwright Installation: `https://playwright.dev/docs/intro`
