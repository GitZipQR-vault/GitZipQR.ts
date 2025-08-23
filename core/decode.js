/**
 * GitZipQR — Decoder
 * Restores an encrypted ZIP from:
 *  - a folder of QR images (PNG/JPG/JPEG), or
 *  - a folder of JSON fragments (*.bin.json), or a single fragment file.
 *
 * Supports both QR-ONLY (inline) and external-fragment modes.
 *
 * Usage:
 *   bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

/* ---------------- Password (hidden) ---------------- */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive TTY is available for password input'));
    process.stdout.write(question);
    const stdin = process.stdin; let buf = '';
    const onData = (d) => {
      const s = d.toString('utf8');
      if (s === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Operation cancelled')); return; } // Ctrl+C
      if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); resolve(buf); return; } // Enter
      if (s === '\u0008' || s === '\u007f') { buf = buf.slice(0, -1); return; } // Backspace
      buf += s;
    };
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); };
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}

/* ---------------- Helpers ---------------- */
function findManifest(startPath) {
  const abs = path.resolve(startPath);
  const candidates = [
    path.join(abs, 'manifest.json'),
    path.join(path.dirname(abs), 'manifest.json'),
    path.join(process.cwd(), 'manifest.json'),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function isImageFile(name){ return /\.(png|jpg|jpeg)$/i.test(name); }
function readRGBAFromImage(filePath) {
  const buf = fs.readFileSync(filePath);
  if (/\.png$/i.test(filePath)) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  } else {
    const raw = jpeg.decode(buf, { useTArray: true });
    return { data: raw.data, width: raw.width, height: raw.height };
  }
}
function decodeQRImage(filePath) {
  const { data, width: W, height: H } = readRGBAFromImage(filePath);
  const u8 = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(u8, W, H);
  if (!result || !result.data) throw new Error("QR not detected");
  try { return JSON.parse(result.data); } catch { throw new Error("QR payload is not valid JSON"); }
}
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
function resolveFragmentPath(baseDir, rel){
  const c=[path.resolve(baseDir,rel), path.resolve(path.dirname(baseDir),rel), path.resolve(process.cwd(),rel)];
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

/* ---------------- Main ---------------- */
const inputArg = process.argv[2];
const outputDir = (process.argv[3] && !process.argv[3].startsWith('-')) ? process.argv[3] : process.cwd();
if (!inputArg) { console.error("Usage: bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]"); process.exit(1); }
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

(async function main(){
  const input = path.resolve(inputArg);

  // 1) Try inline-QR first (may be multi-part per chunk)
  let chunks = [];
  let archiveName = null;
  let cipherSha256 = null;
  let expectedTotal = null;
  let kdf = null, salt = null, nonce = null;

  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    const imgs = fs.readdirSync(input).filter(isImageFile).map(f=>path.join(input,f));
    if (imgs.length) {
      console.log("📷 Decoding QR images...");
      // accumulate parts per (fileId, chunk)
      const acc = new Map(); // key -> { parts: [], total, metaSet: bool }
      for (const img of imgs) {
        const m = decodeQRImage(img);
        if (!(m && m.type === FRAGMENT_TYPE && typeof m.chunk === 'number' && typeof m.total === 'number')) continue;

        if (m.dataB64) {
          const key = `${m.fileId}:${m.chunk}`;
          if (!acc.has(key)) {
            acc.set(key, { parts: [], total: m.partTotal || 1 });
          }
          const entry = acc.get(key);
          const idx = (typeof m.part === 'number') ? m.part : 0;
          entry.parts[idx] = m.dataB64;
          entry.total = m.partTotal || 1;

          if (!archiveName) archiveName = m.name;
          if (!cipherSha256) cipherSha256 = m.cipherHash;
          if (!kdf && m.kdfParams) kdf = m.kdfParams;
          if (!salt && m.saltB64) salt = Buffer.from(m.saltB64, 'base64');
          if (!nonce && m.nonceB64) nonce = Buffer.from(m.nonceB64, 'base64');
          if (!expectedTotal) expectedTotal = m.total;

          process.stdout.write(`INLINE ${path.basename(img)} → #${m.chunk+1}/${m.total}${m.partTotal?` (part ${idx+1}/${m.partTotal})`:''}\n`);
        }
      }

      // if we collected inline data, assemble it
      if (acc.size > 0) {
        for (const [key, entry] of acc.entries()) {
          if ((entry.total || 1) > 1) {
            // ensure no missing parts
            for (let p = 0; p < entry.total; p++) {
              if (typeof entry.parts[p] !== 'string') {
                console.error(`Missing QR part ${p+1}/${entry.total} for ${key}`);
                process.exit(1);
              }
            }
          }
          const joinedB64 = (entry.total && entry.total > 1) ? entry.parts.join('') : entry.parts[0];
          const buf = Buffer.from(joinedB64, 'base64');
          const chunkIndex = parseInt(key.split(':')[1], 10);
          chunks[chunkIndex] = buf;
        }
      } else {
        // No inline data at all → probably legacy pointer QRs
        const m0 = decodeQRImage(imgs[0]);
        console.error(`Fragment file not found from QR path: ${m0 && m0.json ? m0.json : 'unknown'}`);
        console.error("→ Re-encode with --inline to store data directly in QR.");
        process.exit(1);
      }
    }
  }

  // 2) If not images or inline not used — treat input as fragments dir/file (legacy)
  if (!chunks.length) {
    const manifestPath = findManifest(input);
    if (!manifestPath) {
      console.error("No inline QR data detected and manifest.json not found. This decoder expects inline QR payloads.");
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    expectedTotal = manifest.totalChunks || manifest.total_chunks;
    cipherSha256  = manifest.cipherSha256 || manifest.cipher_sha256;

    let fragmentFiles = listFragmentsFlexible(input);
    if (!fragmentFiles.length) { console.error("No data found: neither inline QR nor *.bin.json fragments are present."); process.exit(1); }

    for (const fp of fragmentFiles) {
      const frag = JSON.parse(fs.readFileSync(fp,'utf8'));
      if (frag.type !== FRAGMENT_TYPE) continue;
      if (!archiveName) archiveName = frag.name;
      const buf = Buffer.from(frag.data,'base64');
      const h  = crypto.createHash('sha256').update(buf).digest('hex');
      if (h !== frag.hash) { console.error(`Chunk hash mismatch: ${path.basename(fp)}`); process.exit(1); }
      chunks[frag.chunk] = buf;
    }
    kdf   = manifest.kdfParams || manifest.kdf_params;
    salt  = Buffer.from(manifest.saltB64  || manifest.salt_b64 , 'base64');
    nonce = Buffer.from(manifest.nonceB64 || manifest.nonce_b64, 'base64');
  }

  const present = chunks.filter(Boolean).length;
  if (expectedTotal && present !== expectedTotal) { console.error(`Missing chunks: ${present}/${expectedTotal}`); process.exit(1); }

  const encBuffer = Buffer.concat(chunks);
  const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
  if (cipherSha256 && globalCheck !== cipherSha256) {
    console.error(`Global sha256 mismatch. Expected ${cipherSha256}, got ${globalCheck}`);
    process.exit(1);
  }

  // 4) Decrypt AES-256-GCM
  if (!kdf || !salt || !nonce) {
    console.error("Crypto parameters (kdfParams/saltB64/nonceB64) are missing. Re-encode in inline mode.");
    process.exit(1);
  }

  let pass; try { pass = await promptHidden('Enter decryption password: '); } catch(e){ console.error(e.message||e); process.exit(1); }
  if (!pass || pass.length < 8) { console.error('Password must be at least 8 characters long.'); process.exit(1); }

  const key = crypto.scryptSync(pass, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512*1024*1024 });
  const tag        = encBuffer.subarray(encBuffer.length - 16);
  const ciphertext = encBuffer.subarray(0, encBuffer.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  let zip;
  try { zip = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
  catch { console.error("Decryption failed. Wrong password or corrupted data."); process.exit(1); }

  const outZip = path.join(outputDir, archiveName || 'restored.zip');
  fs.writeFileSync(outZip, zip);
  console.log(`\n✅ Restored ZIP → ${outZip}`);
})();
