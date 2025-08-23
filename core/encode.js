const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const qrcode = require('qrcode');
const { writeManifest } = require('./manifest');

// -------- CLI hidden prompt --------
function promptHidden(question, { confirm = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('Нет интерактивного TTY для ввода пароля'));
    }
    const readOnce = (q) =>
      new Promise((res, rej) => {
        process.stdout.write(q);
        const stdin = process.stdin;
        const onData = (data) => {
          const s = data.toString('utf8');
          // catch Ctrl+C
          if (s === '\u0003') { cleanup(); process.stdout.write('\n'); rej(new Error('Операция прервана')); return; }
          // enter
          if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); res(buffer); return; }
          // backspace
          if (s === '\u0008' || s === '\u007f') { buffer = buffer.slice(0, -1); return; }
          // other
          buffer += s;
        };
        const cleanup = () => {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
        };
        let buffer = '';
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
      });

    const flow = async () => {
      const p1 = await readOnce(question);
      if (!confirm) return p1;
      const p2 = await readOnce('Повтори пароль: ');
      if (p1 !== p2) throw new Error('Пароли не совпадают');
      return p1;
    };

    flow().then(resolve).catch(reject);
  });
}

// ------------- args & dirs -------------
const inputDir = process.argv[2];
if (!inputDir) {
  console.error("Укажи папку для кодирования. Пример: bun run encode ./mydata [./output]");
  process.exit(1);
}
const outputBaseDir = process.argv[3] || process.cwd();
const qrDir = path.join(outputBaseDir, 'qrcodes');
const fragmentsDir = path.join(outputBaseDir, 'fragments');
[qrDir, fragmentsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Настройки
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '65536', 10); // 64 KiB по умолчанию
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32 };
const FRAGMENT_TYPE = "GitZipQR-CHUNK-ENC";

(async () => {
  // 0) Пароль
  let PASSPHRASE;
  try {
    PASSPHRASE = await promptHidden('Пароль для шифрования: ', { confirm: true });
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
  if (!PASSPHRASE || PASSPHRASE.length < 8) {
    console.error('Пароль должен быть не короче 8 символов.');
    process.exit(1);
  }

  // 1) Zip input directory в tmp (фиксированные timestamps для воспроизводимости)
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

  // 3) Делим на фрагменты + делаем QR с метаданными и относительной ссылкой на .bin.json
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

      // QR = только индекс/мета (весь payload в QR физически не влезет)
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

  console.log(`\nГотово.
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
