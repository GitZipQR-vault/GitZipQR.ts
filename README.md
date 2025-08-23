# GitZipQR — Secure Archives via Inline QR Codes 📦🔐📱

![GitZipQR Structure](https://github.com/RestlessByte/GitZipQR/blob/main/assets/structures/structures.png)

**Author:** Daniil (RestlessByte) — https://github.com/RestlessByte  
**License:** MIT
 
 # Dependencies
 - **[Bun Package Manager](https://bun.sh/)**
---------------------------------
GitZipQR turns any folder into a **reproducible ZIP**, encrypts it with **AES-256-GCM** (key derived via **scrypt**), splits the ciphertext into **QR-sized chunks**, and embeds each chunk **directly inside QR images** (base64 inline payloads). The toolkit is now written in **TypeScript** for stronger typing.
On restore, you can decode only the QR images — integrity is verified chunk-by-chunk and globally before decrypting.  
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

---

## 🔍 How It Works

1. **Zip** the input directory (timestamps zeroed for reproducibility).  
2. **Encrypt** the ZIP with AES-256-GCM.  
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

*Derive key via scrypt and decrypt with AES-GCM → original ZIP*
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
bun install   # or npm install
```

### Docker

В репозитории присутствует `Dockerfile`, позволяющий запускать GitZipQR без установки Node.js или Bun.

1. **Соберите образ**

   ```bash
   docker build -t gitzipqr .
   ```

2. **Кодирование каталога**

   Для ввода пароля требуется интерактивный терминал (`-it`). Каталоги с исходными данными и результатом монтируются во внутренние пути контейнера.

   ```bash
   docker run --rm -it \
     -v $(pwd)/example:/data/example \
     -v $(pwd)/crypto:/data/crypto \
     gitzipqr npm run encode -- /data/example /data/crypto
   ```

3. **Декодирование из QR**

   ```bash
   docker run --rm -it \
     -v $(pwd)/crypto:/data/crypto \
     -v $(pwd)/restore:/data/restore \
     gitzipqr npm run decode -- /data/crypto/qrcodes /data/restore
   ```

4. **Генерация произвольного QR с водяным знаком**

   ```bash
   docker run --rm -v $(pwd):/data gitzipqr npm run custom-qr -- "some text" /data/qrcode
   ```

5. **Передача переменных окружения**

   Для настройки производительности можно передавать переменные окружения с помощью `-e`.

   ```bash
   docker run --rm -e QR_WORKERS=8 -v $(pwd):/data gitzipqr npm run encode -- /data/example /data/crypto
   ```

Эти команды позволяют использовать GitZipQR в контейнере на любой платформе без установки зависимостей.

# Example Encode
```bash
# 1) Prepare a sample folder
mkdir -p example
echo "Hello World" > example/index.txt

# 2) Encode → produces only QR PNGs (inline mode)
bun run encode ./example ./crypto
# or: npm run encode -- ./example ./crypto

# 3) Inspect outputs
ls -1 ./crypto/qrcodes | head -n 5
```

Generate the additional watermark QR independently:

```bash
npm run custom-qr -- "some text" ./qrcode
```

Example Decode
```bash
# 4) Decode from QR images → restored ZIP in ./restore
mkdir -p restore
bun run decode ./crypto/qrcodes ./restore
# or: npm run decode -- ./crypto/qrcodes ./restore

# 5) Verify ZIP content
unzip -l ./restore/example.zip

# 6) Extract and compare with original
mkdir -p ./restore/_example
unzip -q ./restore/example.zip -d ./restore/_example
diff -ruN ./example ./restore/_example && echo "OK: restored matches original ✅"
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
