# Mac release checklist

For every Mac build (`npm run build:mac`).

1. **Identity and signature (automatic).** `scripts/mac-sign.js` signs the app with
   Identifier `pro.getpeakflow.core` (helper `pro.getpeakflow.core.helper`) and checks
   `codesign --verify --deep --strict`. `scripts/checks/mac-release-identity.mjs` then
   checks the packaged `release/mac*/PeakFlow.app`: bundle id, name, signing identifier
   and verify. The build fails if any check fails. Run it by hand on any app:
   `node scripts/checks/mac-release-identity.mjs /path/to/PeakFlow.app`.
2. **`.env` with the three top-up links.** `scripts/checks/topup-links.mjs` fails the
   build without `MAIN_VITE_DICTATION_TOPUP_URL_5`, `_10` and `_20`. The file is
   gitignored; copy it from a previous build folder.
3. **Signing identity.** Unsigned (ad-hoc) builds lose the Accessibility grant on every
   update. For a stable grant across updates, set `PEAKFLOW_MAC_SIGN_IDENTITY` (and
   `PEAKFLOW_MAC_SIGN_KEYCHAIN`) to a self-signed identity made by
   `scripts/mac/make-selfsigned-identity.sh`. Developer ID remains the real fix.
   Note that the first update after switching still needs one re-grant.
4. **After installing an update on a Mac**, open the PeakFlow log. If it says
   "needs the Accessibility permission", remove PeakFlow from Accessibility (select it,
   click −), then add it again with + from Applications. Hold-to-talk and snippets
   start working without a restart.
