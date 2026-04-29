import { cp, mkdir, rm } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const vendorDir = path.join(distDir, "vendor");

await rm(distDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });

await cp(path.join(rootDir, "theme-package-editor.html"), path.join(distDir, "index.html"));
await cp(path.join(rootDir, "node_modules", "jszip", "dist", "jszip.min.js"), path.join(vendorDir, "jszip.min.js"));
