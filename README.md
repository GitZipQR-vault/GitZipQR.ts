# GitZipQR — Secure Archives via Inline QR Codes (C++)

GitZipQR now uses a small C++ codebase for its critical encryption and decryption
paths.  The Node/Bun tooling has been replaced with simple binaries built via
`make` for faster execution and easier deployment.

## Build

```bash
make
```
This produces `bin/encode` and `bin/decode`.

## Usage

### Encrypt
```bash
bin/encode <input_path> <output_file>
```
If `<input_path>` is a directory, it is zipped before encryption.
The program prompts for a passphrase, derives a key using scrypt and encrypts
the input with AES‑256‑GCM.  The output file contains salt, nonce, ciphertext
and authentication tag.

### Decrypt
```bash
bin/decode <input_file> <output_file>
```
After entering the same passphrase, the original file is restored.

## License

MIT
