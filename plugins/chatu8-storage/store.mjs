import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class StorageError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
export function validateData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StorageError('Invalid metadata object.');
    const visit = (value, depth = 0) => {
        if (depth > 100) throw new StorageError('Metadata nesting exceeds limit.');
        if (!value || typeof value !== 'object') return;
        for (const key of Object.keys(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new StorageError('Unsafe metadata key.');
            visit(value[key], depth + 1);
        }
    };
    visit(data);
    if (Buffer.byteLength(JSON.stringify(data)) > 64 * 1024 * 1024) throw new StorageError('Metadata exceeds 64 MiB.', 413);
    return data;
}
export async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        const handle = await fs.open(temp, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temp, file);
        // Persist the rename on Linux; Windows does not support directory fsync.
        if (process.platform !== 'win32') {
            const directory = await fs.open(path.dirname(file), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        }
    } finally { await fs.rm(temp, { force: true }); }
}
export function mediaPaths(data) {
    const paths = new Set();
    for (const entry of Object.values(data)) {
        for (const image of Array.isArray(entry?.images) ? entry.images : []) {
            for (const key of ['path', 'thumbnail_path']) if (typeof image[key] === 'string') paths.add(image[key]);
        }
    }
    return paths;
}
export class UserStore {
    constructor(root) { this.directory = path.join(root, 'chatu8-storage'); this.file = path.join(this.directory, 'metadata.json'); }
    async load() {
        const state = await readJson(this.file, null);
        if (state) {
            if (state.version !== 1 || !Number.isSafeInteger(state.revision)) throw new StorageError('Unsupported or damaged metadata file.', 503);
            validateData(state.data);
        }
        return state;
    }
    async backup(label, value) {
        const name = `${label}-${Date.now()}-${randomUUID()}.json`;
        await atomicJson(path.join(this.directory, 'backups', name), value);
        return name;
    }
    async migrate(data) {
        validateData(data);
        const existing = await this.load();
        if (existing) {
            // Older clients can still carry a settings copy. Preserve it, never overwrite server data.
            if (Object.keys(data).length && JSON.stringify(data) !== JSON.stringify(existing.data)) await this.backup('legacy-residual', data);
            return existing;
        }
        const backup = await this.backup('legacy', data);
        const state = { version: 1, revision: 1, data, migrationBackup: backup, r2Enabled: false };
        await atomicJson(this.file, state);
        return await this.load();
    }
    async save(revision, data) {
        validateData(data);
        const current = await this.load();
        if (!current || current.revision !== revision) throw new StorageError('Metadata changed in another tab. Export pending data and reload.', 409);
        await this.backup('revision', current);
        const previousPaths = mediaPaths(current.data);
        const addedPaths = [...mediaPaths(data)].filter(p => !previousPaths.has(p));
        const state = { ...current, revision: revision + 1, data };
        await atomicJson(this.file, state);
        // Keep ten rolling snapshots; migration/residual backups are never pruned.
        try {
            const directory = path.join(this.directory, 'backups');
            const revisions = (await fs.readdir(directory)).filter(name => name.startsWith('revision-')).sort().reverse();
            for (const name of revisions.slice(10)) await fs.rm(path.join(directory, name));
        } catch { console.warn('[chatu8-storage] Snapshot cleanup failed; committed metadata is intact.'); }
        return { ...state, addedPaths };
    }
    async toggle(revision, enabled) {
        if (typeof enabled !== 'boolean') throw new StorageError('Expected an explicit boolean toggle.');
        const current = await this.load();
        if (!current || current.revision !== revision) throw new StorageError('Metadata changed; reload before changing R2.', 409);
        await this.backup('toggle', current);
        const state = { ...current, revision: revision + 1, r2Enabled: enabled };
        await atomicJson(this.file, state);
        return state;
    }
}
const queues = new Map();
export async function exclusive(key, operation) {
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(key, next);
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
