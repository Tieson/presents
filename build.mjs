// Builds deployable folders:  node build.mjs
//   dist/node  – Node.js server + Vercel project (frontend in public/)
//   dist/php   – upload to any PHP 7.4+ hosting with Apache (mod_rewrite)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const skip = new Set(["node_modules", "data", ".env", "config.php", ".vercel"]);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

fs.rmSync(dist, { recursive: true, force: true });

copyDir(path.join(root, "node"), path.join(dist, "node"));
copyDir(path.join(root, "web"), path.join(dist, "node", "public"));

copyDir(path.join(root, "php"), path.join(dist, "php"));
copyDir(path.join(root, "web"), path.join(dist, "php"));

console.log("✔ dist/node  (npm install && npm start, nebo deploy na Vercel)");
console.log("✔ dist/php   (nahraj obsah složky na hosting, zkopíruj config.sample.php → config.php)");
