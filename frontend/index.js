const translations = {
  en: {
    title: "GitZipQR",
    tagline: "Secure archives through QR-coded encryption",
    intro: "GitZipQR turns a folder into a deterministic ZIP, encrypts it with AES-256-GCM and stores the ciphertext inside QR codes.",
    step1: "Zip the folder with normalized timestamps",
    step2: "Derive a key via scrypt and encrypt with AES-256-GCM",
    step3: "Split the ciphertext into QR-sized chunks",
    step4: "Embed each chunk directly into a QR image (base64 payload)",
    step5: "To restore, scan all QR codes and decrypt using the same password"
  },
  ru: {
    title: "GitZipQR",
    tagline: "Безопасные архивы через QR-коды",
    intro: "GitZipQR превращает папку в детерминированный ZIP, шифрует его AES-256-GCM и сохраняет шифртекст внутри QR-кодов.",
    step1: "Архивируйте папку с нормализованными отметками времени",
    step2: "Получите ключ через scrypt и зашифруйте AES-256-GCM",
    step3: "Разделите шифртекст на части размером с QR-код",
    step4: "Встроите каждую часть непосредственно в изображение QR (base64)",
    step5: "Для восстановления отсканируйте все QR-коды и расшифруйте тем же паролем"
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
