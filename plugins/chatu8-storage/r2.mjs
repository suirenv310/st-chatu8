import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { StorageError, readJson, atomicJson, mediaPaths } from './store.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export async function configuration(store) {
    const config = await readJson(path.join(store.directory, 'r2-config.json'), null);
    if (!config || !/^[a-f0-9]{32}$/i.test(config.accountId || '') || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket || '') || !config.accessKeyId || !config.secretAccessKey) throw new StorageError('Configure the private per-user r2-config.json on the server first.');
    return config;
}
export function signedPut(config, key, body, now = new Date()) {
    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const uri = '/' + [config.bucket, ...key.split('/')].map(encode).join('/');
    const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8);
    const payload = hash(body);
    const headers = `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${date}\n`;
    const names = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = `PUT\n${uri}\n\n${headers}\n${names}\n${payload}`;
    const scope = `${day}/auto/s3/aws4_request`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
    return { url: `https://${host}${uri}`, headers: {
        'x-amz-date': date, 'x-amz-content-sha256': payload,
        Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
    } };
}
export async function localImage(imagesDirectory, source) {
    const relative = source.replace(/^\//, '');
    if (!relative.startsWith('user/images/') || relative.includes('\\') || relative.includes('%') || relative.split('/').includes('..')) throw new StorageError('Only local user images can be mirrored.');
    const root = await fs.realpath(imagesDirectory);
    const file = await fs.realpath(path.join(root, relative.slice('user/images/'.length)));
    if (!file.startsWith(root + path.sep)) throw new StorageError('Image is outside the current user directory.');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new StorageError('Image is not a file or exceeds 64 MiB.');
    return file;
}
export async function mirror(store, imagesDirectory, source, transport = fetch) {
    const state = await store.load();
    if (state?.r2Enabled !== true) throw new StorageError('R2 is OFF. No upload was made.', 403);
    if (!mediaPaths(state.data).has(source)) throw new StorageError('Image is not referenced by this user metadata.');
    const config = await configuration(store);
    const file = await localImage(imagesDirectory, source);
    const body = await fs.readFile(file);
    // Content addressing avoids overwriting a previous mirror when a local filename is reused.
    const digest = hash(body);
    const key = `chatu8/${hash(store.directory).slice(0, 24)}/${digest}${path.extname(file)}`;
    const manifestFile = path.join(store.directory, 'r2-manifest.json');
    const manifest = await readJson(manifestFile, {});
    if (manifest[source]?.key === key && manifest[source]?.accountId === config.accountId && manifest[source]?.bucket === config.bucket) return { uploaded: false, key };
    const request = signedPut(config, key, body);
    const response = await transport(request.url, { method: 'PUT', headers: request.headers, body, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) { await response.body?.cancel(); throw new StorageError(`R2 upload failed (HTTP ${response.status}). Local image retained.`, 502); }
    await response.body?.cancel();
    manifest[source] = { key, accountId: config.accountId, bucket: config.bucket, sha256: digest, uploadedAt: new Date().toISOString() };
    await atomicJson(manifestFile, manifest);
    return { uploaded: true, key };
}
