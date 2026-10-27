// npm test                      → starts the Node API on a temp data dir and runs tests/api.mjs
// npm test -- <url> <password>  → runs the same tests against any running backend (e.g. PHP)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../tests/api.mjs";

let [url, password] = process.argv.slice(2);
let server, tmp;

if (!url) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xd-test-"));
  password = "test-heslo";
  Object.assign(process.env, { STORAGE: "fs", DATA_DIR: tmp, ADMIN_PASSWORD: password, APP_SECRET: "test-secret" });
  const { handleApi } = await import("../server/node-adapter.js");
  server = http.createServer((req, res) => handleApi(req, res).catch(e => { console.error(e); res.end(); }));
  await new Promise(r => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
}

console.log(`API testy proti ${url}\n`);
const { passed, failed } = await run(url, password || process.env.ADMIN_PASSWORD);
console.log(`\n${passed} prošlo, ${failed} selhalo`);

server?.close();
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
