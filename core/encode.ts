/**
 * GitZipQR — Encoder
 * Zip -> Encrypt (AES-256-GCM, scrypt) -> Chunk -> QR images.
 * 
 * Modes:
 *  - QR-ONLY (inline): QR stores the chunk data itself (base64)
 *
 * Usage:
 *   bun run encode <input_dir> [output_dir]
 *
 * Performance features:
 *  - Capacity auto-calibration (fits 1 chunk per QR whenever possible)
 *  - Multi-core QR generation via worker pool
 *  - Native fast-path with 'qrencode' if available
 *  - Step-wise progress: "STEP #N [1/0]"
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { Worker } = require('worker_threads');
const { spawnSync } = require('child_process');
const qrcode = require('qrcode'); // used for one-time capacity calibration
const readline = require('readline');

const SCRYPT = {
  N: parseInt(process.env.SCRYPT_N || (1 << 15), 10),
  r: parseInt(process.env.SCRYPT_r || 8, 10),
  // Use all CPU cores by default for better scrypt performance
  p: parseInt(process.env.SCRYPT_p || String(os.cpus().length), 10),
  keyLen: 32
};
const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";
const ECL = (process.env.QR_ECL || 'Q').toUpperCase();      // Q by default (faster, bigger capacity)
const MARGIN = parseInt(process.env.QR_MARGIN || '1', 10);
const MAX_WORKERS = Math.max(1, parseInt(process.env.QR_WORKERS || String(os.cpus().length), 10));

/* ---------------- Password (hidden) ---------------- */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    process.stdout.write(question);
    const stdin = process.stdin;
    let buf = '';
    const onData = (d) => {
      const s = d.toString('utf8');
      if (s === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Operation cancelled')); return; }
      if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); resolve(buf); return; }
      if (s === '\u0008' || s === '\u007f') { buf = buf.slice(0, -1); return; }
      buf += s;
    };
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); };
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}

async function promptPasswordCount(def = 2) {
  if (!process.stdin.isTTY) throw new Error('No interactive TTY is available for password input');
  return await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('AMOUNT NUMBER OF PASSWORD: ', (ans) => {
      rl.close();
      const n = parseInt(ans, 10);
      resolve(Number.isFinite(n) && n > 0 ? n : def);
    });
  });
}

async function promptPasswords(defaultCount = 2) {
  const count = await promptPasswordCount(defaultCount);
  const parts = [];
  for (let i = 1; i <= count; i++) {
    const p = await promptHidden(`Password #${i}: `);
    if (!p || p.length < 8) throw new Error('Password must be at least 8 characters long.');
    parts.push(p);
  }
  return parts.join('\u0000');
}

/* ---------------- Utils ---------------- */
function stepStart(n, label) {
  process.stdout.write(`STEP #${n} ${label} ... `);
}
function stepDone(ok) {
  process.stdout.write(`[${ok ? 1 : 0}]\n`);
}
async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
    s.on('data', d => h.update(d));
  });
}
function hasQrencode() {
  const r = spawnSync('qrencode', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}
function runWorker(task) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, 'qr.worker.ts'), { workerData: task });
    w.once('message', (msg) => resolve(msg));
    w.once('error', (err) => resolve({ ok: false, error: String(err && err.message || err) }));
  });
}
async function runPool(tasks) {
  let i = 0, active = 0, ok = 0, fail = 0;
  return new Promise((resolve) => {
    const total = tasks.length;
    function launch() {
      while (active < MAX_WORKERS && i < total) {
        const t = tasks[i++];
        active++;
        runWorker(t).then((res) => {
          active--;
          if (res && res.ok) ok++; else fail++;
          if ((ok + fail) % 50 === 0 || (ok + fail) === total) {
            process.stdout.write(`QR ${ok + fail}/${total} completed\r`);
          }
          if (i < total) launch();
          else if (active === 0) {
            process.stdout.write('\n');
            resolve({ ok, fail });
          }
        });
      }
    }
    launch();
  });
}

/**
 * Calibrate maximum safe size for `dataB64` inside our JSON payload (for given ECL).
 * Uses qrcode.toString() once with binary search. Returns a conservative size.
 */
async function calibrateMaxDataB64(basePayloadWithoutData) {
  const test = async (n) => {
    const payload = { ...basePayloadWithoutData, dataB64: 'A'.repeat(n) };
    const text = JSON.stringify(payload);
    try {
      await qrcode.toString(text, { errorCorrectionLevel: ECL, margin: MARGIN });
      return true;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (msg.includes('too big to be stored in a QR Code') ||
          msg.includes('Array length must be a positive integer') ||
          msg.includes('Invalid typed array length')) return false;
      throw e;
    }
  };
  let lo = 1, hi = 2048;
  while (await test(hi)) { lo = hi; hi *= 2; if (hi > 1 << 22) break; } // grow quickly, up to ~4MB
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await test(mid)) lo = mid; else hi = mid - 1;
  }
  // safety margin (JSON overhead can vary minimally per chunk)
  return Math.floor(lo * 0.92);
}

/* ---------------- Main API ---------------- */
async function encode(inputPath, outputBaseDir = process.cwd(), passwords) {
  const qrDir = path.join(outputBaseDir, 'qrcodes');
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

  // STEP 1: password
  stepStart(1, 'password');
  let PASSPHRASE;
  try {
    PASSPHRASE = Array.isArray(passwords) && passwords.length
      ? passwords.join('\u0000')
      : await promptPasswords();
  } catch (e) {
    stepDone(0); throw e;
  }
  stepDone(1);

  // STEP 2: prepare data (zip dir or copy file)
  stepStart(2, 'prepare data');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitzipqr-'));
  const absInput = path.resolve(inputPath);
  const stInput = fs.statSync(absInput);
  let archiveName = path.basename(absInput);
  if (stInput.isDirectory()) {
    archiveName += '.zip';
  }
  const archiveExt = path.extname(archiveName);
  let dataPath;
  if (stInput.isDirectory()) {
    dataPath = path.join(tmpRoot, archiveName);
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dataPath);
        const ar = archiver('zip', { zlib: { level: 9 } });
        out.on('close', resolve);
        ar.on('warning', reject);
        ar.on('error', reject);
        ar.pipe(out);
        ar.directory(absInput, false, (entry) => {
          entry.stats = entry.stats || {};
          entry.stats.mtime = new Date(0);
          entry.stats.atime = new Date(0);
          entry.stats.ctime = new Date(0);
          return entry;
        });
        ar.finalize();
      });
      stepDone(1);
    } catch (e) {
      stepDone(0); throw new Error('Zip failed: ' + (e.message || e));
    }
  } else {
    dataPath = path.join(tmpRoot, archiveName);
    fs.copyFileSync(absInput, dataPath);
    stepDone(1);
  }

  // STEP 3: encrypt (AES-256-GCM; key = scrypt(pass, salt))
  stepStart(3, 'encrypt');
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  let encPath;
  try {
    const key = crypto.scryptSync(PASSPHRASE, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512*1024*1024 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    encPath = path.join(tmpRoot, archiveName + '.enc');
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(dataPath);
      const output = fs.createWriteStream(encPath);
      input.on('error', reject); output.on('error', reject); output.on('finish', resolve);
      input.pipe(cipher).pipe(output);
    });
    const tag = cipher.getAuthTag();
    fs.appendFileSync(encPath, tag);
    stepDone(1);
  } catch (e) {
    stepDone(0); throw new Error('Encrypt failed: ' + (e.message || e));
  }

  // STEP 4: calibrate capacity
  stepStart(4, 'calibrate QR capacity');
  const cipherSha256 = await sha256File(encPath);
  const baseMeta = {
    type: FRAGMENT_TYPE,
    version: "3.1-inline-only",
    fileId: crypto.createHash('sha256').update(archiveName + ':' + cipherSha256).digest('hex').slice(0, 16),
    name: archiveName,
    ext: archiveExt,
    chunk: 0, total: 1,
    hash: ''.padStart(64, '0'),
    cipherHash: cipherSha256,
    kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    saltB64: salt.toString('base64'),
    nonceB64: nonce.toString('base64'),
    chunkSize: 0
  };
  let maxDataB64;
  try {
    maxDataB64 = await calibrateMaxDataB64(baseMeta);
    stepDone(1);
  } catch (e) {
    stepDone(0); throw new Error('Calibration failed: ' + (e.message || e));
  }

  // Choose optimal chunk size to fit 1 chunk per QR (≈ 3/4 of base64, minus tiny safety)
  const idealChunk = Math.max(512, Math.floor(maxDataB64 * 3 / 4 * 0.98));
  const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || String(idealChunk), 10);

  // STEP 5: chunk + queue QR jobs
  stepStart(5, `chunk & queue jobs (chunk_size=${CHUNK_SIZE}, ECL=${ECL}, workers=${MAX_WORKERS}${hasQrencode() ? ', native=qrencode' : ''})`);
  const st = fs.statSync(encPath);
  const totalChunks = Math.ceil(st.size / CHUNK_SIZE);
  const fileId = baseMeta.fileId;
  const fd = fs.openSync(encPath, 'r');
  const tasks = [];
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, st.size);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const chunkHash = crypto.createHash('sha256').update(buf).digest('hex');
      const b64 = buf.toString('base64');

      const payload = {
        type: FRAGMENT_TYPE,
        version: "3.1-inline-only",
        fileId,
        name: archiveName,
        ext: archiveExt,
        chunk: i,
        total: totalChunks,
        hash: chunkHash,
        cipherHash: cipherSha256,
        dataB64: b64,
        kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
        saltB64: salt.toString('base64'),
        nonceB64: nonce.toString('base64'),
        chunkSize: CHUNK_SIZE
      };
      const outPath = path.join(qrDir, `qr-${String(i).padStart(6,'0')}.png`);
      tasks.push({
        outPath,
        text: JSON.stringify(payload),
        useQrencode: hasQrencode(),
        ecl: ECL,
        margin: MARGIN
      });
    }
    stepDone(1);
  } catch (e) {
    stepDone(0); throw new Error('Chunking failed: ' + (e.message || e));
  } finally {
    fs.closeSync(fd);
  }

  // STEP 6: encode QR in parallel
  stepStart(6, 'encode QR in parallel');
  const { ok, fail } = await runPool(tasks);
  stepDone(fail === 0);
  if (fail) throw new Error(`Some QR tasks failed: ${fail}`);

  // STEP 7: summary
  console.log('\nDone.');
  console.log(`QRCodes:    ${qrDir}`);
  console.log(`Mode:       QR-ONLY (inline), ECL=${ECL}, workers=${MAX_WORKERS}${hasQrencode() ? ', native=qrencode' : ''}`);
  console.log(`FileID:     ${fileId}`);
  console.log(`Chunks:     ${totalChunks}`);

  return { qrDir, fileId, totalChunks, archiveName };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const input = argv[0];
  const outDir = argv[1] && !argv[1].startsWith('-') ? argv[1] : process.cwd();
  if (!input) {
    console.error('Usage: bun run encode <input_file_or_dir> [output_dir]');
    process.exit(1);
  }
  encode(input, outDir).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { encode };
