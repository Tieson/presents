// Builds a ready-to-upload folder for PHP hosting:  npm run build:php  →  build/php/
// Frontend is built by Vite (same as for Vercel), the PHP backend is copied next to it.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "php");

fs.rmSync(out, { recursive: true, force: true });
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, XD_OUT: "build/php" } });

for (const f of fs.readdirSync(path.join(root, "php"))) {
  if (f === "config.php") continue; // never ship local credentials
  fs.cpSync(path.join(root, "php", f), path.join(out, f), { recursive: true });
}

console.log(`
✔ build/php je připravený k nahrání na hosting.
  1. Nahraj obsah složky build/php (včetně .htaccess) přes FTP.
  2. Na serveru zkopíruj config.sample.php → config.php a vyplň ADMIN_PASSWORD a APP_SECRET.
`);
