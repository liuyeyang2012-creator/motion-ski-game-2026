# Final Review Fixes Report

## Scope

- Addressed only the two Important findings: reachable close-range bilateral extension and truly continuous 400 ms holds.
- Kept the fixture success path compatible with the continuous-sample contract.
- Did not perform Minor legacy API cleanup and did not deploy.

## RED evidence

- Command: `npm.cmd test -- --run tests/motion/calibration.test.ts tests/motion/calibration-session.test.ts`
- Result before production changes: exit 1; 5 failed, 14 passed.
- Expected failures: realistic bilateral reach at shoulder widths 0.35, 0.4, and 0.5; multi-second matching gap; background-suspension recovery.
- Initial E2E after enforcing continuity: exit 1 because the built-in success fixture provided only two action samples 400 ms apart. This correctly exposed that the fixture encoded the old discontinuous behavior.

## GREEN implementation

- Reach now requires both wrists outside their corresponding shoulders and a wrist span at least 1.5 times the calibrated shoulder width. The deterministic 0.35, 0.4, and 0.5 cases use an in-frame 1.6-times wrist span.
- Matching samples may be at most 200 ms apart. The controller targets 80 ms, so this tolerates one dropped frame (160 ms) while rejecting suspension-sized gaps.
- A wrong action, invalid framing, or gap over 200 ms clears only current hold timing. Completed steps and the calibration profile remain intact.
- The seated success fixture now emits action samples every 80 ms through the full 400 ms hold, then preserves the existing 450 ms success transition timing.

## Verification

- Focused target tests: 19/19 passed.
- Focused motion suite: 32/32 passed.
- Full Vitest: 84/84 passed.
- Typecheck: passed (`tsc --noEmit`).
- E2E: 1/1 passed after fixture correction.
- `git diff --check`: passed.

## Self-review

- Both-arm semantics are explicit; one-arm-only and insufficient-span cases fail.
- The close-range rule remains physically possible within normalized coordinates at all requested shoulder widths.
- Hold duration remains 400 ms; success display remains 450 ms; pose-loss recovery remains 1500 ms.
- Timestamp-driven tests cover both a seconds-long sample gap and background/RAF-style suspension after a completed step.
- Diff is limited to calibration logic, its tests, and the fixture timing required to preserve existing E2E behavior.

## Risks

- The 1.5-times wrist-span threshold is a product sensitivity choice; real-device tuning may later justify adjustment, but requested deterministic widths and existing behavior pass.
- Sustained pose inference below one matching sample per 200 ms intentionally restarts the hold rather than accepting a non-continuous action.

## Commit

- `fix: keep close-range calibration actions continuous` (this commit; SHA reported after creation)
