/**
 * GitZipQR - Decoder (CommonJS, image → jsQR)
 * Author: Daniil (RestlessByte) — https://github.com/RestlessByte
 * License: MIT
 *
 * Restores an encrypted ZIP from:
 *  - a folder of QR images (PNG/JPG/JPEG), or
 *  - a folder of JSON fragments (*.bin.json), or a single fragment.
 *
 * The script:
 *   1) Finds manifest.json near the input (same dir, parent, or CWD).
 *   2) If no fragments are present, it decodes all QR images and follows
 *      the relative fragment paths contained in QR JSON payloads.
 *   3) Verifies chunk hashes and global sha256, then decrypts AES-256-GCM
 *      using a key derived with scrypt(PASSPHRASE, salt).
 *
 * Usage:
 *   bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]
 *   (Node works too: node core/decode.js ...)
 *
 * Env:
 *   .env must contain PASSPHRASE (>= 8 chars). Optional: CHUNK_SIZE.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// image decoders + QR reader
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]");
  process.exit(1);
}
const outputDir = process.argv[3] || process.cwd();
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

// ---------- helpers ----------
function findManifest(startPath) {
  const abs = path.resolve(startPath);
  const candidates = [
    path.join(abs, 'manifest.json'),
    path.join(path.dirname(abs), 'manifest.json'),
    path.join(process.cwd(), 'manifest.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function listFragmentsFlexible(p) {
  const st = fs.existsSync(p) ? fs.statSync(p) : null;
  if (st && st.isFile()) return [path.resolve(p)];

  const res = [];
  const tryDir = d => {
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
      for (const f of fs.readdirSync(d)) {
        if (f.endsWith('.bin.json')) res.push(path.join(d, f));
      }
    }
  };

  const root = path.resolve(p);
  tryDir(root);
  if (res.length === 0) tryDir(path.join(root, 'fragments'));   // conventional name

  // sort by numeric index in filename (qr-000123.bin.json)
  res.sort((a,b)=>{
    const ai=parseInt((path.basename(a).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10);
    const bi=parseInt((path.basename(b).match(/(\d+)\.bin\.json$/)||[,'0'])[1],10);
    return ai-bi;
  });
  return res;
}

function isImageFile(name) { return /\.(png|jpg|jpeg)$/i.test(name); }

function readRGBAFromImage(filePath) {
  const buf = fs.readFileSync(filePath);
  if (/\.png$/i.test(filePath)) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  } else {
    const raw = jpeg.decode(buf, { useTArray: true });
    // jpeg-js returns {data: Uint8Array RGBA, width, height}
    return { data: raw.data, width: raw.width, height: raw.height };
  }
}

function decodeQRImage(filePath) {
  const { data, width, height } = readRGBAFromImage(filePath);
  // jsQR expects Uint8ClampedArray of grayscale or RGBA Uint8ClampedArray; RGBA works fine
  const u8 = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(u8, width, height);
  if (!result || !result.data) throw new Error("QR not detected");
  let payload;
  try { payload = JSON.parse(result.data); }
  catch { throw new Error("QR payload is not valid JSON"); }
  return payload; // expected shape: { v, id, seq, total, json }
}

function resolveFragmentPath(baseDir, relativeJsonPath) {
  // Try relative to: baseDir, parent(baseDir), and CWD → choose first that exists
  const cands = [
    path.resolve(baseDir, relativeJsonPath),
    path.resolve(path.dirname(baseDir), relativeJsonPath),
    path.resolve(process.cwd(), relativeJsonPath),
  ];
  for (const p of cands) if (fs.existsSync(p)) return p;
  // last resort: return the path relative to parent
  return cands[0];
}

// ---------- main ----------
(async function main(){
  const input = path.resolve(inputArg);

  // 1) manifest
  const manifestPath = findManifest(input);
  if (!manifestPath) {
    console.error("manifest.json not found near input. Place it in the same directory, parent, or CWD.");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const expectedTotal = manifest.totalChunks || manifest.total_chunks;
  let cipherSha256 = manifest.cipherSha256 || manifest.cipher_sha256;

  // 2) collect fragments (*.bin.json) OR decode QR images to get paths
  let fragmentFiles = listFragmentsFlexible(input);

  if (fragmentFiles.length === 0) {
    // No .bin.json files → try QR images in arbitrary-named folder
    const st = fs.statSync(input);
    if (!st.isDirectory()) {
      console.error("Input is not a directory with QR images and no fragments were found.");
      process.exit(1);
    }

    const imgs = fs.readdirSync(input).filter(isImageFile).map(f=>path.join(input,f));
    if (imgs.length === 0) {
      console.error("No *.bin.json and no QR images found in the input directory.");
      process.exit(1);
    }

    console.log("📷 Decoding QR images...");
    const metas = [];
    for (const img of imgs) {
      try {
        const m = decodeQRImage(img);
        if (typeof m.seq !== 'number' || typeof m.total !== 'number' || !m.json) {
          throw new Error("QR JSON missing required fields");
        }
        metas.push({img, ...m});
        process.stdout.write(`OK ${path.basename(img)} → #${m.seq+1}/${m.total}\n`);
      } catch (e) {
        console.error(`QR decode failed for ${path.basename(img)}: ${e.message}`);
        process.exit(1);
      }
    }
    // sort and map to fragment paths
    metas.sort((a,b)=>a.seq-b.seq);
    fragmentFiles = metas.map(m => resolveFragmentPath(input, m.json));
  }

  if (fragmentFiles.length === 0) {
    console.error("No fragments to restore.");
    process.exit(1);
  }

  // 3) load fragments, verify, concatenate
  const chunks = [];
  let archiveName = null;

  for (const fp of fragmentFiles) {
    const raw = fs.readFileSync(fp,'utf8');
    const frag = JSON.parse(raw);
    if (frag.type !== FRAGMENT_TYPE) continue;

    if (!archiveName) archiveName = frag.name;
    if (!cipherSha256) cipherSha256 = frag.cipherHash;

    const buf = Buffer.from(frag.data,'base64');
    const h  = crypto.createHash('sha256').update(buf).digest('hex');
    if (h !== frag.hash) {
      console.error(`Chunk hash mismatch in ${path.basename(fp)} (expected ${frag.hash}, got ${h})`);
      process.exit(1);
    }
    chunks[frag.chunk] = buf;
  }

  const present = chunks.filter(Boolean).length;
  if (expectedTotal && present !== expectedTotal) {
    console.error(`Missing chunks: got ${present}/${expectedTotal}`);
    process.exit(1);
  }

  const encBuffer = Buffer.concat(chunks);
  const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
  if (cipherSha256 && globalCheck !== cipherSha256) {
    console.error(`Global sha256 mismatch. Expected ${cipherSha256}, got ${globalCheck}`);
    process.exit(1);
  }

  // 4) decrypt AES-256-GCM
  const PASSPHRASE = process.env.PASSPHRASE;
  if (!PASSPHRASE || PASSPHRASE.length < 8) {
    console.error("Set PASSPHRASE in .env (>=8 chars), same value as used during encode.");
    process.exit(1);
  }

  const salt  = Buffer.from(manifest.saltB64  || manifest.salt_b64 , 'base64');
  const nonce = Buffer.from(manifest.nonceB64 || manifest.nonce_b64, 'base64');
  const tag        = encBuffer.subarray(encBuffer.length - 16);
  const ciphertext = encBuffer.subarray(0, encBuffer.length - 16);

  const kdf = manifest.kdfParams || manifest.kdf_params;
  const key = crypto.scryptSync(PASSPHRASE, salt, 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512*1024*1024
  });

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  let zip;
  try {
    zip = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    console.error("Decryption failed. Wrong passphrase or corrupted data.");
    process.exit(1);
  }

  const outZip = path.join(outputDir, archiveName || 'restored.zip');
  fs.writeFileSync(outZip, zip);
  console.log(`\n✅ Restored ZIP → ${outZip}`);
})();
