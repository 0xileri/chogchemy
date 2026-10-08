import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createMemoryFusionStore() {
  const records = new Map();
  return {
    get(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
    put(record) { records.set(record.id, structuredClone(record)); },
    activeCount(address, now) { return [...records.values()].filter(r => (!address || r.createdBy === address) && r.expires > now && ['awaiting_approvals', 'approved'].includes(r.state)).length; },
    list(address) { return [...records.values()].filter(r => r.parents.some(p => p.owner === address)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(r => structuredClone(r)); },
    close() {},
  };
}

export function createSqliteFusionStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS fusions (id TEXT PRIMARY KEY, creator TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS fusions_creator ON fusions(creator, expires);`);
  const get = db.prepare('SELECT payload FROM fusions WHERE id = ?');
  const put = db.prepare('INSERT INTO fusions (id, creator, expires, state, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload=excluded.payload');
  const count = db.prepare("SELECT COUNT(*) AS count FROM fusions WHERE expires > ? AND state IN ('awaiting_approvals', 'approved') AND (? IS NULL OR creator = ?)");
  const list = db.prepare("SELECT payload FROM fusions WHERE json_extract(payload, '$.parents[0].owner') = ? OR json_extract(payload, '$.parents[1].owner') = ? ORDER BY json_extract(payload, '$.createdAt') DESC LIMIT 30");
  return {
    get(id) { const row = get.get(id); return row ? JSON.parse(row.payload) : null; },
    put(record) { put.run(record.id, record.createdBy, record.expires, record.state, JSON.stringify(record)); },
    activeCount(address, now) { return count.get(now, address, address).count; },
    list(address) { return list.all(address, address).map(row => JSON.parse(row.payload)); },
    close() { db.close(); },
  };
}
