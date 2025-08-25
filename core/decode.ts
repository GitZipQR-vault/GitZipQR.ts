/**
 * GitZipQR — Decoder
 * Restores an encrypted ZIP from:
 *  - a folder of QR images (PNG/JPG/JPEG), or
 *  - a folder of JSON fragments (*.bin.json), or a single fragment file. (legacy)
 *
 * Supports QR-ONLY (inline) mode primarily. Legacy external fragments are still accepted.
 *
 * Usage:
 *   bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]
 *
 * Performance features:
 *  - Parallel QR image decoding via worker pool
 *  - Step-wise progress: "STEP #N [1/0]"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const readline = require('readline');

const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";
const MAX_WORKERS = Math.max(1, parseInt(process.env.QR_WORKERS || String(os.cpus().length), 10));

function stepStart(n, label) { process.stdout.write(`STEP #${n} ${label} ... `); }
function stepDone(ok) { process.stdout.write(`[${ok ? 1 : 0}]\n`); }

/* ---------------- Password (hidden) ---------------- */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    process.stdout.write(question);
    const stdin = process.stdin; let buf = '';
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

function isImageFile(name){ return /\.(png|jpg|jpeg)$/i.test(name); }
function listFragmentsFlexible(p) {
  const st = fs.existsSync(p) ? fs.statSync(p) : null;
  if (st && st.isFile()) return [path.resolve(p)];
  const res = [];
  const tryDir = d => {
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
      for (const f of fs.readdirSync(d)) if (f.endsWith('.bin.json')) res.push(path.join(d,f));
    }
  };
  const root = path.resolve(p); tryDir(root); if (res.length===0) tryDir(path.join(root,'fragments'));
  res.sort((a,b)=>{const ai=parseInt((path.basename(a).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10);
                  const bi=parseInt((path.basename(b).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10); return ai-bi;});
  return res;
}

function guessExtension(buf) {
  if (!buf || buf.length < 4) return '';
  const b = buf;
  if (b.slice(0,8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (b.slice(0,3).equals(Buffer.from('ffd8ff', 'hex'))) return '.jpg';
  if (b.slice(0,4).equals(Buffer.from('47494638', 'hex'))) return '.gif';
  if (b.slice(0,4).equals(Buffer.from('25504446', 'hex'))) return '.pdf';
  if (b.slice(0,4).equals(Buffer.from('504b0304', 'hex'))) return '.zip';
  return '';
}

function runDecodePool(images) {
  let i = 0, active = 0;
  const results = new Array(images.length);
  return new Promise((resolve) => {
    function launch() {
      while (active < MAX_WORKERS && i < images.length) {
        const idx = i++;
        const img = images[idx];
        active++;
        const w = new Worker(path.join(__dirname, 'qrdecode.worker.ts'), { workerData: { img } });
        w.once('message', (msg) => {
          active--;
          results[idx] = msg;
          if ((idx + 1) % 100 === 0 || idx + 1 === images.length) {
            process.stdout.write(`QR read ${idx + 1}/${images.length}\r`);
          }
          if (i < images.length) launch();
          else if (active === 0) {
            process.stdout.write('\n');
            resolve(results);
          }
        });
        w.once('error', () => { active--; results[idx] = { ok:false, error:'worker error' }; if (i < images.length) launch(); else if (active===0) resolve(results); });
      }
    }
    launch();
  });
}

/* ---------------- Main API ---------------- */
async function decode(inputPath, outputDir = process.cwd(), passwords) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const input = path.resolve(inputPath);

  // STEP 1: collect inline QR payloads or fallback to legacy fragments
  stepStart(1, 'collect data');
  let chunks = [];
  let archiveName = null;
  let archiveExt = null;
  let cipherSha256 = null;
  let expectedTotal = null;
  let kdf = null, salt = null, nonce = null;

  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    const imgs = fs.readdirSync(input).filter(isImageFile).map(f=>path.join(input,f));
    if (imgs.length) {
      const results = await runDecodePool(imgs);
      const acc = new Map(); // key: `${fileId}:${chunk}` -> { parts: [b64], total }
      for (const r of results) {
        if (!r || !r.ok) continue;
        const m = r.payload;
        if (!(m && m.type === FRAGMENT_TYPE && typeof m.chunk === 'number' && typeof m.total === 'number')) continue;
        if (m.dataB64) {
          const key = `${m.fileId}:${m.chunk}`;
          if (!acc.has(key)) acc.set(key, { parts: [], total: m.partTotal || 1 });
          const entry = acc.get(key);
          const idx = (typeof m.part === 'number') ? m.part : 0;
          entry.parts[idx] = m.dataB64;
          entry.total = m.partTotal || 1;

          if (!archiveName) archiveName = m.name;
          if (!archiveExt && m.ext) archiveExt = m.ext;
          if (!cipherSha256) cipherSha256 = m.cipherHash;
          if (!kdf && m.kdfParams) kdf = m.kdfParams;
          if (!salt && m.saltB64) salt = Buffer.from(m.saltB64, 'base64');
          if (!nonce && m.nonceB64) nonce = Buffer.from(m.nonceB64, 'base64');
          if (!expectedTotal) expectedTotal = m.total;
        }
      }
      if (acc.size > 0) {
        for (const [key, entry] of acc.entries()) {
          const parts = entry.parts;
          for (let p = 0; p < (entry.total || 1); p++) {
            if (typeof parts[p] !== 'string') { stepDone(0); console.error(`Missing QR part ${p+1}/${entry.total} for ${key}`); process.exit(1); }
          }
          const joinedB64 = (entry.total && entry.total > 1) ? parts.join('') : parts[0];
          const buf = Buffer.from(joinedB64, 'base64');
          const chunkIndex = parseInt(key.split(':')[1], 10);
          chunks[chunkIndex] = buf;
        }
        stepDone(1);
      } else {
        stepDone(0);
        console.error("No inline QR data detected in images. Provide inline QR codes or legacy fragments.");
        process.exit(1);
      }
    } else {
      stepDone(0);
      console.error("Directory has no QR images.");
      process.exit(1);
    }
  } else {
    // legacy path: .bin.json fragments + manifest.json nearby
    const manifestPath = [path.join(path.dirname(input),'manifest.json'), path.join(input,'manifest.json'), path.join(process.cwd(),'manifest.json')].find(p=>fs.existsSync(p));
    if (!manifestPath) { stepDone(0); console.error("No manifest.json for legacy fragments."); process.exit(1); }
    const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    expectedTotal = manifest.totalChunks || manifest.total_chunks;
    cipherSha256  = manifest.cipherSha256 || manifest.cipher_sha256;
    kdf   = manifest.kdfParams || manifest.kdf_params;
    salt  = Buffer.from(manifest.saltB64  || manifest.salt_b64 , 'base64');
    nonce = Buffer.from(manifest.nonceB64 || manifest.nonce_b64, 'base64');
    let fragmentFiles = listFragmentsFlexible(input);
    if (!fragmentFiles.length) { stepDone(0); console.error("No *.bin.json fragments found."); process.exit(1); }
    for (const fp of fragmentFiles) {
      const frag = JSON.parse(fs.readFileSync(fp,'utf8'));
      if (frag.type !== FRAGMENT_TYPE) continue;
      if (!archiveName) archiveName = frag.name;
      if (!archiveExt && frag.ext) archiveExt = frag.ext;
      const buf = Buffer.from(frag.data,'base64');
      const h  = crypto.createHash('sha256').update(buf).digest('hex');
      if (h !== frag.hash) { stepDone(0); console.error(`Chunk hash mismatch: ${path.basename(fp)}`); process.exit(1); }
      chunks[frag.chunk] = buf;
    }
    stepDone(1);
  }

  // STEP 2: verify + assemble
  stepStart(2, 'verify & assemble');
  const present = chunks.filter(Boolean).length;
  if (expectedTotal && present !== expectedTotal) { stepDone(0); console.error(`Missing chunks: ${present}/${expectedTotal}`); process.exit(1); }
  const encBuffer = Buffer.concat(chunks);
  if (cipherSha256) {
    const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
    if (globalCheck !== cipherSha256) { stepDone(0); console.error(`Global sha256 mismatch. Expected ${cipherSha256}, got ${globalCheck}`); process.exit(1); }
  }
  stepDone(1);

  // STEP 3: decrypt AES-256-GCM
  stepStart(3, 'decrypt');
  if (!(kdf && salt && nonce)) { stepDone(0); console.error("Crypto parameters are missing in QR payloads. Re-encode inline."); process.exit(1); }
  let pass;
  try {
    pass = Array.isArray(passwords) && passwords.length ? passwords.join('\u0000') : await promptPasswords();
  } catch (e) {
    stepDone(0); throw e;
  }

  const key = crypto.scryptSync(pass, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512*1024*1024 });
  const tag        = encBuffer.subarray(encBuffer.length - 16);
  const ciphertext = encBuffer.subarray(0, encBuffer.length - 16);

  let dataBuf;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    dataBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    stepDone(1);
  } catch {
    stepDone(0); console.error("Decryption failed. Wrong password or corrupted data."); process.exit(1);
  }

  // STEP 4: write output
  stepStart(4, 'write output');
  let outName = archiveName || 'restored';
  if (!path.extname(outName) && archiveExt) {
    outName += archiveExt;
  }
  if (!path.extname(outName)) {
    const ext = guessExtension(dataBuf);
    outName += ext || '.bin';
  }
  const outPath = path.join(outputDir, outName);
  fs.writeFileSync(outPath, dataBuf);
  stepDone(1);

  const finalExt = path.extname(outName);
  if (finalExt === '.zip') console.log(`\n✅ Restored ZIP → ${outPath}`);
  else console.log(`\n✅ Restored file → ${outPath}`);

  return outPath;
}

if (require.main === module) {
  const inputArg = process.argv[2];
  const outputDir = (process.argv[3] && !process.argv[3].startsWith('-')) ? process.argv[3] : process.cwd();
  if (!inputArg) {
    console.error("Usage: bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]");
    process.exit(1);
  }
  decode(inputArg, outputDir).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { decode };
