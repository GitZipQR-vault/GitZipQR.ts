# 🗂️ GitZipQR: Archive Distribution via QR Codes
# 🕵️‍♂️ Privacy share data through QR codes
## 🗄️GitZipQR encodes files/directories into multiple QR codes for physical storage or distribution. Each QR contains metadata pointing to a JSON fragment with actual data chunks. The system supports both digital and physical restoration.
# Key Features:
- 🔐 SHA-256 integrity checks
-  📦 Automatic archive splitting
- 🧩 Dual storage (QR images + JSON fragments)
- 🔍 QR metadata recovery system

# How Using?
**2 ARGUMENTS (path, name-tag)**
```bash
git clone git@github.com:RestlessByte/gitzip.git
cd gitzip
bun install
mkdir -p example/gitzip
bun encode example example
```

```bash
bun decode example/fragments/* 
```
# FILE STRUCTIRES
<img src='https://raw.githubusercontent.com/RestlessByte/gitzip/refs/heads/main/assets/structures/structures.png' width=550 height=550 alt='no image'/>

# Docs

- **/fragments** - dir with JSON data for decode
- **/qrcodes** - dir with QR-codes during is scan output JSON data for decode data