import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import { PNG } from 'pngjs';

const FONT: Record<string, string[]> = {
  G: ['01110','10001','10000','10111','10001','10001','01111'],
  i: ['00100','00000','00100','00100','00100','00100','00100'],
  t: ['00100','00100','11111','00100','00100','00100','00011'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  p: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
};

export async function generateCustomQRCode(data: string | Buffer, outPath: string) {
  const payload = typeof data === 'string' ? data : data.toString('base64');
  const buf = await qrcode.toBuffer(payload, { errorCorrectionLevel: 'H', margin: 1 });
  const png = PNG.sync.read(buf);
  const text = 'GitZipQR';
  const startX = 4;
  const startY = png.height - 10;
  let x = startX;
  for (const ch of text) {
    const pat = FONT[ch];
    if (!pat) { x += 6; continue; }
    for (let dy = 0; dy < pat.length; dy++) {
      for (let dx = 0; dx < pat[dy].length; dx++) {
        if (pat[dy][dx] === '1') {
          const px = (startY + dy) * png.width + (x + dx);
          png.data[px * 4 + 0] = 255; // red
          png.data[px * 4 + 1] = 0;
          png.data[px * 4 + 2] = 0;
          png.data[px * 4 + 3] = 255;
        }
      }
    }
    x += pat[0].length + 1;
  }
  const out = PNG.sync.write(png);
  fs.writeFileSync(outPath, out);
}

if (require.main === module) {
  const message = process.argv[2] || 'GitZipQR unlimited data';
  const outDir = process.argv[3] || path.join(process.cwd(), 'qrcode');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'custom.png');
  generateCustomQRCode(message, outPath).then(() => {
    console.log(`Custom QR generated at ${outPath}`);
  });
}
