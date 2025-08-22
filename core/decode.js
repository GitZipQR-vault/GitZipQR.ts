require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: node core/decode.js <root_or_fragments_dir_or_file> [output_dir]");
  process.exit(1);
}
const outputDir = process.argv[3] || process.cwd();
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

function findManifest(startPath) {
  const abs = path.resolve(startPath);
  const candidates = [
    path.join(abs, 'manifest.json'),                 // в самом каталоге
    path.join(path.resolve(abs, '..'), 'manifest.json'), // на уровень выше
    path.join(process.cwd(), 'manifest.json')        // текущая рабочая
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function listFragmentFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [path.resolve(p)];

  // p — каталог: сначала ищем *.bin.json прямо в нём
  let dir = path.resolve(p);
  let files = fs.readdirSync(dir).filter(f => f.endsWith('.bin.json')).map(f => path.join(dir, f));

  // если пусто — попробуем подкаталог fragments/
  if (files.length === 0) {
    const alt = path.join(dir, 'fragments');
    if (fs.existsSync(alt) && fs.statSync(alt).isDirectory()) {
      dir = alt;
      files = fs.readdirSync(dir).filter(f => f.endsWith('.bin.json')).map(f => path.join(dir, f));
    }
  }

  // Отсортируем по индексу из имени qr-000123.bin.json
  files.sort((a, b) => {
    const ai = parseInt((path.basename(a).match(/(\d+)\.bin\.json$/) || [,'0'])[1], 10);
    const bi = parseInt((path.basename(b).match(/(\d+)\.bin\.json$/) || [,'0'])[1], 10);
    return ai - bi;
  });

  return files;
}

const input = path.resolve(inputArg);
const manifestPath = findManifest(input);
if (!manifestPath) {
  console.error("manifest.json not found near input (try placing it in root or parent of fragments).");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const files = listFragmentFiles(input);
if (files.length === 0) {
  console.error("No *.bin.json fragments found.");
  process.exit(1);
}

const chunks = [];
let archiveName = null;
let expectedTotal = manifest.total_chunks;
let cipherSha256 = manifest.cipher_sha256;

for (const fp of files) {
  const raw = fs.readFileSync(fp, 'utf8');
  const frag = JSON.parse(raw);
  if (frag.type !== FRAGMENT_TYPE) continue;

  if (!archiveName) archiveName = frag.name;
  if (!cipherSha256) cipherSha256 = frag.cipherHash;

  const buf = Buffer.from(frag.data, 'base64');
  const chk = crypto.createHash('sha256').update(buf).digest('hex');
  if (chk !== frag.hash) {
    console.error("SHA256 mismatch in " + path.basename(fp));
    process.exit(1);
  }
  chunks[frag.chunk] = buf;
}

const present = chunks.filter(Boolean).length;
if (expectedTotal && present !== expectedTotal) {
  console.error("\nMissing chunks: got " + present + "/" + expectedTotal);
  process.exit(1);
}

const encBuffer = Buffer.concat(chunks);
const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
if (globalCheck !== cipherSha256) {
  console.error("\nGlobal sha256 mismatch. Expected " + cipherSha256 + " got " + globalCheck);
  process.exit(1);
}

const PASSPHRASE = process.env.PASSPHRASE;
if (!PASSPHRASE || PASSPHRASE.length < 8) {
  console.error("Set PASSPHRASE in .env used during encode.");
  process.exit(1);
}

const salt = Buffer.from(manifest.salt_b64, 'base64');
const nonce = Buffer.from(manifest.nonce_b64, 'base64');
const tag = encBuffer.subarray(encBuffer.length - 16);
const ciphertext = encBuffer.subarray(0, encBuffer.length - 16);

const key = crypto.scryptSync(PASSPHRASE, salt, 32, { N: manifest.kdf_params.N, r: manifest.kdf_params.r, p: manifest.kdf_params.p, maxmem: 512 * 1024 * 1024 });
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
console.log("\nRestored ZIP: " + outZip);
