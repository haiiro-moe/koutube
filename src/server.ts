import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import worker from './app.js';
import { createDatabase } from './db.js';

const port = Number(process.env.PORT || 8787);
const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = createDatabase(path.join(dataDir, 'koutube.sqlite'));
const env = {
  DB: db,
  IV_DOMAIN: process.env.IV_DOMAIN || '',
  IV_AUTH: process.env.IV_AUTH || '',
  BROWSER: undefined,
};

async function purgeExpiredCache() {
  const { deleteExpiredCacheEntries, updatePublicCount } = await import('./utils.js');
  const deleted = await deleteExpiredCacheEntries(db);
  await updatePublicCount(db);
  if (deleted) console.log({ deleted_cache_entries: deleted, timestamp: new Date().toISOString() });
}

void purgeExpiredCache().catch((error) => console.error('Initial cache purge failed', error));
const purgeTimer = setInterval(() => {
  void purgeExpiredCache().catch((error) => console.error('Scheduled cache purge failed', error));
}, 60 * 60 * 1000);
 purgeTimer.unref();

function toFetchRequest(req: http.IncomingMessage): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = req.headers.host || `localhost:${port}`;
  return new Request(`${protocol}://${host}${req.url || '/'}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([key, value]) => value ? [[key, Array.isArray(value) ? value.join(', ') : value]] : []),
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req) as any,
    // Node's fetch requires this for streamed request bodies.
    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { duplex: 'half' as const }),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const response = await worker.fetch(toFetchRequest(req), env as any, undefined as any);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as any).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Internal server error');
  }
});

const cleanup = () => { clearInterval(purgeTimer); db.close(); server.close(() => process.exit(0)); };
process.once('SIGTERM', cleanup);
process.once('SIGINT', cleanup);
server.listen(port, '0.0.0.0', () => console.log(`Gakkou YouTube Club listening on http://0.0.0.0:${port}`));
