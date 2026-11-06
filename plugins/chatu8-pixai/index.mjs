/* PixAI server bridge for modified st-chatu8, 2026-11-06. AFPL v9. */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { API, BridgeError, validateKey, validateId, apiRequest, projectTask, submitGeneration } from './core.mjs';
export const info = { id:'chatu8-pixai', name:'st-chatu8 PixAI bridge', description:'Calls official PixAI API for the PixAI addition to st-chatu8.' };
const MAX_IMAGE = 32 * 1024 * 1024;
export function publicAddress(ip) {
    if (isIP(ip) === 4) {
        const [a,b] = ip.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >=16 && b <=31) || (a === 192 && b === 168) || (a === 100 && b >=64 && b <=127) || (a === 198 && (b ===18 || b ===19)));
    }
    // Only global unicast IPv6, excluding IPv4-mapped and local addresses.
    return isIP(ip) === 6 && /^[23]/.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
}
async function validateRedirect(url) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new BridgeError('PixAI returned an invalid image URL.',502);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{address:host}] : await lookup(host, {all:true});
    if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new BridgeError('Image URL is not allowed.',502);
}
async function readImage(mediaId, key, signal) {
    let url = new URL(`${API}/v1/media/${validateId(mediaId)}/image`);
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    let response;
    for (let step=0; step<5; step++) {
        await validateRedirect(url);
        response = await fetch(url, {
            redirect:'manual', signal:timeout,
            // Never forward the API key to storage/CDN redirect destinations.
            headers: url.origin === API ? {Authorization:`Bearer ${key}`} : {},
        });
        if ([301,302,303,307,308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) throw new BridgeError('PixAI response has no image URL.',502);
            url = new URL(location,url);
            continue;
        }
        break;
    }
    if (!response?.ok) throw new BridgeError(`PixAI image download failed (HTTP ${response?.status || 502}).`,502);
    const format = (response.headers.get('content-type') || '').split(';')[0];
    if (!['image/png','image/jpeg','image/webp'].includes(format)) { await response.body?.cancel(); throw new BridgeError('PixAI did not return PNG/JPEG/WebP.',502); }
    if (Number(response.headers.get('content-length')) > MAX_IMAGE) { await response.body?.cancel(); throw new BridgeError('Image exceeds the 32MB limit.',413); }
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if(size > MAX_IMAGE) throw new BridgeError('Image exceeds the 32MB limit.',413);
        chunks.push(Buffer.from(chunk));
    }
    return { image:`data:${format};base64,${Buffer.concat(chunks).toString('base64')}`, format };
}
export async function init(router) {
    const route = (handler) => async (req,res) => {
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close',disconnected);
        res.set('Cache-Control','no-store');
        try {
            const key=validateKey(req.body?.apiKey);
            const result=await handler(req.body,key,controller.signal);
            if (!controller.signal.aborted) res.json(result);
        } catch(error) {
            if (!controller.signal.aborted) res.status(error instanceof BridgeError ? error.status : 502).json({error:error instanceof BridgeError ? error.message : 'No PixAI response. If you just submitted generation, do not resubmit automatically: the task may already exist.'});
        } finally { res.off('close',disconnected); }
    };
    router.get('/health', (_req,res) => res.json({provider:'PixAI',version:'0.5.0',features:{faceFix:true,recipes:true}}));
    router.post('/submit', route(async (body,key,signal) => submitGeneration(body.payload,key,{signal})));
    router.post('/task', route(async (body,key,signal) => projectTask(await apiRequest(`/v1/task/${validateId(body.taskId)}`,key,{signal}))));
    router.post('/image', route((body,key,signal) => readImage(body.mediaId,key,signal)));
    console.log('[chatu8-pixai] Ready. No API key is stored by this server plugin.');
}
