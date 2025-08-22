require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const qrcode = require('qrcode');
const { writeManifest } = require('./manifest');

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("Provide a directory to encode. Usage: node core/encode.js <input_dir> [output_dir]");
  process.exit(1);
}
const outputBaseDir = process.argv[3] || process.cwd();
const qrDir = path.join(outputBaseDir, 'qrcodes');
const fragmentsDir = path.join(outputBaseDir, 'fragments');
[qrDir, fragmentsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const PASSPHRASE = process.env.PASSPHRASE;
if (!PASSPHRASE || PASSPHRASE.length < 8) {
  console.error("Set PASSPHRASE in .env (>= 8 chars). Example: PASSPHRASE=your-strong-passphrase");
  process.exit(1);
}

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '65536', 10); // 64 KiB default
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32 };
const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

(async () => {
  // 1) Zip input directory into tmp (reproducible timestamps)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitzipqr-'));
  const archiveName = path.basename(path.resolve(inputDir)) + ".zip";
  const zipPath = path.join(tmpRoot, archiveName);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const ar = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    ar.on('warning', reject);
    ar.on('error', reject);
    ar.pipe(out);
    ar.directory(inputDir, false, (entry) => {
      entry.stats = entry.stats || {};
      entry.stats.mtime = new Date(0);
      entry.stats.atime = new Date(0);
      entry.stats.ctime = new Date(0);
      return entry;
    });
    ar.finalize();
  });

  // 2) Encrypt ZIP: AES-256-GCM, key via scrypt
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.scryptSync(PASSPHRASE, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  const encPath = path.join(tmpRoot, archiveName + '.enc');
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(zipPath);
    const output = fs.createWriteStream(encPath);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(cipher).pipe(output);
  });
  const tag = cipher.getAuthTag();
  fs.appendFileSync(encPath, tag);

  const cipherSha256 = await sha256File(encPath);

  // 3) Chunk ciphertext
  const st = fs.statSync(encPath);
  const totalChunks = Math.ceil(st.size / CHUNK_SIZE);
  const fileId = crypto.createHash('sha256').update(archiveName + ':' + cipherSha256).digest('hex').slice(0, 16);

  const fd = fs.openSync(encPath, 'r');
  const qrJobs = [];
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, st.size);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);

      const chunkHash = crypto.createHash('sha256').update(buf).digest('hex');
      const payload = {
        type: FRAGMENT_TYPE,
        version: "1.1",
        fileId,
        name: archiveName,
        chunk: i,
        total: totalChunks,
        hash: chunkHash,
        cipherHash: cipherSha256,
        data: buf.toString('base64')
      };
      const base = `qr-${String(i).padStart(6, '0')}`;
      const jsonPath = path.join(fragmentsDir, `${base}.bin.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

      // QR = только индекс/мета
      const qrMeta = { v: 1, id: fileId, seq: i, total: totalChunks, json: path.relative(outputBaseDir, jsonPath) };
      const qrPath = path.join(qrDir, `${base}.png`);
      qrJobs.push(toQR(qrPath, JSON.stringify(qrMeta)));

      if ((i + 1) % 50 === 0 || i + 1 === totalChunks) {
        process.stdout.write(`Chunks: ${i + 1}/${totalChunks}\r`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  await Promise.all(qrJobs);

  // 4) Manifest
  writeManifest(outputBaseDir, {
    sourceName: archiveName,
    kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    saltB64: salt.toString('base64'),
    nonceB64: nonce.toString('base64'),
    chunkSize: CHUNK_SIZE,
    totalChunks,
    cipherSha256
  });

  console.log(`\nDone.
ZIP:        ${zipPath}
ENC:        ${encPath}  (sha256=${cipherSha256})
Manifest:   ${path.join(outputBaseDir, 'manifest.json')}
Fragments:  ${fragmentsDir}
QRCodes:    ${qrDir}
FileID:     ${fileId}
`);
})().catch(e => {
  console.error("Encode error:", e);
  process.exit(1);
});

async function toQR(outPath, text) {
  return new Promise((resolve, reject) => {
    qrcode.toFile(outPath, text, { errorCorrectionLevel: 'H', margin: 1 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
    s.on('data', d => h.update(d));
  });
}
