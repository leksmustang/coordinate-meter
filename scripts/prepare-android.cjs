"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "www");
const files = ["styles.css", "core.js", "app.js"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, "vendor"), path.join(output, "vendor"), { recursive: true });
fs.mkdirSync(path.join(output, "assets"), { recursive: true });
fs.copyFileSync(path.join(root, "assets", "yandex-maps-logo.svg"), path.join(output, "assets", "yandex-maps-logo.svg"));

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace('<script src="app.js"></script>', '<script src="mobile-bridge.js"></script>\n  <script src="app.js"></script>');
fs.writeFileSync(path.join(output, "index.html"), html);

esbuild.buildSync({
  entryPoints: [path.join(root, "mobile", "bridge.js")],
  outfile: path.join(output, "mobile-bridge.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome60"],
  minify: true,
  sourcemap: false
});

console.log(`Android web assets prepared in ${output}`);
