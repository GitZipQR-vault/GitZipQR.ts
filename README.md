# GitZipQR — Secure Archives via JSON Fragments + QR Index 📦🔐🧩

![GitZipQR Structure](https://github.com/RestlessByte/GitZipQR/blob/main/structures.png)

**Author:** Daniil (RestlessByte) — https://github.com/RestlessByte  
**License:** MIT  

GitZipQR turns any folder into a **reproducible ZIP**, encrypts it with **AES-256-GCM** (key derived via **scrypt**), splits the ciphertext into **fixed-size JSON fragments**, and generates **QR images** that point to those fragments.  
On restore, you can scan a directory of QR images *or* use the JSON fragments directly — integrity is verified chunk-by-chunk and globally before decrypting.  
**Passwords are requested in the CLI** (hidden input) during both encode/decode. No secrets live in the repo. ✅  

---

## ✨ Features

- **End-to-end encryption**: AES-256-GCM with scrypt KDF 🔒  
- **Deterministic zipping**: normalized timestamps for reproducible archives 📦  
- **Chunking**: ciphertext → fixed-size base64 JSON fragments 🧩  
- **QR index**: compact QR payloads that reference fragment paths 🧾➡️📱  
- **Integrity checks**: per-chunk SHA-256 + global SHA-256 ✅  
- **Pure CLI flow**: hidden password prompts at encode/decode ⌨️  
- **Portable artifacts**: `manifest.json`, `fragments/*.bin.json`, `qrcodes/*.png`  

---

## 🔍 How It Works

1. **Zip** the input directory (timestamps zeroed for reproducibility).  
2. **Encrypt** the ZIP with AES-256-GCM.  
   - Key: scrypt(passphrase, salt, N/r/p, keyLen=32)  
   - Nonce: 12 random bytes  
   - Auth tag appended to ciphertext  
3. **Chunk** ciphertext into fixed-size pieces (default **64 KiB**).  
4. Each chunk → JSON fragment (metadata + base64 data).  
   - SHA-256 of each chunk included  
   - QR image generated with compact metadata `{v,id,seq,total,json}`  
5. **manifest.json** written with public params (salt, nonce, KDF params, sizes, hashes).  
6. **Restore** from fragments or QR:  
   - Decode QR to locate fragment paths  
   - Verify chunk hashes + global hash  
   - Derive key via scrypt and decrypt with AES-GCM → original ZIP  

> **Note:** QR codes contain *no secret data*. Security relies entirely on the passphrase + encrypted fragments.  

---

## 🛡️ Security Model

- **Confidentiality & authenticity**: AES-256-GCM  
- **KDF**: scrypt (`N=2^15, r=8, p=1`) slows brute-force  
- **Passphrase**: never written to disk, always requested interactively  
- **Manifest**: contains only *public* parameters (salt, nonce, sizes, hashes)  
- **Integrity**: per-chunk SHA-256 + global SHA-256  
- ⚠️ Use a **strong, unique, long passphrase** (≥12–16 chars). Weak passwords can be brute-forced.  

---

## 🚀 Quick Start

### Install

```bash
git clone git@github.com:RestlessByte/GitZipQR
cd GitZipQR
bun install   # or npm install
# 1) Prepare a sample folder
mkdir -p example
cat > example/index.txt <<'TXT'
Hello World
TXT

# 2) Encode → produces manifest.json, fragments/*.bin.json, qrcodes/*.png
bun run encode ./example ./crypto
# or: npm run encode -- ./example ./crypto

# 3) Inspect outputs
ls -1 ./crypto
ls -1 ./crypto/qrcodes | head -n 5

# 4) Decode from QR images → restored ZIP will be written into ./restore
mkdir -p restore
bun run decode ./crypto/qrcodes ./restore
# or: npm run decode -- ./crypto/qrcodes ./restore

# 5) Verify ZIP content
unzip -l ./restore/example.zip

# 6) Optional: extract and compare with original
mkdir -p ./restore/_example
unzip -q ./restore/example.zip -d ./restore/_example
diff -ruN ./example ./restore/_example && echo "OK: restored matches original ✅"
```

🗂️ Project Structure

```graphql
core/
  encode.js        # ZIP → Encrypt → Chunk → Fragments + QR meta
  decode.js        # QR → fragment paths → Verify + Decrypt → ZIP
  manifest.js      # writes manifest.json (public params)
qrcodes/           # generated QR images (metadata only)
fragments/         # JSON fragments with base64 data
manifest.json      # public parameters for KDF/GCM + sizes + hashes
```
📏 Defaults & Tuning

Chunk size: CHUNK_SIZE env (default 65536 bytes).

KDF (scrypt): defaults to N=2^15, r=8, p=1. Raise N for stronger KDF.

Memory: scrypt uses up to ~512MB (configurable in code).

# 🧾 Fragment Format (*.bin.json)
```json
{
  "type": "GitZipQR-CHUNK-ENC",
  "version": "1.1",
  "fileId": "9b2a1c3d55aae7f1",
  "name": "myfolder.zip",
  "chunk": 12,
  "total": 345,
  "hash": "<sha256 of raw chunk>",
  "cipherHash": "<sha256 of full ciphertext+tag>",
  "data": "<base64 of raw chunk bytes>"
}
```

# 🧷 QR Payload (compact)

```json
{
  "v": 1,
  "id": "<fileId>",
  "seq": 12,
  "total": 345,
  "json": "fragments/qr-000012.bin.json"
}
```
## 📜 License

* MIT © Daniil (RestlessByte)
* https://github.com/RestlessByte