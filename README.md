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
graph LR
A[Source Directory] -->|Encode| B(QR Codes)
A -->|Encode| C(JSON Fragments)
B -->|Decode| D[Fragment Metadata]
C -->|Read| E[Data Chunks]
D --> F[Locate Fragments]
E --> G[Reassemble Archive]
F --> G
G --> H[Restored Files]