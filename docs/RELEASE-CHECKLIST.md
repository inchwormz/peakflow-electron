# Mac release checklist

For every Mac build (`npm run build:mac`).

1. **Identity and signature (automatic).** `scripts/mac-sign.js` signs the app with
   Identifier `pro.getpeakflow.core` (helper `pro.getpeakflow.core.helper`) and checks
   `codesign --verify --deep --strict`. `scripts/checks/mac-release-identity.mjs` then
   checks the PeakFlow.app this build made under `release/mac*/`: bundle id, name, signing
   identifier, verify, and that it is not ad-hoc signed (unless `PEAKFLOW_MAC_ALLOW_ADHOC=1`
   is set for a local test). A Developer ID build must also use the hardened runtime. The
   build fails if any check fails. Run it by hand on any app:
   `node scripts/checks/mac-release-identity.mjs /path/to/PeakFlow.app`.
2. **`.env` with the three top-up links.** `scripts/checks/topup-links.mjs` fails the
   build without `MAIN_VITE_DICTATION_TOPUP_URL_5`, `_10` and `_20`. The file is
   gitignored; copy it from a previous build folder.
3. **Stable signing identity (set before every release).** Set `PEAKFLOW_MAC_SIGN_IDENTITY`
   and `PEAKFLOW_MAC_SIGN_KEYCHAIN` (stable identity) to a self-signed identity made by
   `scripts/mac/make-selfsigned-identity.sh`, unlocked as its header says. Ad-hoc releases make
   every Mac user re-add PeakFlow after each update. Developer ID remains the real fix. The
   self-signed certificate expires 10 years after it is made (the script prints the date).
   Note that the first update after switching still needs one re-grant.
4. **After installing an update on a Mac**, check the PeakFlow log for this line:
   `[Launcher] Hold key and snippets need the Accessibility permission (not trusted)`.
   The Dictation page also shows a warning row with an Open settings button when this
   happens. Fix: remove PeakFlow from Accessibility (select it, click −), then add it again
   with + from Applications. Hold-to-talk and snippets start working without a restart.
