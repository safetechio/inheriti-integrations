# GridCraft optional spreadsheet adapter

This recipe packages the official GridCraft 0.8.0 Linux x86_64 or aarch64
tarball as a signed Workspace adapter. Both release assets are pinned to SHA256:

| Guest architecture | SHA256 |
| --- | --- |
| x86_64 | `4a029e20da86bad46706339ce4516a20445c131c0d82f6a114772208c5d831b3` |
| aarch64 | `0d4c882acdcfd4b5721a6dd1ec74c98ce0fb160d0231973a69475da6ec9e8e7d` |

The archive is verified and safely extracted. The application runs only inside
the Workspace VM; runtime libraries come from a matching guest build, never
from the user's host. The base guest image is not changed.

The guest target must contain X11, xkbcommon, and a Mesa EGL rendering
stack. A separate GridCraft profile extends a disposable Gnumeric optional
Buildroot output with xkbcommon and Mesa EGL/ES software rendering. It leaves
the base guest configuration intact and limits internal build jobs to one:

```sh
python3 scripts/optional-adapter/recipes/gridcraft/prepare_profile.py \
  --buildroot /path/to/buildroot-2026.08 --output /path/to/optional-output
make -C /path/to/buildroot-2026.08 O=/path/to/optional-output \
  BR2_EXTERNAL="$PWD/guest:$PWD/scripts/optional-adapter/recipes/gnumeric/buildroot-external" \
  -j1 libxkbcommon mesa3d-reconfigure
```

The recipe packages the graphical binary, its release data, verified guest ELF
dependency closure, and guest Mesa DRI drivers. A successful package build
alone does not prove that GridCraft displays spreadsheets in the VM.

```sh
python3 scripts/optional-adapter/recipes/gridcraft/build.py \
  --archive /path/to/gridcraft-0.8.0-linux-x86_64.tar.gz \
  --target /path/to/gridcraft-guest-output/target \
  --output /path/to/artifacts --key /secure/release-ed25519-private.pem \
  --version 0.8.0 --arch x86_64 \
  --url https://releases.example.org/gridcraft-0.8.0-x86_64.ext4
```

For an aarch64 guest, supply the official `gridcraft-0.8.0-linux-aarch64.tar.gz`,
`--arch aarch64`, and an aarch64 guest target with its own EGL/DRI libraries.
The recipe rejects an x86_64 executable or runtime library in that package.
The aarch64 packaging path has source-level tests; a native ARM VM display test
is still required before distributing an ARM adapter.

The HTTPS URL above is a placeholder. Distribution requires publishing the
signed ext4 and adding its manifest to the trusted application registry.
Run the focused checks with
`python3 -m unittest tests.scripts.test_gridcraft_recipe -v`.
