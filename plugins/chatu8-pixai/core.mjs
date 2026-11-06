const STYLE_KEYS = ["anime-watercolor-impasto", "art-crayon", "bold-line-soft-color", "chibi", "classic-japanese", "clean-flat-illustration", "colored-pencil-grain", "cool-warm-oil-contrast", "desaturated-cool", "flat-anime-pastel", "glossy-glass-anime", "grey-blocks-lineless", "hard-line-monochrome-accent", "high-contrast-retro-vivid", "holographic", "korean-style", "lineart-watercolor-airy", "low-saturation-expressive-eyes", "lucid-dreamy", "luminous-retro-impasto", "minimal-flat-color", "modern-oil-glamour", "moe-pastel", "oil-watercolor-blend", "painterly-doodle", "paper-watercolor", "pencil-sketch", "poster-graffiti", "retro-comic-fusion", "retro-oil-glamour", "retro-tv-anime", "semi-realistic", "stable-vaporwave", "tinted-sketch", "vintage-collage"];
/* PixAI integration, 2026-11-06. AFPL v9; see LICENSE. */
export const API = 'https://api.pixai.art';
export class BridgeError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
export function validateId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new BridgeError('Invalid PixAI ID.');
    return value;
}
export function validateKey(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n]/.test(value)) throw new BridgeError('Missing or invalid PixAI API key.');
    return value.trim();
}
export function validatePayload(p) {
    if (!p || typeof p !== 'object') throw new BridgeError('Missing generation settings.');
    if (typeof p.modelVersionId !== 'string' || !/^\d+$/.test(p.modelVersionId)) throw new BridgeError('Model version ID must be a numeric string.');
    if (typeof p.prompt !== 'string' || !p.prompt.trim() || p.prompt.length > 10000) throw new BridgeError('Prompt is empty or exceeds 10,000 characters.');
    if (!['1:1','2:3','3:2','3:4','4:3','3:5','5:3','9:16','16:9','1:3','3:1'].includes(p.aspectRatio)) throw new BridgeError('Invalid aspect ratio.');
    if (!['1k','1.5k'].includes(p.size)) throw new BridgeError('Invalid image size.');
    if (p.mode && !['lite','standard','pro','ultra'].includes(p.mode)) throw new BridgeError('Invalid mode.');
    if (p.negativePrompt && (typeof p.negativePrompt !== 'string' || p.negativePrompt.length > 4096)) throw new BridgeError('Negative prompt is too long or invalid.');
    if (!Array.isArray(p.loras) || p.loras.length > 15) throw new BridgeError('LoRAs must be an array of at most 15 items.');
    const loras = p.loras.map(l => {
        if (!l || typeof l.modelId !== 'string' || !/^\d+$/.test(l.modelId)) throw new BridgeError('LoRA modelId must be a numeric version ID string.');
        const weight = l.weight ?? 1;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new BridgeError('LoRA weight must be between 0 and 1.');
        if (l.triggerWords !== undefined && (typeof l.triggerWords !== 'string' || l.triggerWords.length > 4096)) throw new BridgeError('Invalid LoRA triggerWords.');
        return { modelId: l.modelId, weight, ...(l.triggerWords !== undefined ? { triggerWords:l.triggerWords } : {}) };
    });
    const options = {promptHelper:'disable'};
    if(p.enableADetailer!==undefined && typeof p.enableADetailer!=='boolean')throw new BridgeError('Invalid Face Fix flag.');
    if(p.enableADetailer===true)options.enableADetailer=true;
    if(p.recipeIds!==undefined){
        if(!Array.isArray(p.recipeIds) || p.recipeIds.length>10 || p.recipeIds.some(id=>typeof id!=='string' || !/^\d{1,30}$/.test(id)) || new Set(p.recipeIds).size!==p.recipeIds.length)throw new BridgeError('Invalid or duplicate recipe IDs (maximum 10).');
        if(p.recipeIds.length)options.recipeIds=[...p.recipeIds];
    }
    if(p.seed!==undefined) {
        if(!Number.isSafeInteger(p.seed) || p.seed<0)throw new BridgeError('Invalid seed.');
        options.seed=p.seed;
    }
    if(p.sampling!==undefined) {
        if(!p.sampling || typeof p.sampling!=='object' || Array.isArray(p.sampling))throw new BridgeError('Invalid sampling settings.');
        const sample={};
        if(p.sampling.method!==undefined){
            if(typeof p.sampling.method!=='string' || !p.sampling.method.trim() || p.sampling.method.length>120)throw new BridgeError('Invalid sampler.');
            sample.method=p.sampling.method;
        }
        if(p.sampling.steps!==undefined){
            if(!Number.isInteger(p.sampling.steps) || p.sampling.steps<1 || p.sampling.steps>100)throw new BridgeError('Steps must be between 1 and 100.');
            sample.steps=p.sampling.steps;
        }
        if(p.sampling.cfgScale!==undefined){
            if(typeof p.sampling.cfgScale!=='number' || !Number.isFinite(p.sampling.cfgScale) || p.sampling.cfgScale<0)throw new BridgeError('Invalid CFG.');
            sample.cfgScale=p.sampling.cfgScale;
        }
        options.sampling=sample;
    }
    if(p.style!==undefined){
        if(!p.style || p.style.type!=='preset' || !STYLE_KEYS.includes(p.style.key))throw new BridgeError('Invalid style preset.');
        options.style={type:'preset',key:p.style.key};
    }
    return { modelVersionId:p.modelVersionId, prompt:p.prompt, negativePrompt:p.negativePrompt || '', aspectRatio:p.aspectRatio, size:p.size, batchSize:1, loras, ...(p.mode ? {mode:p.mode} : {}), ...options };
}
export async function apiRequest(path, key, { payload, fetchFn = fetch, signal } = {}) {
    // Only plugin-selected PixAI paths reach this function; never a client-supplied URL.
    const response = await fetchFn(API + path, {
        method: payload ? 'POST' : 'GET',
        headers: { Authorization:`Bearer ${key}`, ...(payload ? {'Content-Type':'application/json'} : {}) },
        ...(payload ? {body:JSON.stringify(payload)} : {}),
        redirect:'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        // Do not echo upstream response bodies (may contain prompts or credentials).
        const code = typeof result.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(result.code) ? result.code : 'REQUEST_FAILED';
        throw new BridgeError(`PixAI HTTP ${response.status}: ${code}`, response.status);
    }
    return result;
}
export function projectTask(task) {
    return { id:task.id, status:task.status, outputs:{ mediaIds:task.outputs?.mediaIds || [] } };
}

const FACE_FIX_SIZES = {'1:1':[1024,1024],'2:3':[848,1280],'3:2':[1280,848],'3:4':[864,1152],'4:3':[1152,864],'3:5':[768,1280],'5:3':[1280,768],'9:16':[720,1280],'16:9':[1280,720]};
export async function prepareFaceFixRequest(payload,key,{fetchFn=fetch,signal}={}) {
    const p=validatePayload(payload);
    const dimensions=FACE_FIX_SIZES[p.aspectRatio];
    if(p.size!=='1k' || !dimensions)throw new BridgeError('Face Fix v1: select a 1k aspect ratio with both sides at most 1280px.');
    if(p.mode || p.style)throw new BridgeError('Face Fix does not accept Tsubaki mode/style settings.');
    if(p.loras.length>10)throw new BridgeError('Face Fix v1 supports at most 10 LoRAs.');
    if(new Set(p.loras.map(l=>l.modelId)).size!==p.loras.length)throw new BridgeError('Face Fix: remove duplicate LoRA IDs.');
    const metadata=await apiRequest(`/v2/generation-model-version/${p.modelVersionId}`,key,{fetchFn,signal});
    if(!String(metadata.modelType || '').toUpperCase().includes('SDXL'))throw new BridgeError('Face Fix: this release supports verified SDXL checkpoints only.');
    const triggers=await Promise.all(p.loras.map(async l=>{
        if(l.triggerWords!==undefined)return l.triggerWords;
        const version=await apiRequest(`/v2/generation-model-version/${l.modelId}`,key,{fetchFn,signal});
        const words=version.extra?.triggerWords;
        if(words!==undefined && words!==null && typeof words!=='string')throw new BridgeError('Could not read LoRA trigger words. Enter them manually before generating.');
        return words || '';
    }));
    const seen=new Set(p.prompt.split(',').map(tag=>tag.trim().toLowerCase().replaceAll('_',' ')));
    const additions=[];
    for(const words of triggers)for(const tag of words.split(',')){
        const trimmed=tag.trim(),normalized=trimmed.toLowerCase().replaceAll('_',' ');
        if(trimmed && !seen.has(normalized)){seen.add(normalized);additions.push(trimmed);}
    }
    const prompt=[p.prompt,...additions].join(', ');
    if(prompt.length>4096)throw new BridgeError('Face Fix v1: prompt including LoRA trigger words must not exceed 4096 characters.');
    const parameters={modelId:p.modelVersionId,prompts:prompt,negativePrompts:p.negativePrompt,width:dimensions[0],height:dimensions[1],batchSize:1,enableADetailer:true,promptHelper:{enable:false},lora:Object.fromEntries(p.loras.map(l=>[l.modelId,l.weight]))};
    if(p.seed!==undefined)parameters.seed=p.seed;
    if(p.sampling?.method!==undefined)parameters.samplingMethod=p.sampling.method;
    if(p.sampling?.steps!==undefined)parameters.samplingSteps=p.sampling.steps;
    if(p.sampling?.cfgScale!==undefined)parameters.cfgScale=p.sampling.cfgScale;
    return {parameters};
}
export function prepareRecipeRequest(payload) {
    const p=validatePayload(payload);
    if(!p.recipeIds?.length)throw new BridgeError('Missing recipe IDs.');
    if(p.modelVersionId!=='1983308862240288769')throw new BridgeError('Recipes: this release supports Tsubaki.2 only.');
    const dimensions=FACE_FIX_SIZES[p.aspectRatio];
    if(p.size!=='1k' || !dimensions)throw new BridgeError('Recipes: choose 1k up to 1280px per side.');
    if(p.enableADetailer || p.style || p.sampling || p.loras.length)throw new BridgeError('Recipes cannot be combined with Face Fix, API style, sampling overrides or LoRAs in this release.');
    if(p.prompt.length>4096)throw new BridgeError('Recipes v1: prompt must not exceed 4096 characters.');
    const parameters={modelId:p.modelVersionId,prompts:p.prompt,negativePrompts:p.negativePrompt,width:dimensions[0],height:dimensions[1],batchSize:1,inferenceProfile:p.mode || 'lite',recipeIds:p.recipeIds,promptHelper:{enable:false}};
    if(p.seed!==undefined)parameters.seed=p.seed;
    return {parameters};
}
export async function submitGeneration(payload,key,{fetchFn=fetch,signal}={}) {
    const p=validatePayload(payload);
    if(p.recipeIds?.length){
        const body=prepareRecipeRequest(p);
        const task=await apiRequest('/v1/task',key,{payload:body,fetchFn,signal});
        return {...projectTask(task),recipeIdsRequested:p.recipeIds,recipeApplicationVerified:false};
    }
    if(!p.enableADetailer)return projectTask(await apiRequest('/v2/image/create',key,{payload:p,fetchFn,signal}));
    const body=await prepareFaceFixRequest(p,key,{fetchFn,signal});
    // Exactly one paid submission. Never fall back to another generation endpoint.
    const task=await apiRequest('/v1/task',key,{payload:body,fetchFn,signal});
    return {...projectTask(task),resolvedPrompt:body.parameters.prompts,faceFixRequested:true};
}
