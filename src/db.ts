import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const schema = fs.readFileSync(path.resolve(process.cwd(), 'schema.sql'), 'utf8');

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private values: any[] = []) {}
  bind(...values: any[]) { return new Statement(this.db, this.sql, values); }
  first() { return this.db.prepare(this.sql).get(...this.values) as any; }
  all() { return { results: this.db.prepare(this.sql).all(...this.values) as any[] }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

export function createDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(schema);
  return {
    prepare(sql: string) { return new Statement(db, sql); },
    close() { db.close(); },
  };
}
