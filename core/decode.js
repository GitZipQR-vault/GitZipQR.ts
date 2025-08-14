const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const input = process.argv[2];
if (!input) {
  console.error("❌ Укажи папку с фрагментами или JSON-файл");
  console.log("Пример: node decode.js ./output/fragments");
  process.exit(1);
}

// Получаем выходную папку из аргумента
const outputDir = process.argv[3] || process.cwd();

let files = [];
try {
  const stats = fs.statSync(input);
  if (stats.isDirectory()) {
    files = fs.readdirSync(input)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(input, f));
  } else if (stats.isFile()) {
    files = [input];
  }
} catch (e) {
  console.error(`❌ Ошибка чтения: ${input}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error("❌ Не найдено JSON-файлов");
  process.exit(1);
}

let chunks = [];
let archiveName = null;
let expectedTotal = null;
let globalHash = null;

for (const filePath of files) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fragment = JSON.parse(raw);

    if (fragment.type !== 'GITRIP-CHUNK') continue;

    if (!archiveName) archiveName = fragment.name;
    if (!expectedTotal) expectedTotal = fragment.total;
    if (!globalHash) globalHash = fragment.archiveHash;

    chunks[fragment.chunk] = Buffer.from(fragment.data, 'base64');
    console.log(`📥 Загружен чанк ${fragment.chunk + 1}/${fragment.total}`);
  } catch (e) {
    console.error(`⚠️ Ошибка чтения ${path.basename(filePath)}: ${e.message}`);
  }
}

if (chunks.length !== expectedTotal) {
  console.error(`\n❌ Не хватает чанков! Найдено: ${chunks.filter(Boolean).length}/${expectedTotal}`);
  process.exit(1);
}

const fullBuffer = Buffer.concat(chunks);
const check = crypto.createHash('sha256').update(fullBuffer).digest('hex');

if (check !== globalHash) {
  console.error("\n❌ Контрольная сумма не совпадает! Архив поврежден.");
  console.log(`Ожидалось: ${globalHash}`);
  console.log(`Получено:  ${check}`);
  process.exit(1);
}

const outputPath = path.join(outputDir, archiveName);
fs.writeFileSync(outputPath, fullBuffer);
console.log(`\n✅ Архив восстановлен: ${outputPath}`);