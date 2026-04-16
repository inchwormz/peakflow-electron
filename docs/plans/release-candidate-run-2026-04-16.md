# PeakFlow Release Candidate Run

Date: 2026-04-16  
Branch: `fix/release-blockers`  
Head: `f9613a2`

## Artifact

- Binary: `release/win-unpacked/PeakFlow.exe`
- Size: `188,802,048` bytes
- Built at: `2026-04-16 13:26:27`

## Automated Checks

- `npm run typecheck` — pass
- `npm run build` — pass
- `npm run build:unpack` — pass
- Smoke tests — pass
  - `test/main-bundle.quickboard.test.mjs`
  - `test/main-bundle.active-window.test.mjs`
  - `test/smoke/release-artifacts.test.mjs`
  - `test/smoke/license-policy.test.mjs`
  - `test/smoke/checkouts.test.mjs`

## Binary QA Notes

- Startup:
  - app launches
  - updater completes
  - no module-not-found crash on startup
- QuickBoard:
  - hotkey path reaches access gate
  - current local machine state denies access with `tool_not_licensed`
  - this is expected after fail-closed license hardening because the local stored product ID blob is corrupt
- FocusDim:
  - hotkey toggles on
  - overlays create on both displays
  - hotkey toggles off cleanly

## Remaining Blockers

- Local license/test state is still dirty on this machine. `peakflow.log` shows repeated `safeStorage.decryptString` warnings from old manually edited credential blobs in `%APPDATA%\\peakflow-electron`.
- Full all-tools E2E cannot be trusted until license state is normalized through a clean activation path or a fresh app-data profile.

## Verdict

This branch is now build-clean, typecheck-clean, and packaging-clean.  
The next highest-value step is license-state normalization, then a full per-surface binary QA pass under a clean entitlement state.
