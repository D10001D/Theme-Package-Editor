import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const distDir = path.join(rootDir, "dist");
const vendorDir = path.join(distDir, "vendor");
const sourceHtmlPath = path.join(frontendDir, "index.html");
const sourceCssPath = path.join(frontendDir, "styles.css");
const sourceJsPath = path.join(frontendDir, "app.js");
const sourceLogoPath = path.join(frontendDir, "logo.svg");
const distHtmlPath = path.join(distDir, "index.html");
const distCssPath = path.join(distDir, "styles.css");
const distJsPath = path.join(distDir, "app.js");
const distLogoPath = path.join(distDir, "logo.svg");
const vendorAssets = [
  {
    devPath: "../node_modules/jszip/dist/jszip.min.js",
    distPath: "./vendor/jszip.min.js",
    sourcePath: path.join(rootDir, "node_modules", "jszip", "dist", "jszip.min.js")
  },
  {
    devPath: "../node_modules/codemirror/lib/codemirror.css",
    distPath: "./vendor/codemirror.css",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "lib", "codemirror.css")
  },
  {
    devPath: "../node_modules/codemirror/theme/monokai.css",
    distPath: "./vendor/codemirror-monokai.css",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "theme", "monokai.css")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/show-hint.css",
    distPath: "./vendor/codemirror-show-hint.css",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "show-hint.css")
  },
  {
    devPath: "../node_modules/codemirror/lib/codemirror.js",
    distPath: "./vendor/codemirror.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "lib", "codemirror.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/xml/xml.js",
    distPath: "./vendor/codemirror-xml-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "xml", "xml.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/javascript/javascript.js",
    distPath: "./vendor/codemirror-javascript-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "javascript", "javascript.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/css/css.js",
    distPath: "./vendor/codemirror-css-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "css", "css.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/htmlmixed/htmlmixed.js",
    distPath: "./vendor/codemirror-htmlmixed-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "htmlmixed", "htmlmixed.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/markdown/markdown.js",
    distPath: "./vendor/codemirror-markdown-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "markdown", "markdown.js")
  },
  {
    devPath: "../node_modules/codemirror/mode/properties/properties.js",
    distPath: "./vendor/codemirror-properties-mode.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "mode", "properties", "properties.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/fold/xml-fold.js",
    distPath: "./vendor/codemirror-xml-fold.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "fold", "xml-fold.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/edit/closebrackets.js",
    distPath: "./vendor/codemirror-closebrackets.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "edit", "closebrackets.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/edit/matchbrackets.js",
    distPath: "./vendor/codemirror-matchbrackets.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "edit", "matchbrackets.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/edit/matchtags.js",
    distPath: "./vendor/codemirror-matchtags.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "edit", "matchtags.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/edit/closetag.js",
    distPath: "./vendor/codemirror-closetag.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "edit", "closetag.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/comment/comment.js",
    distPath: "./vendor/codemirror-comment.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "comment", "comment.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/show-hint.js",
    distPath: "./vendor/codemirror-show-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "show-hint.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/xml-hint.js",
    distPath: "./vendor/codemirror-xml-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "xml-hint.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/html-hint.js",
    distPath: "./vendor/codemirror-html-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "html-hint.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/css-hint.js",
    distPath: "./vendor/codemirror-css-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "css-hint.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/javascript-hint.js",
    distPath: "./vendor/codemirror-javascript-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "javascript-hint.js")
  },
  {
    devPath: "../node_modules/codemirror/addon/hint/anyword-hint.js",
    distPath: "./vendor/codemirror-anyword-hint.js",
    sourcePath: path.join(rootDir, "node_modules", "codemirror", "addon", "hint", "anyword-hint.js")
  },
  {
    devPath: "../node_modules/js-beautify/js/lib/beautifier.min.js",
    distPath: "./vendor/js-beautify.min.js",
    sourcePath: path.join(rootDir, "node_modules", "js-beautify", "js", "lib", "beautifier.min.js")
  }
];

await rm(distDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });

const sourceHtml = await readFile(sourceHtmlPath, "utf8");
let distHtml = sourceHtml;
for (const asset of vendorAssets) {
  if (!sourceHtml.includes(asset.devPath)) {
    throw new Error(`Expected vendor source path "${asset.devPath}" in ${sourceHtmlPath}`);
  }
  distHtml = distHtml.replaceAll(asset.devPath, asset.distPath);
}
await writeFile(distHtmlPath, distHtml);
await cp(sourceCssPath, distCssPath);
await cp(sourceJsPath, distJsPath);
await cp(sourceLogoPath, distLogoPath);
for (const asset of vendorAssets) {
  await cp(asset.sourcePath, path.join(vendorDir, path.basename(asset.distPath)));
}
