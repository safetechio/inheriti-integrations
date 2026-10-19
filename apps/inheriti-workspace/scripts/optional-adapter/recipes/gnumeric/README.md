# Gnumeric optional spreadsheet application

This recipe builds **Gnumeric 1.12.62** for the Workspace Linux guest from
official GNOME source, together with **GOffice 0.10.62** and **libGSF 1.14.60**.
The tarball hashes are pinned in the Buildroot external packages. The optional
profile adds GTK3 with X11 and Mesa softpipe; it is not part of the base guest
configuration. The three GNOME packages install under `/opt/workspace/apps` so
their files can be packaged separately from the guest image.
The optional package omits translated help files. They are unnecessary to open
spreadsheets and would otherwise require an additional host documentation tool.

Use the same Buildroot release and toolchain as the guest. Start from a copied
Buildroot output directory with enough disk space, or use a disposable output
directory dedicated to this optional package. `prepare_profile.py` backs up
that output's `.config` before enabling the optional profile:

```sh
python3 scripts/optional-adapter/recipes/gnumeric/prepare_profile.py \
  --buildroot /path/to/buildroot-2026.08 --output /path/to/optional-output
make -C /path/to/buildroot-2026.08 O=/path/to/optional-output \
  BR2_EXTERNAL="$PWD/guest:$PWD/scripts/optional-adapter/recipes/gnumeric/buildroot-external" \
  -j1 workspace-gnumeric
```

After a successful build, sign the guest-compatible binary and runtime closure
with an external Ed25519 release key. The URL must identify the published ext4
image exactly; no signing key or host distribution package enters the image.

```sh
python3 scripts/optional-adapter/recipes/gnumeric/build.py \
  --target /path/to/optional-output/target --output /path/to/artifacts \
  --key /secure/release-ed25519-private.pem --arch x86_64 --version 1.12.62 \
  --url https://releases.example.org/gnumeric-1.12.62-x86_64.ext4
```

`build.py` requires the real guest-built `/opt/workspace/apps/bin/gnumeric`,
copies its installed data and shared libraries, checks every ELF architecture,
and fails if a dependency is missing or a file resolves outside the guest
target. The generic package builder signs the manifest and verifies the ext4.
The package's `spreadsheet` family covers XLSX and CSV through the existing
validated format catalog. Run focused recipe tests with
`python3 -m unittest tests.scripts.test_gnumeric_recipe -v`. Set
`WORKSPACE_GNUMERIC_TARGET=/path/to/optional-output/target` to include the
real guest ELF closure check.

The package is usable only after a real guest graphical run verifies opening
and navigating XLSX and CSV. A successful Buildroot build or signed ext4 alone
does not establish that runtime behavior.
The example HTTPS URL is a placeholder; production on-demand retrieval also
requires publishing the signed image and adding its manifest to the trusted
application registry.
