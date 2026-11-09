import { createApp } from './app.js';

const port = Number(process.env.PORT) || 8080;
const app = await createApp({ port, dbFile: process.env.DB_FILE || undefined });
console.log(`Sudoku Battles on http://localhost:${app.port}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
