import fs from 'node:fs';
import path from 'node:path';
import { createRoomServer } from './room-server';

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid PORT "${raw}"`);
    process.exit(1);
  }
  return port;
}

const port = parsePort(process.env.PORT);
const dataFile = process.env.DATA_FILE ?? path.resolve(import.meta.dirname, '../data/state.json');
const clientDist = path.resolve(import.meta.dirname, '../client/dist');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : undefined;

// Only behind a reverse proxy / hosting platform that sets X-Forwarded-For; never when exposed directly.
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

const server = createRoomServer({ dataFile, staticDir, trustProxy });

server.listen(port).then((bound) => {
  console.log(`Planning Poker listening on http://localhost:${bound}`);
  console.log(`State file: ${dataFile}`);
  if (trustProxy) console.log('TRUST_PROXY is on: client IPs are taken from X-Forwarded-For.');
  if (!staticDir) {
    console.log('client/dist not found: run "npm run build", or use "npm run dev:client" for the UI.');
  }
}).catch((err: Error) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
