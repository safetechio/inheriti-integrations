# mpv optional video adapter

This recipe packages Buildroot **mpv 0.40.0** for the Workspace Linux virtual
machine. It runs inside the isolated session with X11 software video output,
without network access or a host application fallback. FilmCraft is a video
editor and is not needed for this playback adapter.

Use a disposable Buildroot output based on the same guest toolchain. The profile
adds mpv and its Buildroot-selected FFmpeg, libass, and libplacebo dependencies;
it is not part of the base guest image. Limit the build to one job to reduce RAM
pressure.

```sh
python3 scripts/optional-adapter/recipes/mpv/prepare_profile.py \
  --buildroot /path/to/buildroot-2026.08 --output /path/to/optional-output
make -C /path/to/buildroot-2026.08 O=/path/to/optional-output \
  BR2_EXTERNAL="$PWD/guest" -j1 mpv
python3 scripts/optional-adapter/recipes/mpv/build.py \
  --target /path/to/optional-output/target --output /path/to/artifacts \
  --key /secure/release-ed25519-private.pem --arch x86_64 --version 0.40.0 \
  --url https://releases.example.org/mpv-0.40.0-x86_64.ext4
```

The packager accepts only guest ELF files, checks their architecture and shared
library closure, then creates a signed ext4 image with the common adapter
builder. Keep the release key outside the repository. The HTTPS URL above is a
placeholder; publishing a trusted manifest is required before on-demand use.

The launcher uses software video output and mutes audio. The guest ingress
contract accepts files up to 16 MiB. Validate package size, memory use,
playback, seeking and session teardown with the shared MP4/WebM fixtures
before publishing a release.

Run recipe checks with `python3 -m unittest tests.scripts.test_mpv_recipe -v`.
