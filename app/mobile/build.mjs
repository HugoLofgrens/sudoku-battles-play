// Copies the web client into www/ for the apps and points it at the live server.
//   SERVER_URL=https://play.example.com [PUBLIC_URL=https://play.example.com/] node build.mjs
import { cpSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const server = (process.env.SERVER_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(server)) {
  console.error('Set SERVER_URL to the game server, e.g. SERVER_URL=https://play.example.com');
  process.exit(1);
}
const publicUrl = process.env.PUBLIC_URL || server + '/';

rmSync(here('www'), { recursive: true, force: true });
mkdirSync(here('www'));
cpSync(here('../client'), here('www/client'), { recursive: true });
cpSync(here('../shared'), here('www/shared'), { recursive: true });
copyFileSync(here('../client/index.html'), here('www/index.html'));
writeFileSync(here('www/client/config.js'),
  `// Written by mobile/build.mjs\nexport const SERVER_URL = ${JSON.stringify(server)};\nexport const PUBLIC_URL = ${JSON.stringify(publicUrl)};\n`);
console.log(`www/ built for ${server}`);
