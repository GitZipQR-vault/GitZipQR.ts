const fs = require('fs');
const path = require('path');

function writeManifest(targetDir, m) {
  const manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    source_name: m.sourceName,
    cipher: "AES-256-GCM",
    kdf: "scrypt",
    kdf_params: m.kdfParams,   // {N,r,p}
    salt_b64: m.saltB64,
    nonce_b64: m.nonceB64,
    chunk_size: m.chunkSize,
    total_chunks: m.totalChunks,
    cipher_sha256: m.cipherSha256,
    merkle_root: null,
    notes: "Do not store passphrase with fragments."
  };
  const p = path.join(targetDir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  return p;
}
module.exports = { writeManifest };
