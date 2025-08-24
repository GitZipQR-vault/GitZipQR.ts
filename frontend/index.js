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
    dropText: "Drop file here or click to select",
    addPass: "Add password",
    encryptBtn: "Encrypt"
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
    dropText: "Перетащите файл сюда или нажмите для выбора",
    addPass: "Добавить пароль",
    encryptBtn: "Зашифровать"
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
    langMenu.classList.add('hidden');
  });
});

// set default language
applyLang('en');

/* ---------------- Encryption UI ---------------- */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const addPassword = document.getElementById('addPassword');
const encryptBtn = document.getElementById('encryptBtn');
const terminal = document.getElementById('terminal');
const passwordsDiv = document.querySelector('.passwords');
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
    const out = new Uint8Array(salt.length + iv.length + cipher.byteLength);
    out.set(salt, 0);
    out.set(iv, salt.length);
    out.set(new Uint8Array(cipher), salt.length + iv.length);
    log('Encryption complete. Bytes: ' + out.length);
  } catch (e) {
    log('Error: ' + e.message);
  }
}

encryptBtn.addEventListener('click', encryptFile);
