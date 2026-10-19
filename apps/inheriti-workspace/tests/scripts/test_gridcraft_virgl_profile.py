"""Focused checks for the disposable GridCraft VirGL guest profile."""

import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / (
    "scripts/optional-adapter/recipes/gridcraft/virgl/prepare_profile.py"
)
spec = importlib.util.spec_from_file_location("gridcraft_virgl_profile", SCRIPT)
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


class VirglProfileTests(unittest.TestCase):
    def test_adds_virgl_without_removing_software_renderer(self):
        before = "\n".join(
            [*(f"{key}=y" for key in profile.REQUIRED),
             f"# {profile.SELECT} is not set", "BR2_JLEVEL=4",
             "BR2_PACKAGE_WORKSPACE_AGENT=y"]
        )
        after = profile.selected_config(before)
        self.assertIn(f"{profile.SELECT}=y", after)
        self.assertIn(f"{profile.WAYLAND}=y", after)
        self.assertIn("BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE=y", after)
        self.assertIn("BR2_PACKAGE_WORKSPACE_AGENT=y", after)
        self.assertIn("BR2_JLEVEL=1", after)
        self.assertNotIn("BR2_JLEVEL=4", after)
        self.assertIn(f'BR2_GLOBAL_PATCH_DIR="{profile.PATCH_DIR}"', after)


if __name__ == "__main__":
    unittest.main()
