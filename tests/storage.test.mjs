import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { UserStore, validateData, atomicJson, exclusive } from '../plugins/chatu8-storage/store.mjs';
import { mirror, localImage, signedPut } from '../plugins/chatu8-storage/r2.mjs';
import { init } from '../plugins/chatu8-storage/index.mjs';
import { rollback } from '../plugins/chatu8-storage/rollback.mjs';
import { ImageMetadata } from '../image-metadata.js';

const fixture = () => ({ hash: { images: [{ uuid: 'original', path: 'user/images/name/a.png', thumbnail_uuid: 'thumb', thumbnail_path: 'user/images/name/t.jpg', genParams: { prompt: 'unchanged' }, custom: 42 }], index: 0, change: '服装', video: 'v', activeMode: 'portrait', customEntry: ['keep'] } });
async function temporary(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatu8-storage-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
async function bridge(t) {
    const root = await temporary(t);
    const routes = new Map();
    await init({ get: (route, handler) => routes.set(route, handler), post: (route, handler) => routes.set(route, handler) });
    const directories = { root, userImages: path.join(root, 'user/images') };
    const request = async (route, body, user = { directories }) => {
        let status = 200, value;
        await routes.get(route)({ body, user }, { set() {}, status(code) { status = code; return this; }, json(result) { value = result; } });
        if (status >= 400) throw Object.assign(new Error(value.error), { status });
        return value;
    };
    return { root, request, store: new UserStore(root), directories };
}
function client(request) { return new ImageMetadata({ request, notify() {}, schedule: () => 0, cancel() {} }); }

test('migration backs up exact metadata, preserves every image/index/unknown field, R2 defaults OFF', async t => {
    const { request, store } = await bridge(t);
    const data = fixture();
    const settings = { jiuguanStorage: data, banana: { existing: true } };
    const storage = client(request);
    let saved = 0;
    await storage.initialize(settings, () => assert.fail('settings data has priority'), () => saved++);
    assert.deepEqual(storage.raw, data);
    assert.equal(settings.jiuguanStorage, undefined);
    assert.deepEqual(settings.banana, { existing: true });
    assert.equal(saved, 1);
    assert.equal(storage.r2Enabled, false);
    const state = await store.load();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.directory, 'backups', state.migrationBackup))), data);
    assert.equal(JSON.stringify(settings).includes('original'), false);
});

test('deep mutations and deletions persist separately, with CAS rejecting a stale tab', async t => {
    const { request, store } = await bridge(t);
    const a = client(request), b = client(request);
    await a.initialize({ jiuguanStorage: fixture() }, null, () => {});
    await b.initialize({ imageMetadataStorage: 'server-v1' }, null, () => {});
    a.data.hash.images.push({ uuid: 'second', path: 'user/images/second.png' });
    a.data.hash.index = 1;
    delete a.data.hash.customEntry;
    await a.flush();
    const state = await store.load();
    assert.equal(state.data.hash.images.length, 2);
    assert.equal(state.data.hash.index, 1);
    assert.equal(state.data.hash.customEntry, undefined);
    b.data.hash.index = 9;
    await assert.rejects(b.flush(), { status: 409 });
    assert.equal((await store.load()).data.hash.index, 1);
    assert.notEqual(b.savedGeneration, b.generation); // Pending export remains available.
});

test('edits during an in-flight save are drained in a second revision', async t => {
    const { request, store } = await bridge(t);
    let release;
    const gate = new Promise(resolve => release = resolve);
    let calls = 0;
    const storage = client(async (route, body) => {
        if (route === '/save' && ++calls === 1) await gate;
        return request(route, body);
    });
    await storage.initialize({ jiuguanStorage: fixture() }, null, () => {});
    storage.data.hash.index = 1;
    const pending = storage.flush();
    storage.data.hash.index = 2;
    release(); await pending;
    assert.equal((await store.load()).data.hash.index, 2);
    assert.equal(calls, 2);
});

test('failed migration/verification and unavailable plugin preserve legacy settings', async () => {
    for (const failure of ['offline', 'migrate', 'verify']) {
        const data = fixture(), settings = { jiuguanStorage: data };
        let reads = 0;
        const storage = client(async route => {
            if (failure === 'offline' || route === '/migrate' && failure === 'migrate') throw new Error('disk/network failed');
            if (route === '/metadata') return { state: ++reads === 1 ? null : null };
            return { state: { version: 1, revision: 1, data } };
        });
        if (failure === 'offline') assert.equal(await storage.initialize(settings, null, () => {}), false);
        else await assert.rejects(storage.initialize(settings, null, () => {}));
        assert.deepEqual(settings.jiuguanStorage, data);
        assert.equal(storage.ready, false);
    }
});

test('missing or corrupt migrated data stops startup rather than resurrecting stale stego', async t => {
    const { request, store } = await bridge(t);
    const storage = client(request);
    await assert.rejects(storage.initialize({ imageMetadataStorage: 'server-v1' }, () => assert.fail(), () => {}), /missing/);
    await fs.mkdir(store.directory, { recursive: true });
    await fs.writeFile(store.file, '{damaged');
    await assert.rejects(storage.initialize({ imageMetadataStorage: 'server-v1' }, () => assert.fail(), () => {}), /unavailable/);
    assert.equal(await fs.readFile(store.file, 'utf8'), '{damaged');
});

test('residual legacy data is archived without overwriting current server metadata', async t => {
    const { request, store } = await bridge(t);
    await store.migrate(fixture());
    const residual = fixture(); residual.hash.index = 7;
    await client(request).initialize({ jiuguanStorage: residual }, null, () => {});
    const backup = (await fs.readdir(path.join(store.directory, 'backups'))).find(name => name.startsWith('legacy-residual-'));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.directory, 'backups', backup))), residual);
    assert.equal((await store.load()).data.hash.index, 0);
});

test('routes require authenticated directories and isolate each user regardless of body identity', async t => {
    const { request, root, store } = await bridge(t);
    await assert.rejects(request('/metadata', null, null), { status: 401 });
    await request('/migrate', { data: fixture(), user: 'someone-else', root: '/' });
    const other = { directories: { root: path.join(root, 'other'), userImages: path.join(root, 'other/user/images') } };
    assert.equal((await request('/metadata', null, other)).state, null);
    assert.deepEqual((await store.load()).data, fixture());
});

test('concurrent CAS writes serialize; only one succeeds and snapshots remain recoverable', async t => {
    const { request, store } = await bridge(t);
    await store.migrate(fixture());
    const result = await Promise.allSettled([request('/save', { revision: 1, data: { a: {} } }), request('/save', { revision: 1, data: { b: {} } })]);
    assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(result.find(x => x.status === 'rejected').reason.status, 409);
    assert.equal((await store.load()).revision, 2);
    const backups = await fs.readdir(path.join(store.directory, 'backups'));
    assert.ok(backups.some(x => x.startsWith('revision-')));
});

test('R2 OFF forbids network calls even with valid configuration, then explicit toggle allows copies', async t => {
    const { request, store, directories } = await bridge(t);
    const data = fixture(); await store.migrate(data);
    const config = { accountId: 'a'.repeat(32), bucket: 'test-bucket', accessKeyId: 'test-only', secretAccessKey: 'test-only' };
    await atomicJson(path.join(store.directory, 'r2-config.json'), config);
    await fs.mkdir(path.join(directories.userImages, 'name'), { recursive: true });
    await fs.writeFile(path.join(directories.userImages, 'name/a.png'), 'image');
    let calls = 0;
    const transport = async (url, options) => {
        calls++;
        assert.ok(url.startsWith(`https://${config.accountId}.r2.cloudflarestorage.com/test-bucket/chatu8/`));
        assert.equal(options.method, 'PUT'); assert.equal(options.redirect, 'error');
        assert.equal(options.body.toString(), 'image');
        return new Response('', { status: 200 });
    };
    const source = data.hash.images[0].path;
    await assert.rejects(mirror(store, directories.userImages, source, transport), { status: 403 });
    assert.equal(calls, 0);
    const result = await request('/r2/toggle', { revision: 1, enabled: true });
    assert.equal(JSON.stringify(result).includes('secretAccessKey'), false);
    assert.equal((await mirror(store, directories.userImages, source, transport)).uploaded, true);
    assert.equal((await mirror(store, directories.userImages, source, transport)).uploaded, false);
    assert.equal(calls, 1);
    await request('/r2/toggle', { revision: 2, enabled: false });
    await assert.rejects(mirror(store, directories.userImages, source, transport), { status: 403 });
    assert.equal(calls, 1);
    assert.equal(await fs.readFile(path.join(directories.userImages, 'name/a.png'), 'utf8'), 'image');
    assert.deepEqual((await store.load()).data, data);
});

test('R2 enable fails without configuration and migration never uploads historical images', async t => {
    const { request, store } = await bridge(t);
    const calls = [];
    const storage = client(async (route, body) => { calls.push(route); return request(route, body); });
    await storage.initialize({ jiuguanStorage: fixture() }, null, () => {});
    await assert.rejects(storage.toggle(true), /Configure/);
    assert.equal((await store.load()).r2Enabled, false);
    storage.data.hash.index = 0; await storage.flush();
    assert.equal(calls.includes('/r2/upload'), false);
});

test('R2 ON mirrors only newly referenced paths, not index changes or historical library', async t => {
    const { request, store } = await bridge(t);
    await store.migrate(fixture());
    await store.toggle(1, true);
    const uploads = [];
    const storage = client((route, body) => {
        if (route === '/r2/upload') { uploads.push(body.path); return {}; }
        return request(route, body);
    });
    await storage.initialize({ imageMetadataStorage: 'server-v1' }, null, () => {});
    assert.deepEqual(uploads, []);
    storage.data.hash.index = 0; await storage.flush();
    assert.deepEqual(uploads, []);
    storage.data.hash.images.push({ path: 'user/images/new.png', thumbnail_path: 'user/images/new-thumb.jpg' });
    await storage.flush();
    assert.deepEqual(uploads, ['user/images/new.png', 'user/images/new-thumb.jpg']);
});

test('R2 local paths reject traversal, URLs, encoded paths and cross-user symlinks', async t => {
    const root = await temporary(t);
    const images = path.join(root, 'images'); await fs.mkdir(images);
    for (const source of ['../settings.json', 'user/images/../../settings.json', 'https://evil.invalid/a.png', 'user/images/%2e%2e/file', 'user/images/..\\file']) await assert.rejects(localImage(images, source));
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret'), 'secret');
    await fs.symlink(outside, path.join(images, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(localImage(images, 'user/images/link/secret'), /outside/);
});

test('unsafe metadata keys are rejected and failed disk writes leave the original state', async t => {
    for (const key of ['__proto__', 'constructor', 'prototype']) assert.throws(() => validateData(JSON.parse(`{"${key}":{}}`)));
    const root = await temporary(t), store = new UserStore(root);
    await store.migrate(fixture());
    await fs.rename(path.join(store.directory, 'backups'), path.join(store.directory, 'backups-saved'));
    await fs.writeFile(path.join(store.directory, 'backups'), 'blocked');
    await assert.rejects(store.save(1, {}));
    assert.deepEqual((await store.load()).data, fixture());
});

test('offline rollback restores latest metadata and preserves all other settings', async t => {
    const root = await temporary(t), store = new UserStore(root);
    await store.migrate(fixture());
    const data = fixture(); data.hash.index = 1; await store.save(1, data);
    const settings = { theme: 'keep', extension_settings: { other: { x: 3 }, 'st-chatu8': { imageMetadataStorage: 'server-v1', banana: { keep: true } } } };
    await atomicJson(path.join(root, 'settings.json'), settings);
    await rollback(root);
    const after = JSON.parse(await fs.readFile(path.join(root, 'settings.json')));
    assert.deepEqual(after.extension_settings['st-chatu8'].jiuguanStorage, data);
    assert.deepEqual(after.extension_settings.other, settings.extension_settings.other);
    assert.deepEqual(after.extension_settings['st-chatu8'].banana, { keep: true });
    assert.equal(after.theme, 'keep');
    assert.equal(after.extension_settings['st-chatu8'].imageMetadataStorage, undefined);
    assert.equal(await store.load(), null);
});

test('bundled initialization and stego updates use the new store without restoring stale stego', async () => {
    const source = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(source.includes('extension_settings[extensionName].jiuguanStorage'), false);
    for (const name of ['initJiuguanStorage', 'createStegoImage', 'updateStegoImage']) {
        const start = source.indexOf(`async function ${name}(`);
        const end = source.indexOf('\nasync function ', start + 1);
        let flushes = 0;
        const context = vm.createContext({ imageMetadata: { ready: true, flush: () => flushes++ } });
        vm.runInContext(source.slice(start, end) + `\n${name}();`, context);
        assert.equal(flushes, name === 'initJiuguanStorage' ? 0 : 1);
    }
});

test('metadata scheduling keeps Vibe/config registry and generation-stat settings saves intact', async () => {
    const source = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('function scheduleSettingsSave(');
    const end = source.indexOf('\nfunction flushSettingsSave', start);
    let settingsSaves = 0, metadataChanges = 0;
    const context = vm.createContext({
        imageMetadata: { ready: true, changed: () => metadataChanges++ },
        _stats: { requests: 0 }, isMergeEnabled: () => false,
        saveSettingsDebounced2: () => settingsSaves++,
    });
    vm.runInContext(source.slice(start, end) + '\nscheduleSettingsSave("index"); scheduleSettingsSave("registry"); scheduleSettingsSave("stats");', context);
    assert.equal(metadataChanges, 1);
    assert.equal(settingsSaves, 2);
});
