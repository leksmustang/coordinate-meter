"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stage = path.join(root, ".windows-build-app");
if (path.dirname(stage) !== root || path.basename(stage) !== ".windows-build-app") {
  throw new Error("Небезопасный путь временной Windows-сборки.");
}
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(path.join(stage, "node_modules"), { recursive: true });

for (const entry of ["electron", "vendor", "assets", "index.html", "styles.css", "core.js", "app.js"]) {
  fs.cpSync(path.join(root, entry), path.join(stage, entry), { recursive: true });
}

const sourcePackage = require(path.join(root, "package.json"));
const electronPackage = require(path.join(root, "node_modules", "electron", "package.json"));
const stagedPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  main: sourcePackage.main,
  description: sourcePackage.description,
  author: sourcePackage.author,
  dependencies: {},
  devDependencies: {},
  build: {
    ...sourcePackage.build,
    electronVersion: electronPackage.version,
    npmRebuild: false,
    directories: { output: "dist" },
    files: ["electron/**/*", "vendor/**/*", "assets/**/*", "index.html", "styles.css", "core.js", "app.js", "package.json"]
  }
};
fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(stagedPackage, null, 2)}\n`);
fs.writeFileSync(path.join(stage, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n");
fs.writeFileSync(path.join(stage, "pnpm-workspace.yaml"), "packages: []\n");
console.log(stage);
