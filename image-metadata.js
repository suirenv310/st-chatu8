// AFPL v9. Browser controller; no credentials and no direct cloud requests.
export class ImageMetadata {
    constructor({ request, notify = console.error, schedule = setTimeout, cancel = clearTimeout }) {
        Object.assign(this, { request, notify, schedule, cancel });
        this.ready = false;
        this.revision = 0;
        this.generation = 0;
        this.savedGeneration = 0;
        this.raw = {};
        this.proxies = new WeakMap();
    }
    get data() { return this.observe(this.raw); }
    set data(value) {
        this.raw = value || {};
        this.proxies = new WeakMap();
        if (!this.ready && this.settings) this.settings.jiuguanStorage = this.raw;
        this.changed();
    }
    observe(value) {
        if (!value || typeof value !== 'object') return value;
        if (this.proxies.has(value)) return this.proxies.get(value);
        const proxy = new Proxy(value, {
            get: (target, key) => this.observe(Reflect.get(target, key)),
            set: (target, key, next) => { Reflect.set(target, key, next); this.changed(); return true; },
            deleteProperty: (target, key) => { Reflect.deleteProperty(target, key); this.changed(); return true; },
        });
        this.proxies.set(value, proxy);
        return proxy;
    }
    changed() {
        this.generation++;
        if (!this.ready) return;
        this.cancel(this.timer);
        this.timer = this.schedule(() => this.flush().catch(error => this.notify(error.message)), 300);
    }
    async initialize(settings, legacyLoader, saveSettings) {
        this.settings = settings;
        const marked = settings.imageMetadataStorage === 'server-v1';
        let response;
        try { response = await this.request('/metadata'); }
        catch (error) {
            if (marked) throw new Error('Image metadata server unavailable. Install/restore chatu8-storage before using images.');
            this.raw = settings.jiuguanStorage || {};
            this.notify('Separate image storage unavailable; keeping legacy settings intact.');
            return false;
        }
        let state = response.state;
        if (state && settings.jiuguanStorage && Object.keys(settings.jiuguanStorage).length) {
            // Archive residual settings from an older browser before removing that copy.
            state = (await this.request('/migrate', { data: settings.jiuguanStorage })).state;
        }
        if (!state) {
            // Never silently initialize an empty server after migration or lost disk data.
            if (marked) throw new Error('Image metadata file missing. Restore its backup before continuing.');
            let legacy = settings.jiuguanStorage;
            if (!legacy || !Object.keys(legacy).length) legacy = await legacyLoader() || {};
            state = (await this.request('/migrate', { data: legacy })).state;
            // Read-after-write verification before removing the settings copy.
            const verified = (await this.request('/metadata')).state;
            if (!verified || JSON.stringify(verified) !== JSON.stringify(state)) throw new Error('Metadata migration verification failed. Settings copy retained.');
        }
        this.raw = state.data;
        this.revision = state.revision;
        this.r2Enabled = state.r2Enabled === true;
        this.ready = true;
        settings.imageMetadataStorage = 'server-v1';
        delete settings.jiuguanStorage;
        saveSettings();
        return true;
    }
    async flush() {
        if (!this.ready) return;
        if (this.inFlight) { await this.inFlight; return this.flush(); }
        if (this.savedGeneration === this.generation) return;
        const generation = this.generation;
        const snapshot = JSON.parse(JSON.stringify(this.raw));
        this.inFlight = (async () => {
            const response = await this.request('/save', { revision: this.revision, data: snapshot });
            this.revision = response.state.revision;
            this.savedGeneration = generation;
            if (this.r2Enabled) {
                // Migration never returns addedPaths. Only new local references are copied.
                for (const path of response.addedPaths || []) {
                    if (!this.r2Enabled) break;
                    try { await this.request('/r2/upload', { path }); }
                    catch (error) { this.notify(`R2 copy failed; local image retained. ${error.message}`); }
                }
            }
        })();
        try { await this.inFlight; } finally { this.inFlight = null; }
        if (this.savedGeneration !== this.generation) return this.flush();
    }
    async toggle(enabled) {
        await this.flush();
        const response = await this.request('/r2/toggle', { revision: this.revision, enabled });
        this.revision = response.state.revision;
        this.r2Enabled = response.state.r2Enabled === true;
    }
    paths() {
        return [...new Set(Object.values(this.raw).flatMap(entry => (entry.images || []).flatMap(image => [image.path, image.thumbnail_path]).filter(Boolean)))];
    }
}

export function mountStorageUI(storage) {
    const target = document.querySelector('#chatu8-image-storage');
    if (!target || target.dataset.mounted) return;
    target.dataset.mounted = 'true';
    const status = target.querySelector('[data-storage-status]');
    const toggle = target.querySelector('[data-r2-toggle]');
    const existing = target.querySelector('[data-r2-existing]');
    const flush = target.querySelector('[data-storage-flush]');
    const update = () => {
        toggle.checked = storage.r2Enabled === true;
        toggle.disabled = !storage.ready;
        existing.disabled = !storage.ready || !storage.r2Enabled;
        flush.disabled = !storage.ready;
        status.textContent = storage.ready ? `Server metadata active. R2 ${storage.r2Enabled ? 'ON' : 'OFF'}.` : 'Legacy mode. Install the chatu8-storage server plugin to migrate.';
    };
    toggle.onchange = async () => {
        toggle.disabled = true;
        try { await storage.toggle(toggle.checked); update(); }
        catch (error) { update(); status.textContent = error.message; }
    };
    flush.onclick = async () => {
        try { await storage.flush(); status.textContent = 'Metadata saved on server.'; }
        catch (error) { status.textContent = error.message; }
    };
    existing.onclick = async () => {
        if (!confirm('Copy existing referenced images and thumbnails to R2? Local files and links will be retained.')) return;
        existing.disabled = true;
        try {
            await storage.flush();
            const paths = storage.paths();
            let completed = 0;
            for (const path of paths) {
                if (!storage.r2Enabled) break;
                await storage.request('/r2/upload', { path });
                status.textContent = `R2 copies: ${++completed}/${paths.length}. Local files retained.`;
            }
        } catch (error) { status.textContent = error.message; }
        finally { existing.disabled = !storage.r2Enabled; }
    };
    target.querySelector('[data-storage-export]').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(storage.raw, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'chatu8-image-metadata.json'; link.click();
        URL.revokeObjectURL(url);
    };
    update();
}
