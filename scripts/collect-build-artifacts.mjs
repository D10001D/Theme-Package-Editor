import { cp, mkdir, readdir, rm, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.resolve(rootDir, "..", "build");
const mode = process.argv[2] || "all";
const targetTriple = process.argv[3] || "";

const bundleCandidates = [
  targetTriple && path.join(rootDir, "src-tauri", "target", targetTriple, "release", "bundle"),
  path.join(rootDir, "src-tauri", "target", "universal-apple-darwin", "release", "bundle"),
  path.join(rootDir, "src-tauri", "target", "release", "bundle")
].filter(Boolean);

const isDirectory = async targetPath => {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
};

const isFile = async targetPath => {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
};

await mkdir(buildDir, { recursive: true });

let bundleDir = null;
for (const candidate of bundleCandidates) {
  if (await isDirectory(candidate)) {
    bundleDir = candidate;
    break;
  }
}

if (!bundleDir) {
  throw new Error("No Tauri bundle directory found.");
}

const macosDir = path.join(bundleDir, "macos");
const dmgDir = path.join(bundleDir, "dmg");

if (await isDirectory(macosDir)) {
  const buildEntries = await readdir(buildDir);
  for (const entry of buildEntries) {
    if (!entry.endsWith(".app")) continue;
    await rm(path.join(buildDir, entry), { recursive: true, force: true });
  }

  const entries = await readdir(macosDir);
  for (const entry of entries) {
    if (!entry.endsWith(".app")) continue;
    await cp(path.join(macosDir, entry), path.join(buildDir, entry), { recursive: true });
  }
}

if (mode !== "app" && await isDirectory(dmgDir)) {
  const buildEntries = await readdir(buildDir);
  for (const entry of buildEntries) {
    if (!entry.endsWith(".dmg")) continue;
    await rm(path.join(buildDir, entry), { force: true });
  }

  const entries = await readdir(dmgDir);
  for (const entry of entries) {
    if (!entry.endsWith(".dmg")) continue;
    const source = path.join(dmgDir, entry);
    if (await isFile(source)) {
      await cp(source, path.join(buildDir, entry));
    }
  }
}

console.log(`Artifacts collected from ${bundleDir} to ${buildDir}`);
