const fs = require('fs');
const QRCode = require('qrcode');
const JSZip = require('jszip');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const fileInput = document.getElementById('fileInput');
const terminal = document.getElementById('terminal');

function log(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  line.className = 'line';
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

async function encodeFile(file) {
  log(`Encoding ${file.name}`);
  const buffer = await fs.promises.readFile(file.path);
  const chunkSize = 1000;
  const total = Math.ceil(buffer.length / chunkSize);
  const zip = new JSZip();
  for (let i = 0; i < total; i++) {
    const chunk = buffer.slice(i * chunkSize, (i + 1) * chunkSize);
    const payload = {
      file: file.name,
      index: i,
      total,
      data: chunk.toString('base64')
    };
    const dataUrl = await QRCode.toDataURL(JSON.stringify(payload));
    const b64 = dataUrl.split(',')[1];
    zip.file(`qr_${String(i + 1).padStart(4, '0')}.png`, b64, { base64: true });
    log(`QR ${i + 1}/${total}`);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${file.name}.qrcodes.zip`);
  log('Done.');
}

async function decodeZip(file) {
  log(`Decoding ${file.name}`);
  const data = await fs.promises.readFile(file.path);
  const zip = await JSZip.loadAsync(data);
  const chunks = [];
  let targetName = 'output.bin';
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    const img = await zip.files[name].async('nodebuffer');
    const png = PNG.sync.read(img);
    const code = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
    if (!code) continue;
    const payload = JSON.parse(code.data);
    chunks[payload.index] = Buffer.from(payload.data, 'base64');
    targetName = payload.file;
    log(`QR ${payload.index + 1}/${payload.total}`);
  }
  const buffer = Buffer.concat(chunks);
  triggerDownload(new Blob([buffer]), targetName);
  log('Done.');
}

document.getElementById('actionBtn').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const file = fileInput.files[0];
  terminal.innerHTML = '';
  if (!file) {
    log('No file selected');
    return;
  }
  try {
    if (mode === 'encode') await encodeFile(file);
    else await decodeZip(file);
  } catch (err) {
    log('Error: ' + err.message);
  }
});
