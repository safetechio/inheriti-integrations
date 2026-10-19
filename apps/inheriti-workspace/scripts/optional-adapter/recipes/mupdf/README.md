# MuPDF optional application

This recipe packages `mupdf-x11` from a **Buildroot guest target** as a signed
PDF adapter. It follows the target's ELF dependencies and copies the resolved
guest libraries into the adapter; it does not use host distribution packages.

Build the guest first. Keep the Ed25519 private key outside the repository and
the staged application. For a local test, generate a disposable key with
`openssl genpkey -algorithm Ed25519 -out /tmp/workspace-adapter-test-key.pem`.
The guest must contain the corresponding public key.

```sh
python3 scripts/optional-adapter/recipes/mupdf/build.py \
  --target /path/to/buildroot/output/target \
  --output /path/to/output-directory \
  --key /path/to/ed25519-private.pem \
  --arch x86_64 --version 1.0 \
  --url https://example.org/workspace/mupdf-1.0-x86_64.ext4
```

The recipe creates an ext4 image, signed manifest, and signature. The URL must
identify the immutable image bytes published by the distributor. The launcher
uses the adapter's own dynamic loader and libraries inside the disposable guest VM.
`readelf`, OpenSSL, `mkfs.ext4`, and `e2fsck` are needed on the packaging host.
This recipe currently verifies ELF dependencies; a real VM launch and PDF
rendering test are still required for each guest build and architecture.
