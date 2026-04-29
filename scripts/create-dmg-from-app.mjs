import { mkdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const targetTriple = process.argv[2] || "universal-apple-darwin";
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
const productName = tauriConfig.productName || "Theme Package Editor";
const version = tauriConfig.version || "1.0.0";
const bundleRoot = path.join(rootDir, "src-tauri", "target", targetTriple, "release", "bundle");
const appPath = path.join(bundleRoot, "macos", `${productName}.app`);
const dmgDir = path.join(bundleRoot, "dmg");
const dmgPath = path.join(dmgDir, `${productName}_${version}_universal.dmg`);

const appExists = await stat(appPath).then(value => value.isDirectory()).catch(() => false);
if (!appExists) {
  throw new Error(`App bundle not found: ${appPath}`);
}

await mkdir(dmgDir, { recursive: true });
await rm(dmgPath, { force: true });

await new Promise((resolve, reject) => {
  const child = spawn("hdiutil", [
    "create",
    "-volname", productName,
    "-srcfolder", appPath,
    "-ov",
    "-format", "UDZO",
    dmgPath
  ], {
    cwd: rootDir,
    stdio: "inherit"
  });

  child.on("exit", code => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`hdiutil create exited with code ${code}`));
    }
  });

  child.on("error", reject);
});

console.log(`DMG created at ${dmgPath}`);
