// Copies the web client into www/ for the apps.
//   SERVER_URL=https://play.example.com node build.mjs   -> the app connects there
//   node build.mjs                                       -> the app asks for an address (LAN play)
import { cpSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const server = (process.env.SERVER_URL || '').replace(/\/+$/, '');
if (server && !/^https?:\/\/[^/]+$/.test(server)) {
  console.error('SERVER_URL must look like https://play.example.com');
  process.exit(1);
}
const publicUrl = process.env.PUBLIC_URL || (server ? server + '/' : '');

rmSync(here('www'), { recursive: true, force: true });
mkdirSync(here('www'));
cpSync(here('../client'), here('www/client'), { recursive: true });
cpSync(here('../shared'), here('www/shared'), { recursive: true });
copyFileSync(here('../client/index.html'), here('www/index.html'));
writeFileSync(here('www/client/config.js'),
  `// Written by mobile/build.mjs\nexport const SERVER_URL = ${JSON.stringify(server)};\nexport const PUBLIC_URL = ${JSON.stringify(publicUrl)};\n`);
console.log(server ? `www/ built for ${server}` : 'www/ built; the app will ask for a server address');
