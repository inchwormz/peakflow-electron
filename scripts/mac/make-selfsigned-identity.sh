#!/usr/bin/env bash
# Creates a self-signed code-signing identity for PeakFlow Mac builds, in a
# dedicated keychain file. NOT run automatically: John or the release owner runs it once.
#
#   scripts/mac/make-selfsigned-identity.sh ["PeakFlow Local Code Signing"]
#
# Writes only under $HOME/.secrets/peakflow-signing/ (folder 700, files 600).
# Never touches the login keychain or the keychain search list.
#
# Trust: the certificate is marked trusted for code signing with
# `security add-trusted-cert` WITHOUT -d, which writes a user-domain trust setting
# for this certificate's hash (not an admin-domain one, and not a keychain entry).
# macOS may show a GUI authorization prompt for that step. To undo it later:
#   security remove-trusted-cert "$HOME/.secrets/peakflow-signing/codesign-cert.pem"
#
# Expiry: the certificate is valid for 10 years from creation (the script prints the date).
# When it expires, rerun this script under a new name and update the signing variables;
# every Mac user then re-adds PeakFlow to Accessibility once.
#
# Afterwards, set for each build:
#   export PEAKFLOW_MAC_SIGN_IDENTITY="<the name printed at the end>"
#   export PEAKFLOW_MAC_SIGN_KEYCHAIN="$HOME/.secrets/peakflow-signing/peakflow-codesign.keychain-db"
#   security unlock-keychain -p "$(cat ~/.secrets/peakflow-signing/keychain.pass)" "$PEAKFLOW_MAC_SIGN_KEYCHAIN"
# The keychain is left locked at the end of this script; unlock it before each build.
set -euo pipefail
umask 077

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

# Self-signed certificate, valid 10 years, code signing only.
# The PKCS#12 password goes through the environment (-passout env:), not the command line.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
P12_PASS="$P12_PASS" openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/identity.p12" -passout env:P12_PASS -name "$NAME"
EXPIRES="$(openssl x509 -in "$WORK/cert.pem" -noout -enddate | sed 's/^notAfter=//')"
cp "$WORK/cert.pem" "$DIR/codesign-cert.pem" # public certificate only; needed to undo the trust step

# Dedicated keychain (not login), unlocked for this script only.
# Note: security(1) takes the keychain and PKCS#12 passwords as arguments, so they are
# briefly visible in `ps` to processes of this same user. The keychain file itself is
# 600 under a 700 folder, and the secrets never leave this user account.
security create-keychain -p "$KC_PASS" "$KC"
security set-keychain-settings -t 36000 "$KC"
security unlock-keychain -p "$KC_PASS" "$KC"
# -x: the private key is non-exportable (it cannot be copied out of this keychain)
security import "$WORK/identity.p12" -k "$KC" -P "$P12_PASS" -x -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KC" >/dev/null

# Trust for code signing (user-domain trust, see the header; may show a GUI prompt).
# codesign will not use an untrusted self-signed identity, so this runs before the test.
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$WORK/cert.pem"

# Prove codesign can still use the non-exportable key: sign a throwaway copy of a system binary
cp /usr/bin/true "$WORK/probe"
if ! { codesign --force --sign "$NAME" --keychain "$KC" "$WORK/probe" && codesign --verify --strict "$WORK/probe"; }; then
  # Remove everything this run made, so the script can be run again after the cause is fixed
  security remove-trusted-cert "$DIR/codesign-cert.pem" 2>/dev/null || true
  security delete-keychain "$KC" 2>/dev/null || rm -f "$KC"
  rm -f "$PASS_FILE" "$DIR/codesign-cert.pem"
  echo "codesign could not use the new identity. Nothing was kept (keychain and password file removed)." >&2
  echo "Note: codesign looks for identities in the keychain search list; --keychain alone may not be enough." >&2
  exit 1
fi
echo "codesign test with the new identity: OK"

# Lock the keychain again; builds unlock it with the password file
security lock-keychain "$KC"

echo
echo "Created self-signed code-signing identity."
echo "Identity name: $NAME"
echo "Keychain:      $KC"
echo "Certificate expires: $EXPIRES"
echo "Keychain password file: $PASS_FILE (never print it)"
echo
echo "Use it for builds:"
echo "  export PEAKFLOW_MAC_SIGN_IDENTITY=\"$NAME\""
echo "  export PEAKFLOW_MAC_SIGN_KEYCHAIN=\"$KC\""
echo "Check: security find-identity -v -p codesigning \"$KC\""
