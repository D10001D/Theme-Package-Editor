import { spawn } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");
const rustupHome = path.join(os.homedir(), ".rustup-theme-package-editor");
const mode = process.argv[2] === "app" ? "app" : "all";

const env = {
  ...process.env,
  RUSTUP_HOME: rustupHome,
  PATH: `${cargoBinDir}:${process.env.PATH || ""}`
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: "inherit",
      shell: false,
      ...options
    });

    child.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

await run("rustup", ["toolchain", "install", "stable-x86_64-apple-darwin", "--profile", "minimal"]);
await run("rustup", ["target", "add", "x86_64-apple-darwin", "aarch64-apple-darwin", "--toolchain", "stable-x86_64-apple-darwin"]);

await run("npx", ["tauri", "build", "--target", "universal-apple-darwin", "--bundles", "app"]);

if (mode !== "app") {
  await run("node", ["./scripts/create-dmg-from-app.mjs", "universal-apple-darwin"]);
}

await run("node", ["./scripts/collect-build-artifacts.mjs", mode, "universal-apple-darwin"]);
