const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const input = process.argv[2];
if (!input) {
  console.error("❌ Need ./fragments/ or one.json");
  process.exit(1);
}

let files = [];

const stats = fs.statSync(input);
if (stats.isDirectory()) {
  files = fs.readdirSync(input)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(input, f));
} else if (stats.isFile()) {
  files = [input];
} else {
  console.error("❌  Failed");
  process.exit(1);
}

if (files.length === 0) {
  console.error("❌  Failed");
  process.exit(1);
}

let chunks = [];
let archiveName = null;
let expectedTotal = null;
let globalHash = null;

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fragment = JSON.parse(raw);

  if (fragment.type !== 'GITRIP-CHUNK') continue;

  if (!archiveName) archiveName = fragment.name;
  if (!expectedTotal) expectedTotal = fragment.total;
  if (!globalHash) globalHash = fragment.archiveHash;

  chunks[fragment.chunk] = Buffer.from(fragment.data, 'base64');
  console.log(`📥 Чанк #${fragment.chunk + 1} загружен`);
}

if (chunks.length !== expectedTotal) {
  console.error("❌ Не все чанки найдены. Проверь количество.");
  process.exit(1);
}

const fullBuffer = Buffer.concat(chunks);
const check = crypto.createHash('sha256').update(fullBuffer).digest('hex');

if (check !== globalHash) {
  console.error("❌ Контрольная сумма не совпадает. Архив повреждён.");
  process.exit(1);
}

fs.writeFileSync(archiveName, fullBuffer);
console.log(`✅ Архив восстановлен: ${archiveName}`);
