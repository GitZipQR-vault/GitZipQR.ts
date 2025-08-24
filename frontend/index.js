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
    encryptTitle: "Encrypt File",
    decryptTitle: "Decrypt File",
    dropText: "Drop file here or click to select",
    addPass: "Add password",
    encryptBtn: "Encrypt",
    decryptBtn: "Decrypt",
    modeEncrypt: "Encrypt",
    modeDecrypt: "Decrypt",
    supportBtn: "Support via USDT"
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
    encryptTitle: "Зашифровать файл",
    decryptTitle: "Расшифровать файл",
    dropText: "Перетащите файл сюда или нажмите для выбора",
    addPass: "Добавить пароль",
    encryptBtn: "Зашифровать",
    decryptBtn: "Расшифровать",
    modeEncrypt: "Шифровать",
    modeDecrypt: "Расшифровать",
    supportBtn: "Поддержать USDT"
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
let selectedFile = null;

function log(msg) {
  terminal.textContent += msg + '\n';
  terminal.scrollTop = terminal.scrollHeight;
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('hover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('hover');
  const f = e.dataTransfer.files[0];
  if (f) {
    selectedFile = f;
    log('File selected: ' + f.name);
  }
});

fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) {
    selectedFile = f;
    log('File selected: ' + f.name);
  }
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
}

modeEncrypt.addEventListener('click', () => setMode('encrypt'));
modeDecrypt.addEventListener('click', () => setMode('decrypt'));

async function encryptFile() {
  if (!selectedFile) { log('No file selected'); return; }
  const pwEls = passwordsDiv.querySelectorAll('input');
  const pw = Array.from(pwEls).map(i => i.value).filter(Boolean).join('\u0000');
  if (!pw) { log('No passwords provided'); return; }
  log('Encrypting ' + selectedFile.name + ' ...');
  try {
    const data = new Uint8Array(await selectedFile.arrayBuffer());
    const enc = new TextEncoder();
    const pwKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, pwKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const ext = selectedFile.name.split('.').pop() || '';
    const extBytes = new TextEncoder().encode(ext);
    if (extBytes.length > 255) { log('Extension too long'); return; }
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
    const chunkSize = 2500;
    const zip = new JSZip();
    const folder = zip.folder('QR-коды');
    let count = 0;
    for (let i = 0; i < base64.length; i += chunkSize) {
      const chunk = base64.slice(i, i + chunkSize);
      const dataUrl = await QRCode.toDataURL(chunk);
      folder.file(`qr-${++count}.png`, dataUrl.split(',')[1], { base64: true });
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'swapinterfaces.zip';
    a.click();
    log('Encryption complete. QR codes: ' + count);
  } catch (e) {
    log('Error: ' + e.message);
  }
}
async function decryptFile() {
  if (!selectedFile) { log('No file selected'); return; }
  const pwEls = passwordsDiv.querySelectorAll('input');
  const pw = Array.from(pwEls).map(i => i.value).filter(Boolean).join('\u0000');
  if (!pw) { log('No passwords provided'); return; }
  log('Decrypting ' + selectedFile.name + ' ...');
  try {
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
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
    const blob = new Blob([plain]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'decoded' + (ext ? '.' + ext : '');
    a.click();
    log('Decryption complete. Extension: ' + (ext ? '.' + ext : 'none'));
  } catch (e) {
    log('Error: ' + e.message);
  }
}

const USDT_ADDRESS = '0xa8b3A40008EDF9AF21D981Dc3A52aa0ed1cA88fD';
supportBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(USDT_ADDRESS).then(() => {
    log('USDT address copied');
  });
});

actionBtn.addEventListener('click', () => {
  if (mode === 'encrypt') encryptFile();
  else decryptFile();
});

setMode('encrypt');
