const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const qrcode = require('qrcode');

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("❌ Укажи папку для кодирования.");
  process.exit(1);
}

// Получаем выходную папку из аргумента или используем по умолчанию
const outputBaseDir = process.argv[3] || process.cwd();
const qrDir = path.join(outputBaseDir, 'qrcodes');
const fragmentsDir = path.join(outputBaseDir, 'fragments');

// Создаем директории если нужно
[qrDir, fragmentsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const archiveName = path.basename(inputDir) + ".zip";
const archivePath = path.join("/tmp", archiveName);
const output = fs.createWriteStream(archivePath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const data = fs.readFileSync(archivePath);
  const chunkSize = 2000;
  const totalChunks = Math.ceil(data.length / chunkSize);
  const globalHash = crypto.createHash('sha256').update(data).digest('hex');

  for (let i = 0; i < totalChunks; i++) {
    const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
    const payload = {
      type: "GITRIP-CHUNK",
      version: "1.0",
      name: archiveName,
      chunk: i,
      total: totalChunks,
      hash: crypto.createHash('sha256').update(chunk).digest('hex'),
      archiveHash: globalHash,
      data: chunk.toString('base64')
    };

    const filename = `qr-${String(i).padStart(4, '0')}`;
    const qrPath = path.join(qrDir, `${filename}.png`);
    const jsonPath = path.join(fragmentsDir, `${filename}.json`);

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

    const qrMeta = {
      chunk: i,
      total: totalChunks,
      json: path.relative(outputBaseDir, jsonPath)
    };

    qrcode.toFile(qrPath, JSON.stringify(qrMeta), { errorCorrectionLevel: 'H' }, err => {
      if (err) console.error(`❌ Ошибка QR ${i}:`, err.message);
      else console.log(`✅ QR ${i + 1}/${totalChunks}: ${qrPath}`);
    });
  }

  console.log(`\n📦 Archive: ${archivePath}`);
  console.log(`🧩 QR-codes: ${qrDir}/*.png`);
  console.log(`🧾 JSON-fragments: ${fragmentsDir}/*.json`);
  console.log(`🌍 All count chunks: ${totalChunks}`);
});

archive.pipe(output);
archive.directory(inputDir, false);
archive.finalize();