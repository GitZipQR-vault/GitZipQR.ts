/**
 * GitZipQR — Encoder
 * Zip -> Encrypt (AES-256-GCM, scrypt) -> Chunk -> QR images.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { Worker } = require('worker_threads');
const { spawnSync } = require('child_process');
const readline = require('readline');

function scryptAsync(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, derivedKey) => {
      if (err) reject(err); else resolve(derivedKey);
    });
  });
}

const SCRYPT = {
  N: parseInt(process.env.SCRYPT_N || (1 << 15), 10),
  r: parseInt(process.env.SCRYPT_r || 8, 10),
  p: parseInt(process.env.SCRYPT_p || String(os.cpus().length), 10),
  keyLen: 32
};
const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";
const ECL = (process.env.QR_ECL || 'Q').toUpperCase();
const MARGIN = parseInt(process.env.QR_MARGIN || '1', 10);
const MAX_WORKERS = Math.max(1, parseInt(process.env.QR_WORKERS || String(os.cpus().length), 10));

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    process.stdout.write(question);
    const stdin = process.stdin; let buf = '';
    const onData = (d) => {
      const s = d.toString('utf8');
      if (s === '\u0003') { cleanup(); process.stdout.write('\n'); return reject(new Error('Operation cancelled')); }
      if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); return resolve(buf); }
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
      rl.close(); const n = parseInt(ans, 10);
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
function stepStart(n, label) { process.stdout.write(`STEP #${n} ${label} ... `); }
function stepDone(ok) { process.stdout.write(`[${ok ? 1 : 0}]\n`); }

async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
    s.on('data', d => h.update(d));
  });
}
function hasQrencode() { return spawnSync('qrencode', ['--version'], { stdio: 'ignore' }).status === 0; }
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
        const t = tasks[i++]; active++;
        runWorker(t).then((res) => {
          active--; if (res && res.ok) ok++; else fail++;
          if ((ok + fail) % 50 === 0 || ok + fail === total) process.stdout.write(`QR ${ok + fail}/${total} completed\r`);
          if (i < total) launch(); else if (active === 0) { process.stdout.write('\n'); resolve({ ok, fail }); }
        });
      }
    } launch();
  });
}

/* ---- File type helpers ---- */
function detectExtByMagic(buf) {
  if (!buf || buf.length < 4) return '';
  if (buf.slice(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (buf.slice(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return '.jpg';
  if (buf.slice(0, 4).equals(Buffer.from('47494638', 'hex'))) return '.gif';
  if (buf.slice(0, 4).equals(Buffer.from('25504446', 'hex'))) return '.pdf';
  if (buf.slice(0, 4).equals(Buffer.from('504b0304', 'hex'))) return '.zip';
  return '';
}
function readHead(filePath, n = 16) {
  const fd = fs.openSync(filePath, 'r'); const b = Buffer.alloc(n);
  fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b;
}

/* ---------------- Main API ---------------- */
async function encode(inputPath, outputDir = path.join(process.cwd(), 'qrcodes'), passwords) {
  const qrDir = outputDir;
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

  // STEP 1: password
  stepStart(1, 'password');
  let PASSPHRASE;
  try { PASSPHRASE = Array.isArray(passwords) && passwords.length ? passwords.join('\u0000') : await promptPasswords(); }
  catch (e) { stepDone(0); throw e; }
  stepDone(1);

  // STEP 2: prepare data
  stepStart(2, 'prepare data');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitzipqr-'));
  const absInput = path.resolve(inputPath);
  const stInput = fs.statSync(absInput);

  const originalBase = path.basename(absInput);                // original file name
  const originalExt = stInput.isDirectory() ? '' : path.extname(originalBase);
  const nameBase = stInput.isDirectory()
    ? originalBase                         // folder name (without .zip)
    : (originalExt ? path.basename(originalBase, originalExt) : originalBase);

  // Determine final extension for metadata
  let metaExt = stInput.isDirectory() ? '.zip' : (originalExt || '');
  let dataPath;
  if (stInput.isDirectory()) {
    // Write ZIP to disk (nameBase + .zip), but in metadata: name=nameBase, ext=.zip
    const archiveNameOnDisk = nameBase + '.zip';
    dataPath = path.join(tmpRoot, archiveNameOnDisk);
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dataPath);
        const ar = archiver('zip', { zlib: { level: 9 } });
        out.on('close', resolve); ar.on('warning', reject); ar.on('error', reject);
        ar.pipe(out);
        ar.directory(absInput, false, (entry) => {
          entry.stats = entry.stats || {};
          entry.stats.mtime = new Date(0); entry.stats.atime = new Date(0); entry.stats.ctime = new Date(0); return entry;
        });
        ar.finalize();
      });
      stepDone(1);
    } catch (e) { stepDone(0); throw new Error('Zip failed: ' + (e.message || e)); }
  } else {
    // Single file: copy as is
    const fileOnDisk = originalBase;                   // unchanged
    dataPath = path.join(tmpRoot, fileOnDisk);
    fs.copyFileSync(absInput, dataPath);
    // If the source file had no extension, try to detect by signature
    if (!metaExt) {
      try { const head = readHead(dataPath, 16); const detected = detectExtByMagic(head); if (detected) metaExt = detected; } catch { }
    }
    stepDone(1);
  }

  // STEP 3: encrypt
  stepStart(3, 'encrypt');
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  let encPath;
  try {
    const key = await scryptAsync(PASSPHRASE, salt, 32, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512 * 1024 * 1024 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    encPath = path.join(tmpRoot, 'payload.enc');
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(dataPath);
      const output = fs.createWriteStream(encPath);
      input.on('error', reject); output.on('error', reject); output.on('finish', resolve);
      input.pipe(cipher).pipe(output);
    });
    const tag = cipher.getAuthTag(); fs.appendFileSync(encPath, tag);
    stepDone(1);
  } catch (e) { stepDone(0); throw new Error('Encrypt failed: ' + (e.message || e)); }

  // STEP 4: calibrate capacity
  stepStart(4, 'calibrate QR capacity');
  const cipherSha256 = await sha256File(encPath);
  const baseMeta = {
    type: FRAGMENT_TYPE,
    version: "3.1-inline-only",
    fileId: crypto.createHash('sha256').update(nameBase + ':' + cipherSha256).digest('hex').slice(0, 16),
    name: nameBase,            // always without extension
    ext: metaExt || '',        // always original extension (or .zip for directories)
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
    const CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 }; // bytes for QR version 40
    const maxBytes = CAPACITY[ECL] || CAPACITY.Q;
    const overhead = Buffer.byteLength(JSON.stringify({ ...baseMeta, dataB64: '' }), 'utf8');
    maxDataB64 = maxBytes - overhead;
    if (maxDataB64 <= 0) throw new Error('metadata too large for chosen error correction level');
    stepDone(1);
  } catch (e) {
    stepDone(0);
    throw new Error('Calibration failed: ' + (e.message || e));
  }

  const idealChunk = Math.max(512, Math.floor(maxDataB64 * 3 / 4 * 0.98));
  const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || String(idealChunk), 10);
  baseMeta.chunkSize = CHUNK_SIZE;

  // STEP 5: chunk & queue
  stepStart(5, `chunk & queue jobs (chunk_size=${CHUNK_SIZE}, ECL=${ECL}, workers=${MAX_WORKERS}${hasQrencode() ? ', native=qrencode' : ''})`);
  const st = fs.statSync(encPath);
  const totalChunks = Math.ceil(st.size / CHUNK_SIZE);
  const fileId = baseMeta.fileId;
  const fd = fs.openSync(encPath, 'r');
  const tasks = [];
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE, end = Math.min(start + CHUNK_SIZE, st.size);
      const buf = Buffer.alloc(end - start); fs.readSync(fd, buf, 0, buf.length, start);
      const chunkHash = crypto.createHash('sha256').update(buf).digest('hex');
      const payload = {
        ...baseMeta,
        chunk: i,
        total: totalChunks,
        hash: chunkHash,
        dataB64: buf.toString('base64')
      };
      const outPath = path.join(qrDir, `qr-${String(i).padStart(6, '0')}.png`);
      tasks.push({ outPath, text: JSON.stringify(payload), useQrencode: hasQrencode(), ecl: ECL, margin: MARGIN });
    }
    stepDone(1);
  } catch (e) { stepDone(0); throw new Error('Chunking failed: ' + (e.message || e)); }
  finally { fs.closeSync(fd); }

  // STEP 6: encode QR in parallel
  stepStart(6, 'encode QR in parallel');
  const { ok, fail } = await runPool(tasks);
  stepDone(fail === 0);
  if (fail) throw new Error(`Some QR tasks failed: ${fail}`);
  console.log("Support me please USDT money - 0xa8b3A40008EDF9AF21D981Dc3A52aa0ed1cA88fD")

  // STEP 7: summary
  console.log('\nDone.');
  console.log(`QRCodes:    ${qrDir}`);
  console.log(`Mode:       QR-ONLY (inline), ECL=${ECL}, workers=${MAX_WORKERS}${hasQrencode() ? ', native=qrencode' : ''}`);
  console.log(`FileID:     ${fileId}`);
  console.log(`Chunks:     ${totalChunks}`);
  console.log("Support me please USDT money - 0xa8b3A40008EDF9AF21D981Dc3A52aa0ed1cA88fD")

  return { qrDir, fileId, totalChunks, nameBase, metaExt };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const input = argv[0];
  const outDir = argv[1] && !argv[1].startsWith('-') ? argv[1] : undefined;
  if (!input) { console.error('Usage: bun run encode <input_file_or_dir> [output_dir]'); process.exit(1); }
  encode(input, outDir).catch((e) => { console.error(e.message || e); process.exit(1); });
}
module.exports = { encode };
