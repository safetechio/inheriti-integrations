# Experimental VirGL guest profile

This optional profile adds Mesa's VirGL guest driver and Wayland EGL support to
a disposable GridCraft Buildroot output. It preserves the software renderer and
leaves the base VM configuration untouched. Apply it only after GridCraft's
optional profile, using the same Buildroot source and output directory:

```sh
python3 scripts/optional-adapter/recipes/gridcraft/virgl/prepare_profile.py \
  --buildroot /path/to/buildroot-2026.08 --output /path/to/optional-output
make -C /path/to/buildroot-2026.08 O=/path/to/optional-output \
  BR2_EXTERNAL="$PWD/guest:$PWD/scripts/optional-adapter/recipes/gnumeric/buildroot-external" \
  -j1 wayland mesa3d-dirclean mesa3d libepoxy-reconfigure \
  xserver_xorg-server-dirclean xserver_xorg-server
make -C /path/to/buildroot-2026.08 O=/path/to/optional-output \
  BR2_EXTERNAL="$PWD/guest:$PWD/scripts/optional-adapter/recipes/gnumeric/buildroot-external" \
  -j1
```

Rebuilding Mesa after enabling Wayland ensures its EGL dependencies and GBM DRI
backend are installed in the guest target. Rebuilding Xorg is necessary when
EGL/GL and libepoxy were enabled after Xorg was initially built: an older Xorg
binary may have DRI3 but still carry `--disable-glamor`. The profile applies a
scoped Xorg patch that links the modesetting driver to GBM; otherwise the module
cannot resolve `gbm_bo_get_offset`. The final full make refreshes the disposable
initramfs. Package GridCraft using that output's `target` directory so the
signed adapter contains `gbm/dri_gbm.so` and the guest ELF closure, including
`libwayland-client.so.0` and `libffi.so.8` when required by `libEGL.so.1`.

The VirGL **guest driver alone is insufficient**. QEMU must provide a VirGL
capable virtual GPU and a working host renderer; the VM needs its DRM driver
and access to the render device. Verify these independently before claiming
GridCraft displays correctly. This profile is an experiment, not a product
default or a change to the VM isolation policy.
