import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = path.resolve(viewer, "../../packages/core/assets");
const destination = path.join(viewer, "ui/assets");

await mkdir(destination, { recursive: true });
for (const asset of [
  "font-app.ttf",
  "brand/inheriti-logo-full-color.svg",
  "brand/inheriti-brandmark-full-color.svg",
]) {
  await copyFile(
    path.join(shared, asset),
    path.join(destination, path.basename(asset)),
  );
}
