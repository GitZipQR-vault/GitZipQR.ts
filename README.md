# GZIP

**Offline Archive Encoding via QR Fragments**  
> A resilient post-digital backup system for total data survival

---

## 📦 What is this?

**GZIP** is a CLI tool that lets you archive any folder into QR-code chunks, store them offline (on paper or as PNG images), and later restore the exact archive using just those fragments — even without internet access.

Ideal for:
- Post-apocalyptic backups  
- Fully offline systems  
- Paper-based archive storage  
- High-integrity digital preservation  

---

## ⚙️ How it works

### 1. Encode archive to QR + JSON

```bash
./bin/gitrip encode ./my-folder
```

### 2. Decode fragments back to archive
```bash
./bin/gitrip decode ./fragments/*
```


---

## ✅ Features

- 🧾 JSON-fragmented archive with hashes  
- 📷 Printable QR-codes (offline-ready)  
- 🔐 SHA256 integrity validation  
- 📡 Works fully offline  

---

## 🛠 Requirements

- Node.js or Bun  
- Run `npm install` before using  

---

## 🔜 Roadmap

- [x] Archive encoder to JSON + QR  
- [x] CLI interface  
- [ ] PDF generator (QR print sheets)  
- [ ] AES-256 optional encryption  
- [ ] GUI/TUI interface  

---

## 🧠 Why it matters

> If GitHub can store Linux in Arctic ice,  
> you can store your own code in QR fire.
