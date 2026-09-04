import path from 'node:path';
import fs from 'node:fs';
import { createDatabase } from './db.js';
const dir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(dir, { recursive: true });
const db = createDatabase(path.join(dir, 'koutube.sqlite'));
db.close();
console.log(`Initialized ${path.join(dir, 'koutube.sqlite')}`);
