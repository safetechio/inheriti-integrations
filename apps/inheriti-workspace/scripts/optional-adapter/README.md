# Optional application package builder

Stage a guest-compatible Linux application under a directory containing `family` (one lowercase family name and newline), executable `bin/launch`, and the application's runtime files. The application and its libraries must match the Workspace guest architecture. This builder packages files; it does not compile or install the application.

```sh
python3 scripts/optional-adapter/build.py \
  --stage /path/to/staged-app --output /path/to/artifacts \
  --id abiword --version 1.0 --arch x86_64 --family document \
  --url https://releases.example.org/abiword-1.0-x86_64.ext4 \
  --max-bytes 134217728 --key /secure/release-ed25519-private.pem
```

The output is an ext4 image, canonical signed manifest, and raw 64-byte Ed25519 signature. Publish the image at the exact manifest URL and make the manifest and signature available to the trusted application registry. Keep the private key outside this repository. The VM needs the matching public key before it can mount the image.

Run the local contract tests with `python3 -m unittest tests.scripts.test_optional_adapter_builder -v` from the Workspace directory. The tests use a temporary key and tiny launcher; they do not prove that AbiWord or Gnumeric runs inside the VM.
