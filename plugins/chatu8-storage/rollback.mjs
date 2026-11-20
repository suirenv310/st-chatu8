// Run offline with SillyTavern stopped. No image file or unrelated setting is changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { UserStore, readJson, atomicJson, validateData } from './store.mjs';

export async function rollback(root) {
    const store = new UserStore(path.resolve(root));
    const state = await store.load();
    if (!state) throw new Error('No migrated metadata found. Nothing changed.');
    const settingsFile = path.join(path.resolve(root), 'settings.json');
    const settings = await readJson(settingsFile, null);
    if (!settings?.extension_settings?.['st-chatu8']) throw new Error('st-chatu8 settings not found. Nothing changed.');
    validateData(state.data);
    const backup = await store.backup('settings-before-rollback', settings);
    settings.extension_settings['st-chatu8'].jiuguanStorage = state.data;
    delete settings.extension_settings['st-chatu8'].imageMetadataStorage;
    await atomicJson(settingsFile, settings);
    // A later re-migration must use the now-current settings, not an obsolete server snapshot.
    await fs.rename(store.file, path.join(store.directory, `metadata-before-rollback-${Date.now()}.json`));
    return { backup, entries: Object.keys(state.data).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (process.argv.length !== 4 || process.argv[3] !== '--server-stopped') {
        console.error('Usage: node rollback.mjs /absolute/user/data/directory --server-stopped');
        process.exitCode = 1;
    } else {
        try { console.log(await rollback(process.argv[2])); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
