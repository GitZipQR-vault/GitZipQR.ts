/**
 * GitZipQR - Decoder (CommonJS, image → jsQR)
 * Author: Daniil (RestlessByte) — https://github.com/RestlessByte
 * License: MIT
 *
 * Восстанавливает зашифрованный ZIP из:
 *  - папки QR-изображений (PNG/JPG/JPEG), или
 *  - папки JSON-фрагментов (*.bin.json), или одного файла-фрагмента.
 *
 * Алгоритм:
 *   1) Ищет manifest.json рядом с вводом (та же папка, родитель или CWD).
 *   2) Если фрагментов нет — декодирует QR картинки и берёт относительные пути к JSON.
 *   3) Проверяет хэши кусков и общий sha256, затем расшифровывает AES-256-GCM
 *      по ключу scrypt(ВведённыйПароль, salt из manifest.json).
 *
 * Запуск:
 *   bun run decode <qrcodes_or_fragments_dir_or_file> [output_dir]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// image decoders + QR reader
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

// -------- CLI hidden prompt --------
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('Нет интерактивного TTY для ввода пароля'));
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    let buffer = '';
    const onData = (data) => {
      const s = data.toString('utf8');
      // Ctrl+C
      if (s === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Операция прервана')); return; }
      // Enter
      if (s === '\r' || s === '\n') { cleanup(); process.stdout.write('\n'); resolve(buffer); return; }
      // Backspace
      if (s === '\u0008' || s === '\u007f') { buffer = buffer.slice(0, -1); return; }
      buffer += s;
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
    } catch (e) {
      reject(e);
    }
  });
}

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
    return { data: raw.data, width: raw.width, height: raw.height };
  }
}

function decodeQRImage(filePath) {
  const { data, width, height } = readRGBAFromImage(filePath);
  const u8 = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(u8, width, height);
  if (!result || !result.data) throw new Error("QR не распознан");
  let payload;
  try { payload = JSON.parse(result.data); }
  catch { throw new Error("QR payload не является валидным JSON"); }
  return payload; // { v, id, seq, total, json }
}

function resolveFragmentPath(baseDir, relativeJsonPath) {
  const cands = [
    path.resolve(baseDir, relativeJsonPath),
    path.resolve(path.dirname(baseDir), relativeJsonPath),
    path.resolve(process.cwd(), relativeJsonPath),
  ];
  for (const p of cands) if (fs.existsSync(p)) return p;
  return cands[0];
}

// ---------- main ----------
(async function main(){
  const input = path.resolve(inputArg);

  // 1) manifest
  const manifestPath = findManifest(input);
  if (!manifestPath) {
    console.error("manifest.json не найден рядом с входом. Положи его в ту же папку, родителя или CWD.");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const expectedTotal = manifest.totalChunks || manifest.total_chunks;
  let cipherSha256 = manifest.cipherSha256 || manifest.cipher_sha256;

  // 2) collect fragments (*.bin.json) OR decode QR images to get paths
  let fragmentFiles = listFragmentsFlexible(input);

  if (fragmentFiles.length === 0) {
    // Нет .bin.json → пробуем QR-картинки
    const st = fs.statSync(input);
    if (!st.isDirectory()) {
      console.error("Вход не является папкой с QR и фрагменты не найдены.");
      process.exit(1);
    }

    const imgs = fs.readdirSync(input).filter(isImageFile).map(f=>path.join(input,f));
    if (imgs.length === 0) {
      console.error("Не найдено *.bin.json и QR-изображений в папке.");
      process.exit(1);
    }

    console.log("📷 Декодируем QR изображения...");
    const metas = [];
    for (const img of imgs) {
      try {
        const m = decodeQRImage(img);
        if (typeof m.seq !== 'number' || typeof m.total !== 'number' || !m.json) {
          throw new Error("QR JSON не содержит обязательные поля");
        }
        metas.push({img, ...m});
        process.stdout.write(`OK ${path.basename(img)} → #${m.seq+1}/${m.total}\n`);
      } catch (e) {
        console.error(`QR ошибка для ${path.basename(img)}: ${e.message}`);
        process.exit(1);
      }
    }
    metas.sort((a,b)=>a.seq-b.seq);
    fragmentFiles = metas.map(m => resolveFragmentPath(input, m.json));
  }

  if (fragmentFiles.length === 0) {
    console.error("Нет фрагментов для восстановления.");
    process.exit(1);
  }

  // 3) грузим фрагменты, проверяем, конкатенируем
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
      console.error(`Несовпадение хэша чанка в ${path.basename(fp)} (ожидалось ${frag.hash}, получили ${h})`);
      process.exit(1);
    }
    chunks[frag.chunk] = buf;
  }

  const present = chunks.filter(Boolean).length;
  if (expectedTotal && present !== expectedTotal) {
    console.error(`Не хватает чанков: получено ${present}/${expectedTotal}`);
    process.exit(1);
  }

  const encBuffer = Buffer.concat(chunks);
  const globalCheck = crypto.createHash('sha256').update(encBuffer).digest('hex');
  if (cipherSha256 && globalCheck !== cipherSha256) {
    console.error(`Глобальный sha256 не совпал. Ожидалось ${cipherSha256}, получили ${globalCheck}`);
    process.exit(1);
  }

  // 4) пароль и расшифровка AES-256-GCM
  let PASSPHRASE;
  try {
    PASSPHRASE = await promptHidden('Пароль для расшифровки: ');
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
  if (!PASSPHRASE || PASSPHRASE.length < 8) {
    console.error('Пароль должен быть не короче 8 символов.');
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
    console.error("❌ Расшифровка не удалась. Неверный пароль или повреждённые данные.");
    process.exit(1);
  }

  const outZip = path.join(outputDir, archiveName || 'restored.zip');
  fs.writeFileSync(outZip, zip);
  console.log(`\n✅ Восстановленный ZIP → ${outZip}`);
})();
