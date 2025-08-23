/**
 * QR Encode Worker
 * - Prefers native 'qrencode' binary if available (faster).
 * - Falls back to 'qrcode' JS library.
 */
const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');

async function encodeWithQrencode(outPath, text, ecl, margin) {
  return new Promise((resolve, reject) => {
    const args = ['-o', outPath, '-l', ecl || 'Q', '-m', String(margin ?? 1), '-t', 'PNG'];
    const p = spawn('qrencode', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => (stderr += d.toString()));
    p.on('close', code => {
      if (code === 0) resolve(true);
      else reject(new Error(stderr || `qrencode exited ${code}`));
    });
    p.stdin.end(text, 'utf8');
  });
}

async function encodeWithJs(outPath, text, ecl, margin) {
  const qrcode = require('qrcode');
  return new Promise((resolve, reject) => {
    qrcode.toFile(outPath, text, { errorCorrectionLevel: ecl || 'Q', margin: margin ?? 1 }, err => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

(async () => {
  const { outPath, text, useQrencode, ecl, margin } = workerData;
  try {
    if (useQrencode) {
      await encodeWithQrencode(outPath, text, ecl, margin);
    } else {
      await encodeWithJs(outPath, text, ecl, margin);
    }
    parentPort.postMessage({ ok: true });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
  }
})();
