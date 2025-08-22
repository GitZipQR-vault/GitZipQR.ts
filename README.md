# GitZipQR — Secure Archive via JSON Chunks + QR Index
Author: Daniil (RestlessByte) — https://github.com/RestlessByte

GitZipQR packs a folder into a ZIP, encrypts it with AES-256-GCM (key via scrypt), splits the ciphertext into fixed-size JSON fragments (base64), and generates QR images with compact metadata.

## Quick Start
npm i
export PASSPHRASE='your strong passphrase'
npm run encode -- ./example ./output
export PASSPHRASE='your strong passphrase'
npm run decode -- ./output/fragments ./restored

Notes:
- CHUNK_SIZE env var controls chunk size (default 65536).
- Keep PASSPHRASE outside the repo. manifest.json has no secrets.
