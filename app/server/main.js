// Starts the server and prints where to open it. Checks Node first, because node:sqlite
// (the database) only works without a flag from Node 22.13.
import { networkInterfaces } from 'node:os';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Sudoku Battles needs Node.js 22.13 or newer. This is ${process.versions.node}. Get it from https://nodejs.org`);
  process.exit(1);
}
const { createApp } = await import('./app.js');

const port = Number(process.env.PORT) || 8080;
let app;
try { app = await createApp({ port, dbFile: process.env.DB_FILE || undefined }); }
catch (e) {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is busy. Is the server already running? Or start with PORT=8081.`);
  else console.error(e);
  process.exit(1);
}
const lan = Object.values(networkInterfaces()).flat()
  .filter(a => a && a.family === 'IPv4' && !a.internal)
  .map(a => `http://${a.address}:${app.port}`);
console.log(`\nSudoku Battles is running.\n\n  This computer:  http://localhost:${app.port}`);
for (const u of lan) console.log(`  Same Wi-Fi:     ${u}   <- open this on phones, or type it in the app`);
console.log('\nKeep this window open while you play. Ctrl+C stops it.\n');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
