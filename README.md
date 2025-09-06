# Supported LINUX CLI
----
GitZipQR — Secure Archives via Inline QR Codes 📦🔐📱
[C++ code - max performance](https://github.com/RestlessByte/GitZipQR.cpp)
![GitZipQR Structure](https://github.com/RestlessByte/GitZipQR/blob/main/assets/structures/structures.png)

**Author:** Daniil (RestlessByte) — https://github.com/RestlessByte  
**License:** MIT
 
 # Dependencies
 - **[Bun Package Manager](https://bun.sh/)**
---------------------------------
GitZipQR turns any file or folder into encrypted QR codes. Input data is optionally zipped (for folders), encrypted with **AES-256-GCM** (key derived via **scrypt**), split into **QR-sized chunks**, and each chunk is embedded **directly inside a QR image** as base64 payload. The toolkit is written in **TypeScript**.
On restore, only the QR images are needed—integrity is verified chunk-by-chunk and globally before decrypting. If the source was a single file, it is recovered with its original extension.
**Passwords are requested in the CLI** (hidden input) during both encode/decode. No secrets live in the repo. ✅

---

## ✨ Features

- **End-to-end encryption**: AES-256-GCM with scrypt KDF 🔒  
- **Deterministic zipping**: normalized timestamps for reproducible archives 📦  
- **QR-ONLY storage**: ciphertext lives *inside* QR payloads (no external JSON needed) 📱  
- **Auto capacity calibration**: picks optimal chunk size so each chunk fits in one QR ✅  
- **Parallel QR generation/decoding**: uses all CPU cores; optional native `qrencode` for max perf ⚡
- **Integrity checks**: per-chunk SHA-256 + global SHA-256
- **Step-wise CLI log**: `STEP #N [1/0]` for each phase 🛠
- **Portable**: requires only QR PNGs and the passphrase to restore
- **Custom watermark QR**: generates an extra QR with a red `GitZipQR` watermark
- **CLI & SDK**: use from terminal or via `require('./sdk')`

---

## 🔍 How It Works

1. **Prepare data**: if input is a directory it's zipped (timestamps zeroed); files are used as-is.
2. **Encrypt** the data with AES-256-GCM.
   - Key: scrypt(passphrase, salt, N/r/p, keyLen=32)  
   - Nonce: 12 random bytes  
   - Auth tag appended to ciphertext  
3. **Calibrate QR capacity** (once) for chosen ECC level (default Q).  
4. **Chunk** ciphertext into pieces that each fit in **one QR**.  
5. Each chunk → inline QR payload:  
   ```json
   {
     "type": "GitZipQR-CHUNK-ENC",
     "version": "3.1-inline-only",
     "fileId": "...",
     "name": "folder.zip",
     "chunk": 12,
     "total": 345,
     "hash": "<sha256 of raw chunk>",
     "cipherHash": "<sha256 of full ciphertext+tag>",
     "dataB64": "<base64 of raw chunk>",
     "kdfParams": { "N": 32768, "r": 8, "p": 1 },
     "saltB64": "...",
     "nonceB64": "...",
     "chunkSize": 3072
   }
6. Restore by scanning a folder of QR PNGs:

   **Decode** each QR → extract chunk data

   *Verify per-chunk + global hashes*

   *Derive key via scrypt and decrypt with AES-GCM → original file or ZIP*
🛡 Security Model

Confidentiality & authenticity: AES-256-GCM

KDF: scrypt (N=2^15, r=8, p=1) slows brute-force

Passphrase: never written to disk, always requested interactively

Integrity: per-chunk SHA-256 + global SHA-256

⚠ Use a strong, unique, long passphrase (≥12–16 chars).

# 🚀 Quick Start
# Install
```bash
git clone git@github.com:RestlessByte/GitZipQR
cd GitZipQR
# dependencies are vendored; bun install is usually unnecessary
# but if you need to refresh them, the repo uses npmmirror via .npmrc
bun install || echo "offline mode"
```

### Docker

```bash
docker build -t gitzipqr .
# encode inside container (entrypoint is `bun run`)
docker run -it --rm -v $(pwd):/data gitzipqr encode /data/example.txt /data/out
# decode
docker run -it --rm -v $(pwd):/data gitzipqr decode /data/out /data/restore
```

# Example Encode
```bash
# 1) Prepare a sample file
echo "Hello World" > hello.txt

# 2) Encode → produces QR PNGs (inline mode)
bun encode ./hello.txt ./crypto

# 3) Inspect outputs
ls -1 ./crypto | head -n 5
```

Generate the additional watermark QR independently:

```bash
bun run custom-qr "some text" ./qrcode
```

Example Decode
```bash
# 4) Decode from QR images → restored file in ./restore
mkdir -p restore
bun decode ./crypto ./restore

# 5) Restored file is available with original name
cat ./restore/hello.txt
```

### Sync Folders

Copy new or changed files from one folder to another:

```bash
bun sync ./source ./dest
```

### SDK

Use the mini SDK for programmatic access from Node or the browser (via bundlers):

```javascript
const { encode, decode } = require('./sdk');

(async () => {
  await encode('hello.txt', ['mySecret'], './crypto');
  await decode('./crypto', ['mySecret'], './restore');
})();
```
⚡ Performance Notes

Uses multi-core workers for QR encoding/decoding.

If qrencode is installed (sudo apt install qrencode), native fast-path is used for PNG generation.

Environment variables:

QR_ECL=Q|H — error correction level (default Q for bigger capacity).

QR_WORKERS=8 — number of worker threads (default = CPU cores).

CHUNK_SIZE=... — override auto-detected chunk size.

SCRYPT_N/r/p — tune KDF hardness.

# 📜 License

**MIT © Daniil (RestlessByte) [https://github.com/RestlessByte]**
