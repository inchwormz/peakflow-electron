# Mac release checklist

For every Mac build (`npm run build:mac`).

1. **Identity and signature (automatic).** `scripts/mac-sign.js` signs the app with
   Identifier `pro.getpeakflow.core` (helper `pro.getpeakflow.core.helper`) and checks
   `codesign --verify --deep --strict`. `scripts/checks/mac-release-identity.mjs` then
   checks the PeakFlow.app this build made under `release/mac*/`: bundle id, name, signing
   identifier, verify, and that it is not ad-hoc signed (unless `PEAKFLOW_MAC_ALLOW_ADHOC=1`
   is set for a local test). A Developer ID build must also use the hardened runtime. A
   self-signed build must be signed by the stable certificate with its pinned leaf (item 3). The
   build fails if any check fails. Run it by hand on any app:
   `node scripts/checks/mac-release-identity.mjs /path/to/PeakFlow.app`.
2. **`.env` with the three top-up links.** `scripts/checks/topup-links.mjs` fails the
   build without `MAIN_VITE_DICTATION_TOPUP_URL_5`, `_10` and `_20`. The file is
   gitignored; copy it from a previous build folder.
3. **Stable signing certificate (set before every release).** Every release build is signed
   with the self-signed certificate **PeakFlow Code Signing**. Build a release with:
   `PEAKFLOW_MAC_SIGN_IDENTITY="PeakFlow Code Signing" npm run build:mac`.
   Without an identity, `mac-sign.js` fails the build and points here. Ad-hoc is only for local
   tests (`PEAKFLOW_MAC_ALLOW_ADHOC=1`). Never ship an ad-hoc build.
   - **Certificate facts:** name `PeakFlow Code Signing`; SHA-1 fingerprint
     `2C6DF1B6EA8E330D6D4727B05F7A1CE533C55755` (the release gate pins this leaf; override
     only with `PEAKFLOW_MAC_SIGN_LEAF_SHA1`); self-signed, codeSigning EKU; **expires 2036-10-21**.
   - **Backup:** `~/.secrets/peakflow-signing/` (`peakflow-code-signing.p12`, its `.pass` file,
     `.crt`, `.key`; folder 700, files 600). Never paste the password into chat or a file in the repo.
   - **Install on a Mac** (once per release Mac): run
     `~/Work/peakflow/docs/2026-10-25-v2.1.4-release/install-signing-cert.sh`. It imports the
     certificate into the login keychain and proves a test signature. macOS may ask for your
     password and show "codesign wants to sign using key". Click **Always Allow**.
   - **Verify it is there:** `security find-identity -v -p codesigning` must list
     "PeakFlow Code Signing". If it does not, do not build: fix the keychain first.
   - **Expiry reminder:** set a calendar reminder for about 30 days before 2036-10-21. When it
     expires, codesign refuses to sign with it.
   - **Never recreate the certificate.** A new one has a new leaf hash, so every Mac user has to
     add PeakFlow back to Accessibility once. Keep the old one. The release gate fails any build
     whose leaf is not the pinned one, so a new certificate cannot ship by accident.
   - **Limits:** self-signed builds are still not auto-update-capable on Mac, so users download
     the new version from the website by hand. First launch of a self-signed build is the same
     as 2.1.1: Gatekeeper warns, and the user chooses **Open Anyway**. Developer ID remains the
     real fix (notarized, no warning, no re-add). The first update after switching to this
     certificate also needs one Accessibility re-grant (item 4).
   - `scripts/mac/make-selfsigned-identity.sh` is an older route (its own keychain file, 10 years).
     Do not use it for releases; it does not make the login-keychain certificate above.
4. **After installing an update on a Mac**, check the PeakFlow log for this line:
   `[Launcher] Hold key and snippets need the Accessibility permission (not trusted)`.
   The Dictation page also shows a warning row with an Open settings button when this
   happens. Fix: remove PeakFlow from Accessibility (select it, click −), then add it again
   with + from Applications. Hold-to-talk and snippets start working without a restart.
5. **Remove local build copies after verifying a Mac build** (agent-added, approved via coordinator 2026-10-25).
   Unregister `release/mac/PeakFlow.app` and `release/mac-arm64/PeakFlow.app` with
   `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u <app-path>`,
   then delete those local app copies. A leftover x64 copy with the real bundle id can
   be opened by macOS instead of `/Applications/PeakFlow.app`; this caused the 2026-10-25 Intel install.
