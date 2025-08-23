/**
 * GitZipQR — Encoder
 * Zip -> Encrypt (AES-256-GCM, scrypt) -> Chunk -> QR images.
 * 
 * Modes:
 *  - External (default): QR stores a pointer to fragments/*.bin.json
 *  - QR-ONLY (--inline): QR stores the chunk data itself (base64)
 *
 * Usage:
 *   bun run encode <input_dir> [output_dir] [--inline]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const qrcode = require('qrcode');
const { writeManifest } = require('./manifest');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32 };
const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

/* ---------------- Password (hidden) ---------------- */
function promptHidden(question, { confirm = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    const readOnce = (q) => new Promise((res, rej) => {
      process.stdout.write(q);
      const stdin = process.stdin;
      let buf = '';
      const onData = (d) => {
        const s = d.toString('utf8');
        if (s === '\u0003') { cleanup(); process.stdout.write('\n'); rej(new Error('Operation cancelled')); return; } // Ctrl+C
        if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); res(buf); return; } // Enter
        if (s === '\u0008' || s === '\u007f') { buf = buf.slice(0, -1); return; } // Backspace
        buf += s;
      };
      const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); };
      stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
    });
    (async () => {
      const p1 = await readOnce('Enter encryption password: ');
      if (!confirm) return p1;
      const p2 = await readOnce('Repeat password: ');
      if (p1 !== p2) throw new Error('Passwords do not match');
      return p1;
    })().then(resolve, reject);
  });
}

/* ---------------- Utils ---------------- */
async function toQR(outPath, text) {
  return new Promise((resolve, reject) => {
    qrcode.toFile(outPath, text, { errorCorrectionLevel: 'H', margin: 1 }, (err) => err ? reject(err) : resolve());
  });
}
async function tryQR(outPath, payloadObj) {
  try {
    await toQR(outPath, JSON.stringify(payloadObj));
    return true;
  } catch (e) {
    if (String(e && e.message || '').includes('too big to be stored in a QR Code')) return false;
    throw e;
  }
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

/* ---------------- Args & Dirs ---------------- */
const argv = process.argv.slice(2);
const inputDir = argv[0];
const outputBaseDir = argv[1] && !argv[1].startsWith('-') ? argv[1] : process.cwd();
// Force QR-ONLY mode regardless of flags; keep flag/env for compatibility
const INLINE = true;

if (!inputDir) {
  console.error("Usage: bun run encode <input_dir> [output_dir] [--inline]");
  process.exit(1);
}
const qrDir = path.join(outputBaseDir, 'qrcodes');
if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

/** For QR-ONLY we must keep chunks small so JSON+base64 fits into a single QR with H correction. */
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1800', 10);

(async () => {
  /* 0) Password */
  let PASSPHRASE;
  try { PASSPHRASE = await promptHidden('', { confirm: true }); } // prompt text is in promptHidden
  catch (e) { console.error(e.message || e); process.exit(1); }
  if (!PASSPHRASE || PASSPHRASE.length < 8) { console.error('Password must be at least 8 characters long.'); process.exit(1); }

  /* 1) ZIP input directory (stable timestamps for reproducible output) */
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

  /* 2) Encrypt ZIP (AES-256-GCM; key = scrypt(pass, salt)) */
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.scryptSync(PASSPHRASE, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  const encPath = path.join(tmpRoot, archiveName + '.enc');
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(zipPath);
    const output = fs.createWriteStream(encPath);
    input.on('error', reject); output.on('error', reject); output.on('finish', resolve);
    input.pipe(cipher).pipe(output);
  });
  const tag = cipher.getAuthTag();
  fs.appendFileSync(encPath, tag);

  const cipherSha256 = await sha256File(encPath);

  /* 3) Chunk + QR generation */
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
      const base = `qr-${String(i).padStart(6, '0')}`;
      const b64 = buf.toString('base64');

      // First try: single QR for the whole chunk.
      const singlePayload = {
        type: FRAGMENT_TYPE,
        version: "3.0-inline-only",
        fileId, name: archiveName, chunk: i, total: totalChunks,
        hash: chunkHash, cipherHash: cipherSha256,
        dataB64: b64,
        kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
        saltB64: salt.toString('base64'),
        nonceB64: nonce.toString('base64'),
        chunkSize: CHUNK_SIZE
      };
      const singlePath = path.join(qrDir, `${base}.png`);
      const ok = await tryQR(singlePath, singlePayload);

      if (!ok) {
        // Too big for a single QR → split into multiple QR parts.
        // Start with a conservative part size and grow parts count until it fits.
        let parts = 2;
        while (true) {
          const sliceLen = Math.ceil(b64.length / parts);
          // generate all parts and test the LAST one (worst-case size equality, still validates capacity)
          let allOk = true;
          const jobs = [];
          for (let p = 0; p < parts; p++) {
            const slice = b64.slice(p * sliceLen, (p + 1) * sliceLen);
            const partPayload = {
              type: FRAGMENT_TYPE,
              version: "3.0-inline-only",
              fileId, name: archiveName, chunk: i, total: totalChunks,
              hash: chunkHash, cipherHash: cipherSha256,
              dataB64: slice,
              kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
              saltB64: salt.toString('base64'),
              nonceB64: nonce.toString('base64'),
              chunkSize: CHUNK_SIZE,
              part: p,
              partTotal: parts
            };
            const partPath = path.join(qrDir, `${base}-p${String(p).padStart(3,'0')}.png`);
            const job = tryQR(partPath, partPayload).then(ok => { if (!ok) allOk = false; });
            jobs.push(job);
          }
          await Promise.all(jobs);
          if (allOk) break;
          parts = Math.min(parts * 2, parts + 1);
          if (parts > 4096) throw new Error('Chunk cannot be split into QR parts small enough (exceeds limit)');
        }
      }

      if ((i + 1) % 50 === 0 || i + 1 === totalChunks) process.stdout.write(`Chunks: ${i + 1}/${totalChunks}\r`);
    }
  } finally { fs.closeSync(fd); }

  await Promise.all(qrJobs);

  /* 4) Manifest (optional; kept for compatibility, but not required by decoder) */
  try {
    writeManifest(outputBaseDir, {
      sourceName: archiveName,
      kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      saltB64: salt.toString('base64'),
      nonceB64: nonce.toString('base64'),
      chunkSize: CHUNK_SIZE,
      totalChunks,
      cipherSha256,
      mode: 'inline'
    });
  } catch {}

  console.log(`\nDone.
Manifest:   ${path.join(outputBaseDir, 'manifest.json')} (optional)
QRCodes:    ${qrDir}
Mode:       QR-ONLY (inline)
FileID:     ${fileId}
`);
})().catch(e => { console.error("Encode error:", e); process.exit(1); });
