/**
 * Simple folder synchronization.
 * Copies new or changed files from src to dest preserving structure.
 * Usage: bun sync <src> <dest>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function walk(dir: string, base = dir): { abs: string; rel: string }[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: { abs: string; rel: string }[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    if (e.isDirectory()) files.push(...walk(abs, base));
    else if (e.isFile()) files.push({ abs, rel });
  }
  return files;
}

function sha256(p: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

export async function sync(src: string, dest: string) {
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error('Source must be an existing folder');
    process.exit(1);
  }
  fs.mkdirSync(dest, { recursive: true });
  const files = walk(src);
  for (const f of files) {
    const outPath = path.join(dest, f.rel);
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });
    if (fs.existsSync(outPath)) {
      const same = sha256(f.abs) === sha256(outPath);
      if (same) continue;
    }
    fs.copyFileSync(f.abs, outPath);
    console.log(`synced ${f.rel}`);
  }
}

if (require.main === module) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: bun sync <src_folder> <dest_folder>');
    process.exit(1);
  }
  sync(src, dest);
}

module.exports = { sync };

