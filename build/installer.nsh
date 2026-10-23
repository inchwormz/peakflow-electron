; PeakFlow NSIS customisations (electron-builder `nsis.include`).
;
; Why: PeakFlow v1.6.5 and earlier update themselves by downloading this
; installer and launching it with only `--updated` (no /S, no --force-run).
; With the assisted (oneClick: false) installer that showed the whole wizard.
; v2's in-app updater (electron-updater) passes `--updated /S --force-run`.
;
; Rules here:
;   * launched with --updated  -> install silently (no wizard), same install
;     mode and folder as before (initMultiUser has already read them from the
;     registry before customInit runs), then start PeakFlow again;
;   * normal double-click      -> unchanged wizard.

!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endIf}
!macroend

!macro customInstall
  ; The stock template already starts the app when silent AND --force-run
  ; (electron-updater's quitAndInstall). Old in-app updaters omit
  ; --force-run, so start PeakFlow here in that case only. Same call as the
  ; template's StartApp macro (as the user, via the Start-menu shortcut when
  ; present, with --updated), written out to avoid redeclaring its variable.
  ${if} ${isUpdated}
  ${andIf} ${Silent}
  ${AndIfNot} ${isForceRun}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${endIf}
!macroend
