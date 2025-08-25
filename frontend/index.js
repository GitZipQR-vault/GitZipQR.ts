const translations = {
  en: {
    title: "GitZipQR",
    tagline: "Secure archives through QR-coded encryption",
    intro: "GitZipQR turns a folder into a deterministic ZIP, encrypts it with AES-256-GCM and stores the ciphertext inside QR codes.",
    step1: "Zip the folder with normalized timestamps",
    step2: "Derive a key via scrypt and encrypt with AES-256-GCM",
    step3: "Split the ciphertext into QR-sized chunks",
    step4: "Embed each chunk directly into a QR image (base64 payload)",
    step5: "To restore, scan all QR codes and decrypt using the same password",
    encryptTitle: "Encrypt Folder",
    decryptTitle: "Decrypt Folder",
    dropText: "Drop folder or ZIP here or click to select",
    addPass: "Add password",
    encryptBtn: "Encrypt",
    decryptBtn: "Decrypt",
    modeEncrypt: "Encrypt",
    modeDecrypt: "Decrypt",
    supportBtn: "Support via USDT",
    walletLabel: "USDT Wallet:"
  },
  ru: {
    title: "GitZipQR",
    tagline: "Безопасные архивы через QR-коды",
    intro: "GitZipQR превращает папку в детерминированный ZIP, шифрует его AES-256-GCM и сохраняет шифртекст внутри QR-кодов.",
    step1: "Архивируйте папку с нормализованными отметками времени",
    step2: "Получите ключ через scrypt и зашифруйте AES-256-GCM",
    step3: "Разделите шифртекст на части размером с QR-код",
    step4: "Встроите каждую часть непосредственно в изображение QR (base64)",
    step5: "Для восстановления отсканируйте все QR-коды и расшифруйте тем же паролем",
    encryptTitle: "Зашифровать папку",
    decryptTitle: "Расшифровать папку",
    dropText: "Перетащите папку или ZIP сюда или нажмите для выбора",
    addPass: "Добавить пароль",
    encryptBtn: "Зашифровать",
    decryptBtn: "Расшифровать",
    modeEncrypt: "Шифровать",
    modeDecrypt: "Расшифровать",
    supportBtn: "Поддержать USDT",
    walletLabel: "USDT кошелек:"
  }
};

const langBtn = document.getElementById('langBtn');
const langMenu = document.getElementById('langMenu');
let currentLang = 'en';

function applyLang(lang) {
  const strings = translations[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (strings[key]) {
      el.textContent = strings[key];
    }
  });
  currentLang = lang;
}

langBtn.addEventListener('click', () => {
  langMenu.classList.toggle('hidden');
});

langMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    applyLang(btn.dataset.lang);
    setMode(mode);
    langMenu.classList.add('hidden');
  });
});

// set default language
applyLang('en');

/* ---------------- Encryption UI ---------------- */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const addPassword = document.getElementById('addPassword');
const actionBtn = document.getElementById('encryptBtn');
const terminal = document.getElementById('terminal');
const passwordsDiv = document.querySelector('.passwords');
const modeEncrypt = document.getElementById('modeEncrypt');
const modeDecrypt = document.getElementById('modeDecrypt');
const modeTitle = document.getElementById('modeTitle');
const supportBtn = document.getElementById('supportBtn');
let mode = 'encrypt';
let selectedFiles = [];

// Prevent the browser from opening files when dropping outside the zone
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
  document.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
  });
});

function log(msg) {
  terminal.textContent += msg + '\n';
  terminal.scrollTop = terminal.scrollHeight;
}

async function traverseFileTree(entry, path = '') {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file(file => {
        file.relativePath = path + file.name;
        resolve([file]);
      }, reject);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      dirReader.readEntries(async entries => {
        const promises = entries.map(e => traverseFileTree(e, path + entry.name + '/'));
        const results = await Promise.all(promises);
        resolve(results.flat());
      }, reject);
    } else {
      resolve([]);
    }
  });
}

async function getFilesFromItems(items) {
  let all = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      const files = await traverseFileTree(entry);
      all = all.concat(files);
    } else {
      const f = item.getAsFile();
      if (f) all.push(f);
    }
  }
  return all;
}

async function handleFileSelection(files) {
  let list = Array.isArray(files) ? files : Array.from(files);
  if (mode === 'decrypt' && list.length === 1 && list[0].name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(list[0]);
    const out = [];
    const entries = Object.keys(zip.files);
    await Promise.all(entries.map(async name => {
      const file = zip.files[name];
      if (!file.dir) {
        const blob = await file.async('blob');
        out.push(new File([blob], name));
      }
    }));
    selectedFiles = out;
  } else {
    selectedFiles = list;
  }
  log('Files selected: ' + selectedFiles.length);
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('hover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('hover');
  let files;
  if (e.dataTransfer.items) {
    files = await getFilesFromItems(e.dataTransfer.items);
  } else {
    files = Array.from(e.dataTransfer.files);
  }
  await handleFileSelection(files);
});

fileInput.addEventListener('change', async (e) => {
  await handleFileSelection(e.target.files);
});

addPassword.addEventListener('click', () => {
  const count = passwordsDiv.querySelectorAll('input').length + 1;
  const inp = document.createElement('input');
  inp.type = 'password';
  inp.className = 'password-field';
  inp.placeholder = `Password #${count}`;
  passwordsDiv.appendChild(inp);
});

function setMode(m) {
  mode = m;
  modeEncrypt.classList.toggle('active', mode === 'encrypt');
  modeDecrypt.classList.toggle('active', mode === 'decrypt');
  const strings = translations[currentLang];
  modeTitle.textContent = strings[mode === 'encrypt' ? 'encryptTitle' : 'decryptTitle'];
  actionBtn.textContent = strings[mode === 'encrypt' ? 'encryptBtn' : 'decryptBtn'];
  if (mode === 'encrypt') {
    fileInput.setAttribute('webkitdirectory', '');
    fileInput.removeAttribute('accept');
  } else {
    fileInput.removeAttribute('webkitdirectory');
    fileInput.setAttribute('accept', '.zip,image/*');
  }
  fileInput.value = '';
  selectedFiles = [];
}

modeEncrypt.addEventListener('click', () => setMode('encrypt'));
modeDecrypt.addEventListener('click', () => setMode('decrypt'));

async function encryptFolder() {
  if (!selectedFiles.length) { log('No files selected'); return; }
  const pwEls = passwordsDiv.querySelectorAll('input');
  const pw = Array.from(pwEls).map(i => i.value).filter(Boolean).join('\u0000');
  if (!pw) { log('No passwords provided'); return; }
  log('Encrypting folder ...');
  try {
    const zipSrc = new JSZip();
    for (const file of selectedFiles) {
      const path = file.webkitRelativePath || file.relativePath || file.name;
      zipSrc.file(path, file);
    }
    const zipped = await zipSrc.generateAsync({ type: 'uint8array' });
    const enc = new TextEncoder();
    const pwKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, pwKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped);
    const extBytes = new TextEncoder().encode('zip');
    const out = new Uint8Array(1 + extBytes.length + salt.length + iv.length + cipher.byteLength);
    let offset = 0;
    out[offset++] = extBytes.length;
    out.set(extBytes, offset); offset += extBytes.length;
    out.set(salt, offset); offset += salt.length;
    out.set(iv, offset); offset += iv.length;
    out.set(new Uint8Array(cipher), offset);

    function toBase64(bytes) {
      let binary = '';
      const len = bytes.length;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    const base64 = toBase64(out);
    let chunkSize = 2500;
    while (chunkSize > 100) {
      try {
        await QRCode.toDataURL('a'.repeat(chunkSize), { errorCorrectionLevel: 'L' });
        break;
      } catch (err) {
        if (err.message && err.message.includes('too big')) chunkSize -= 100; else throw err;
      }
    }
    const zip = new JSZip();
    const folder = zip.folder('QR-codes');
    let count = 0;
    for (let i = 0; i < base64.length; i += chunkSize) {
      const chunk = base64.slice(i, i + chunkSize);
      const dataUrl = await QRCode.toDataURL(chunk, { errorCorrectionLevel: 'L' });
      folder.file(`qr-${++count}.png`, dataUrl.split(',')[1], { base64: true });
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'qrcodes.zip';
    a.click();
    log('Encryption complete. QR codes: ' + count);
  } catch (e) {
    log('Error: ' + e.message);
  }
}

async function fileToImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decryptFolder() {
  if (!selectedFiles.length) { log('No files selected'); return; }
  const pwEls = passwordsDiv.querySelectorAll('input');
  const pw = Array.from(pwEls).map(i => i.value).filter(Boolean).join('\u0000');
  if (!pw) { log('No passwords provided'); return; }
  log('Decrypting folder ...');
  try {
    const jsqr = typeof jsQR !== 'undefined' ? jsQR : (typeof window !== 'undefined' ? window.jsQR : null);
    if (typeof jsqr !== 'function') throw new Error('jsQR is not available');
    const files = selectedFiles.slice().sort((a,b)=>a.name.localeCompare(b.name));
    let base64 = '';
    for (const file of files) {
      const img = await fileToImageData(file);
      const code = jsqr(img.data, img.width, img.height);
      if (code) base64 += code.data;
    }
    const bytes = fromBase64(base64);
    let offset = 0;
    const extLen = bytes[offset++];
    const ext = new TextDecoder().decode(bytes.slice(offset, offset + extLen));
    offset += extLen;
    const salt = bytes.slice(offset, offset + 16); offset += 16;
    const iv = bytes.slice(offset, offset + 12); offset += 12;
    const cipher = bytes.slice(offset);
    const enc = new TextEncoder();
    const pwKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, pwKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([plain]));
    a.download = 'decoded.zip';
    a.click();
    log('Decryption complete. Extension: .' + ext);
  } catch (e) {
    log('Error: ' + e.message);
  }
}

const USDT_ADDRESS = '0xa8b3A40008EDF9AF21D981Dc3A52aa0ed1cA88fD';
document.getElementById('walletAddress').textContent = USDT_ADDRESS;
supportBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(USDT_ADDRESS).then(() => {
    log('USDT address copied');
  });
});

actionBtn.addEventListener('click', () => {
  if (mode === 'encrypt') encryptFolder();
  else decryptFolder();
});

setMode('encrypt');
