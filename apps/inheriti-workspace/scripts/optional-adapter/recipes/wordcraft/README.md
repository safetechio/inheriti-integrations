# WordCraft optional document adapter

This recipe packages the official WordCraft 0.8.0 Linux tarball as a signed,
on-demand Workspace adapter. The verified release checksums are:

| VM architecture | SHA256 |
| --- | --- |
| x86_64 | `0ece07cf3d91b923dfd80f90310e04983bde66f0279c6b60ddce89596dde0ddf` |
| aarch64 | `a862de2256e43c987dc8ea009ba52ac25db34091fd649b666133931ac68e02cc` |

Use the separate VirGL VM target prepared for GridCraft. The package contains
WordCraft and its release data, a guest-only ELF library closure, and guest
Mesa drivers. It does not use programs or libraries installed on the host.
The base VM image remains unchanged.

```sh
python3 scripts/optional-adapter/recipes/wordcraft/build.py \
  --archive /path/to/wordcraft-0.8.0-linux-x86_64.tar.gz \
  --target /path/to/virgl-guest-output/target \
  --output /path/to/artifacts --key /secure/release-ed25519-private.pem \
  --version 0.8.0 --arch x86_64 \
  --url https://releases.example.org/wordcraft-0.8.0-x86_64.ext4
```

The URL is a placeholder. Distribute the signed artifact only after native VM
opening tests and publication through the trusted adapter registry. For ARM,
use the official `wordcraft-0.8.0-linux-aarch64.tar.gz` and a matching aarch64
VirGL target; the recipe rejects mixed architectures.

Run `python3 -m unittest tests.scripts.test_wordcraft_recipe -v` for the
recipe contract checks.
