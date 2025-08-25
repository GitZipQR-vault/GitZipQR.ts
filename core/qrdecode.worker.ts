/**
 * QR Decode Worker
 * - Reads PNG/JPEG, decodes with jsQR and returns parsed JSON.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const jsQR = require('jsqr');

function readRGBA(filePath) {
  const buf = fs.readFileSync(filePath);
  const isPng = buf.slice(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (isPng) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  } else if (isJpeg) {
    const raw = jpeg.decode(buf, { useTArray: true });
    return { data: raw.data, width: raw.width, height: raw.height };
  } else {
    throw new Error('Unsupported image format');
  }
}

try {
  const { img } = workerData;
  const { data, width, height } = readRGBA(img);
  const u8 = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(u8, width, height);
  if (!result || !result.data) throw new Error('QR not detected');
  let payload;
  try { payload = JSON.parse(result.data); }
  catch { throw new Error('QR payload is not valid JSON'); }
  parentPort.postMessage({ ok: true, payload });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
}
