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
3. **Stable signing certificate (set before every release).** The release Mac must have the
   certificate **PeakFlow Code Signing** in its login keychain. It is made once, by hand, in
   Keychain Access > Certificate Assistant > Create a Certificate: Name `PeakFlow Code Signing`,
   Identity Type Self Signed Root, Certificate Type Code Signing, tick "Let me override
   defaults" and set the validity period to 3650 days. Certificate Assistant's own default is
   365 days, so do not accept the default. Build a release with:
   `PEAKFLOW_MAC_SIGN_IDENTITY="PeakFlow Code Signing" npm run build:mac`. Never ship an ad-hoc
   build (that is only for local tests, with `PEAKFLOW_MAC_ALLOW_ADHOC=1`).
   - **Never recreate the certificate.** A new one has a new leaf hash, so every Mac user has to
     add PeakFlow back to Accessibility once. Keep the old one.
   - **Back it up once:** Keychain Access > My Certificates > right-click "PeakFlow Code Signing" >
     Export, as a .p12 with a password, into `~/.secrets/peakflow-signing/` (folder 700, file 600).
     Never paste the password into chat or a file in the repo.
   - **Expiry:** check it with
     `security find-certificate -c "PeakFlow Code Signing" -p | openssl x509 -noout -enddate`.
     When it expires, codesign refuses to sign new builds with it. Renewing means a new
     certificate, so one Accessibility re-add for every Mac user.
   - Developer ID remains the real fix (notarized, no warning, no re-add). The first update
     after switching to this certificate also needs one re-grant.
   - `scripts/mac/make-selfsigned-identity.sh` is an older route (its own keychain file, 10 years).
     Do not use it for releases; it does not make the login-keychain certificate above.
4. **After installing an update on a Mac**, check the PeakFlow log for this line:
   `[Launcher] Hold key and snippets need the Accessibility permission (not trusted)`.
   The Dictation page also shows a warning row with an Open settings button when this
   happens. Fix: remove PeakFlow from Accessibility (select it, click −), then add it again
   with + from Applications. Hold-to-talk and snippets start working without a restart.
