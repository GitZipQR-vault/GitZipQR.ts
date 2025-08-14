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

const archiveName = path.basename(inputDir) + ".zip";
const archivePath = path.join("/tmp", archiveName);
const output = fs.createWriteStream(archivePath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const data = fs.readFileSync(archivePath);
  const chunkSize = 2000; // байт на чанк
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
    const qrPath = path.join("./qrcodes", `${filename}.png`);
    const jsonPath = path.join("./fragments", `${filename}.json`);

    // Сохраняем полный JSON
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

    // В QR — только мета-информация, без data
    const qrMeta = {
      chunk: i,
      total: totalChunks,
      json: `${filename}.json`
    };

    try {
      qrcode.toFile(qrPath, JSON.stringify(qrMeta), { errorCorrectionLevel: 'H' });
      console.log(`✅ QR ${i + 1}/${totalChunks}: ${qrPath}`);
    } catch (err) {
      console.error(`❌ Ошибка QR ${i}:`, err.message);
    }
  }

  console.log(`📦 Архив: ${archivePath}`);
  console.log(`🧩 QR-коды: ./qrcodes/*.png`);
  console.log(`🧾 JSON-фрагменты: ./fragments/*.json`);
});

archive.pipe(output);
archive.directory(inputDir, false);
archive.finalize();
