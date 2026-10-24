#!/usr/bin/env bash
# Creates a self-signed code-signing identity for PeakFlow Mac builds, in a
# dedicated keychain file. NOT run automatically: John or the release owner runs it once.
#
#   scripts/mac/make-selfsigned-identity.sh ["PeakFlow Local Code Signing"]
#
# Writes only under ~/.secrets/peakflow-signing/ (folder 700, files 600).
# Never touches the login keychain or the keychain search list.
# Afterwards, set for each build:
#   export PEAKFLOW_MAC_SIGN_IDENTITY="<the name printed at the end>"
#   export PEAKFLOW_MAC_SIGN_KEYCHAIN="$HOME/.secrets/peakflow-signing/peakflow-codesign.keychain-db"
#   security unlock-keychain -p "$(cat ~/.secrets/peakflow-signing/keychain.pass)" "$PEAKFLOW_MAC_SIGN_KEYCHAIN"
set -euo pipefail

NAME="${1:-PeakFlow Local Code Signing}"
DIR="$HOME/.secrets/peakflow-signing"
KC="$DIR/peakflow-codesign.keychain-db"
PASS_FILE="$DIR/keychain.pass"

if [[ -e "$KC" ]]; then
  echo "Refusing to overwrite existing keychain: $KC" >&2
  exit 1
fi

mkdir -p "$DIR"
chmod 700 "$DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

KC_PASS="$(openssl rand -hex 24)"
P12_PASS="$(openssl rand -hex 24)"
printf '%s' "$KC_PASS" > "$PASS_FILE"
chmod 600 "$PASS_FILE"

# Self-signed certificate, valid 10 years, code signing only
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/identity.p12" -passout "pass:$P12_PASS" -name "$NAME"

# Dedicated keychain (not login), unlocked for this script only
security create-keychain -p "$KC_PASS" "$KC"
security set-keychain-settings -t 36000 "$KC"
security unlock-keychain -p "$KC_PASS" "$KC"
security import "$WORK/identity.p12" -k "$KC" -P "$P12_PASS" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KC" >/dev/null
# Trust the certificate for code signing in this keychain only
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$WORK/cert.pem"

echo
echo "Created self-signed code-signing identity."
echo "Identity name: $NAME"
echo "Keychain:      $KC"
echo "Keychain password file: $PASS_FILE (never print it)"
echo
echo "Use it for builds:"
echo "  export PEAKFLOW_MAC_SIGN_IDENTITY=\"$NAME\""
echo "  export PEAKFLOW_MAC_SIGN_KEYCHAIN=\"$KC\""
echo "Check: security find-identity -v -p codesigning \"$KC\""
