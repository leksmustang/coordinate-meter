"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "www");
const destination = path.join(root, "android", "app", "src", "main", "assets", "public");
const assetsRoot = path.join(root, "android", "app", "src", "main", "assets");

if (!destination.startsWith(`${assetsRoot}${path.sep}`)) throw new Error("Unexpected Android assets path");
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });
fs.copyFileSync(path.join(root, "capacitor.config.json"), path.join(assetsRoot, "capacitor.config.json"));

console.log("Android web assets synchronized.");
