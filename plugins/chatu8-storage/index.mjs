import path from 'node:path';
import { UserStore, StorageError, exclusive } from './store.mjs';
import { configuration, mirror } from './r2.mjs';
export const info = { id: 'chatu8-storage', name: 'Chatu8 per-user image metadata', description: 'Private metadata storage with opt-in R2 mirrors.' };

export async function init(router) {
    const route = handler => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            // Identity and directories are supplied by SillyTavern, never by request body.
            if (!req.user?.directories?.root || !req.user?.directories?.userImages) throw new StorageError('Authenticated user directory required.', 401);
            const store = new UserStore(path.resolve(req.user.directories.root));
            const result = await exclusive(store.file, () => handler(req, store));
            res.json(result);
        } catch (error) {
            res.status(error instanceof StorageError ? error.status : 503).json({ error: error instanceof StorageError ? error.message : 'Storage unavailable. Keep pending data; check server files and permissions.' });
        }
    };
    router.get('/metadata', route(async (_req, store) => ({ state: await store.load() })));
    router.post('/migrate', route(async (req, store) => ({ state: await store.migrate(req.body?.data) })));
    router.post('/save', route(async (req, store) => {
        const state = await store.save(req.body?.revision, req.body?.data);
        const { data: _data, addedPaths, ...summary } = state;
        return { state: summary, addedPaths };
    }));
    router.post('/r2/toggle', route(async (req, store) => {
        if (req.body?.enabled === true) await configuration(store);
        const state = await store.toggle(req.body?.revision, req.body?.enabled);
        const { data: _data, ...summary } = state;
        return { state: summary };
    }));
    router.post('/r2/upload', route((req, store) => mirror(store, req.user.directories.userImages, req.body?.path)));
}
