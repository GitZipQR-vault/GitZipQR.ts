# GitRip: Archive Distribution via QR Codes

## GitRip encodes files/directories into multiple QR codes for physical storage or distribution. Each QR contains metadata pointing to a JSON fragment with actual data chunks. The system supports both digital and physical restoration.
# Key Features:
- 🔐 SHA-256 integrity checks
-  📦 Automatic archive splitting
- 🧩 Dual storage (QR images + JSON fragments)
- 🔍 QR metadata recovery system

# How Using?

```bash
git clone git@github.com:RestlessByte/gitzip.git
cd gitzip
bun install
mkdir -p example/gitzip
bun encode example
```

```bash
bun decode fragments/*
```
*** FILE STRUCTIRES**
gitzip/
├── qrcodes/       # QR images with metadata pointers
│   ├── qr-0000.png [SCAN OUTPUT JSON FOR DECODE]
│   └── ...
└── fragments/     # JSON files with base64 data 
    ├── fragment-0000.json [INPUT FROM COMMAND **bun decode fragment-0000.json**]
    └── ...