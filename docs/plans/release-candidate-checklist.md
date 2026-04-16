# PeakFlow Release Candidate Checklist

Branch: `fix/release-blockers`

Use this checklist against the actual packaged binary, not `npm run dev`.

## Build Gate

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run build:unpack`
- [ ] Installer build succeeds, or the only blocker is signing
- [ ] Record binary path, size, timestamp, and git SHA

## Startup Gate

- [ ] App starts with no crash dialog
- [ ] Tray icon loads without fallback warning spam
- [ ] Dashboard/tray hub opens
- [ ] Updater check completes
- [ ] No `Cannot find module` errors in `peakflow.log`

## License Gate

- [ ] No-license state blocks paid surfaces cleanly
- [ ] Single-tool license unlocks only the mapped tool
- [ ] All-tools license unlocks every surface
- [ ] Corrupt product ID does not unlock the suite
- [ ] Unknown product ID does not unlock the suite
- [ ] No `safeStorage.decryptString` warning spam during normal startup

## Revenue Gate

- [ ] TrialExpired subscribe/buy path opens externally
- [ ] StatusBar upgrade path opens externally
- [ ] Share and Earn links open externally

## Surface Gate

- [ ] QuickBoard
- [ ] FocusDim
- [ ] MeetReady
- [ ] ScreenSlap
- [ ] SoundSplit
- [ ] LiquidFocus

## Release Decision

- [ ] All release blockers fixed
- [ ] Final smoke pass rerun on the exact candidate binary
- [ ] Candidate artifact archived with SHA and test notes
