/* PixAI preset management, 2026-11-06. AFPL v9, see LICENSE. */
export const STYLE_KEYS = ["anime-watercolor-impasto", "art-crayon", "bold-line-soft-color", "chibi", "classic-japanese", "clean-flat-illustration", "colored-pencil-grain", "cool-warm-oil-contrast", "desaturated-cool", "flat-anime-pastel", "glossy-glass-anime", "grey-blocks-lineless", "hard-line-monochrome-accent", "high-contrast-retro-vivid", "holographic", "korean-style", "lineart-watercolor-airy", "low-saturation-expressive-eyes", "lucid-dreamy", "luminous-retro-impasto", "minimal-flat-color", "modern-oil-glamour", "moe-pastel", "oil-watercolor-blend", "painterly-doodle", "paper-watercolor", "pencil-sketch", "poster-graffiti", "retro-comic-fusion", "retro-oil-glamour", "retro-tv-anime", "semi-realistic", "stable-vaporwave", "tinted-sketch", "vintage-collage"];
export const QUALITY_TAGS = 'masterpiece, best quality, high quality, highest quality, amazing quality, very aesthetic, absurdres, highres, ultra detailed, highly detailed, extremely detailed, 4k, 8k, 16k';
export const KEYWORD_INSTRUCTION = `[PixAI scene keywords only]
For each image prompt, describe only visible scene content: subject count, character identity/name if needed, hair, eyes, physical traits, clothing, accessories, expression, pose, action, relationships/positions, setting, objects, time, weather and scene-relevant lighting/camera framing.
The image preset supplies ALL artistic style, artist tags, quality/detail boosters, positive/negative boilerplate, model, LoRA, sampler, steps, CFG, seed and resolution. Do not generate, repeat or override those. Do not add terms such as masterpiece, best quality, ultra detailed, highres, 4k or 8k. Do not invent LoRA tags or negative-prompt sections.
Preserve the existing required output structure, image markers, insertion locations, JSON/tool-call keys, character slots and coordinate syntax. Apply this restriction ONLY to image-prompt values; do not replace the whole response with bare tags when its protocol requires a wrapper. Use concise English comma-separated content tags where appropriate. Preserve supplied proper names. Do not change the number of images or add extra images.`;
const TEXT_KEYS = ['positivePrompt','postfixPrompt','negativePrompt','modelVersionId','aspectRatio','size','family','mode','stylePreset','samplingMethod','blockedTags','recipeIds'];
const RATIOS = ['1:1','2:3','3:2','3:4','4:3','3:5','5:3','9:16','16:9','1:3','3:1'];
export function parseRecipeIds(value='') {
    if(typeof value!=='string' || value.length>10000)throw new Error('Recipe IDs must be text.');
    const ids=value.trim() ? value.trim().split(/[\s,]+/).map(item=>{
        const match=item.match(/^https:\/\/(?:www\.)?pixai\.art\/(?:[a-z]{2}\/)?recipes\/(\d+)\/?(?:[?#].*)?$/);
        const id=match ? match[1] : item;
        if(!/^\d{1,30}$/.test(id))throw new Error('Enter numeric recipe IDs or PixAI recipe links, separated by commas or new lines.');
        return id;
    }) : [];
    if(ids.length>10)throw new Error('Maximum 10 recipe IDs in this experimental integration.');
    if(new Set(ids).size!==ids.length)throw new Error('Remove duplicate recipe IDs.');
    return ids;
}
export function blankPreset(name='Default') {
    return {name,positivePrompt:'',postfixPrompt:'',negativePrompt:'',modelVersionId:'',loras:[],aspectRatio:'1:1',size:'1k',family:'default',mode:'',stylePreset:'',samplingMethod:'',steps:'',cfgScale:'',seed:'',filterKeywords:true,blockedTags:QUALITY_TAGS,enableADetailer:false,recipeIds:''};
}
export function sanitizePreset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Preset must be an object.');
    const p=blankPreset();
    p.name=typeof raw.name==='string' ? raw.name.trim() : 'Imported preset';
    if(!p.name || p.name.length>100)throw new Error('Preset name must be 1–100 characters.');
    for(const key of TEXT_KEYS) {
        if(raw[key] !== undefined) {
            if(typeof raw[key]!=='string' || raw[key].length>10000)throw new Error(`Invalid field: ${key}.`);
            p[key]=raw[key];
        }
    }
    if(!RATIOS.includes(p.aspectRatio) || !['1k','1.5k'].includes(p.size) || !['default','sd','tsubaki'].includes(p.family))throw new Error('Invalid aspect ratio, size, or model family.');
    if(p.modelVersionId && !/^\d+$/.test(p.modelVersionId))throw new Error('Model version ID must be a numeric string.');
    if(p.mode && !['lite','standard','pro','ultra'].includes(p.mode))throw new Error('Invalid Tsubaki mode.');
    if(p.stylePreset && !STYLE_KEYS.includes(p.stylePreset))throw new Error('Invalid Tsubaki style.');
    if(p.negativePrompt.length>4096)throw new Error('Negative prompt must not exceed 4096 characters.');
    for(const key of ['steps','cfgScale','seed']) {
        const value=raw[key];
        if(value!==undefined && value!==null && !['number','string'].includes(typeof value))throw new Error(`${key} must be a number or blank.`);
        p[key]=value===undefined || value===null || value==='' ? '' : Number(value);
        if(p[key]!=='' && (!Number.isFinite(p[key]) || p[key]<0))throw new Error(`${key} must be a valid number or blank.`);
    }
    if(p.steps!=='' && (!Number.isInteger(p.steps) || p.steps<1 || p.steps>100))throw new Error('Steps must be an integer from 1 to 100.');
    if(p.seed!=='' && !Number.isSafeInteger(p.seed))throw new Error('Seed must be a nonnegative safe integer.');
    if(raw.loras!==undefined) {
        if(!Array.isArray(raw.loras) || raw.loras.length>15)throw new Error('Maximum 15 LoRAs; your account may have a lower limit.');
        p.loras=raw.loras.map(l=>{
            if(!l || typeof l.modelId!=='string' || (l.modelId && !/^\d+$/.test(l.modelId)))throw new Error('LoRA version ID must be a numeric string.');
            const weight=l.weight ?? 1;
            if(typeof weight!=='number' || !Number.isFinite(weight) || weight<0 || weight>1)throw new Error('LoRA weight must be between 0 and 1.');
            if(l.triggerWords!==undefined && (typeof l.triggerWords!=='string' || l.triggerWords.length>4096))throw new Error('Invalid LoRA trigger words.');
            return {modelId:l.modelId,weight,...(l.triggerWords!==undefined ? {triggerWords:l.triggerWords}: {})};
        });
    }
    p.recipeIds=parseRecipeIds(p.recipeIds).join('\n');
    p.filterKeywords=raw.filterKeywords !== false;
    if(raw.enableADetailer!==undefined && typeof raw.enableADetailer!=='boolean')throw new Error('Face Fix must be enabled or disabled.');
    p.enableADetailer=raw.enableADetailer===true;
    return p;
}
export function ensurePixaiState(parent) {
    const old=parent.pixai || {};
    if(old.schemaVersion===2 && old.presets && Object.keys(old.presets).length && Object.hasOwn(old.presets,old.activePresetId))return old;
    const p=blankPreset();
    for(const key of [...TEXT_KEYS,'steps','cfgScale','seed','enableADetailer'])if(old[key]!==undefined)p[key]=old[key];
    try{p.loras=typeof old.loras==='string' ? JSON.parse(old.loras || '[]') : old.loras || [];}catch{p.loras=[];}
    p.family=old.family || (old.mode ? 'tsubaki' : 'default');
    const banana=parent.banana || {};
    const bp=banana.conversationPresets?.[banana.conversationPresetId] || {};
    p.positivePrompt=old.positivePrompt ?? bp.fixedPrompt ?? '';
    p.postfixPrompt=old.postfixPrompt ?? bp.postfixPrompt ?? '';
    parent.pixai={schemaVersion:2,enabled:old.enabled===true,apiKey:old.apiKey || '',keywordOnly:old.keywordOnly!==false,activePresetId:'default',presets:{default:p}};
    return parent.pixai;
}
export function generationConfig(parent) {
    const state=ensurePixaiState(parent);
    const preset=sanitizePreset(state.presets[state.activePresetId]);
    return {...preset,apiKey:state.apiKey,presetId:state.activePresetId};
}
export function injectKeywordRule(messages,parent,requestType) {
    if(requestType!=='image_gen' || parent?.mode!=='banana' || parent?.pixai?.enabled!==true || parent.pixai.keywordOnly===false)return messages;
    if(!Array.isArray(messages) || messages.some(m=>typeof m?.content==='string' && m.content.includes('[PixAI scene keywords only]')))return messages;
    return [...messages,{role:'user',content:KEYWORD_INSTRUCTION}];
}
function normalizeTag(tag) {
    return tag.trim().toLowerCase().replace(/_/g,' ').replace(/^\d+(?:\.\d+)?::|::$/g,'').replace(/^[([{]+|[)\]}]+$/g,'').replace(/:\s*\d+(?:\.\d+)?$/,'').trim().replace(/\s+/g,' ');
}
export function filterSceneKeywords(text,preset) {
    const value=String(text || '').trim();
    if(!preset.filterKeywords)return value;
    const blocked=new Set(String(preset.blockedTags || '').split(/[,\n]/).map(normalizeTag).filter(Boolean));
    // Split commas only at bracket depth zero so weighted/grouped content stays intact.
    const tags=[];let start=0,depth=0;
    for(let i=0;i<value.length;i++){
        if('([{'.includes(value[i]))depth++;
        else if(')]}'.includes(value[i]))depth=Math.max(0,depth-1);
        else if(value[i]===',' && depth===0){tags.push(value.slice(start,i));start=i+1;}
    }
    tags.push(value.slice(start));
    return tags.filter(t=>t.trim() && !blocked.has(normalizeTag(t))).map(t=>t.trim()).join(', ');
}
export function buildPixaiPayload(settings,scene) {
    const p=sanitizePreset(settings);
    const cleaned=filterSceneKeywords(scene,p);
    if(!cleaned)throw new Error('No scene keywords remain. Check content and filter settings.');
    const prompt=[p.positivePrompt.trim(),cleaned,p.postfixPrompt.trim()].filter(Boolean).join(', ');
    const result={modelVersionId:p.modelVersionId,prompt,negativePrompt:p.negativePrompt,aspectRatio:p.aspectRatio,size:p.size,batchSize:1,loras:p.loras,promptHelper:'disable'};
    if(p.enableADetailer){
        if(p.family!=='sd')throw new Error('Face Fix: select SD / SDXL as the model family. This release supports SDXL checkpoints only.');
        if(p.size!=='1k' || ['1:3','3:1'].includes(p.aspectRatio))throw new Error('Face Fix: this v1 route supports 1k presets up to 1280px per side. Select 1k and another aspect ratio.');
        result.enableADetailer=true;
    }
    const recipes=parseRecipeIds(p.recipeIds);
    if(recipes.length){
        if(p.family!=='tsubaki' || p.modelVersionId!=='1983308862240288769')throw new Error('Recipes: this experimental release supports Tsubaki.2 (1983308862240288769) only.');
        if(p.size!=='1k' || ['1:3','3:1'].includes(p.aspectRatio))throw new Error('Recipes: choose 1k and an aspect ratio up to 1280px per side.');
        if(p.stylePreset)throw new Error('Recipes: set Tsubaki API style to None; use recipe IDs for styling.');
        if(p.loras.length)throw new Error('Recipes: LoRA combinations are not supported by this experimental route.');
        result.recipeIds=recipes;
    }
    if(p.seed!=='')result.seed=p.seed;
    if(p.family==='tsubaki'){
        if(p.mode)result.mode=p.mode;
        if(p.stylePreset)result.style={type:'preset',key:p.stylePreset};
    }
    if(p.family==='sd'){
        const sampling={};
        if(p.samplingMethod.trim())sampling.method=p.samplingMethod.trim();
        if(p.steps!=='')sampling.steps=p.steps;
        if(p.cfgScale!=='')sampling.cfgScale=p.cfgScale;
        if(Object.keys(sampling).length)result.sampling=sampling;
    }
    return result;
}
export function exportPresets(state,all=false) {
    const selected=all ? Object.values(state.presets) : [state.presets[state.activePresetId]];
    return {schema:'st-chatu8.pixai-presets',version:1,presets:selected.map(sanitizePreset)};
}
export function parsePresetImport(text) {
    if(text.length>1000000)throw new Error('Preset file exceeds 1MB.');
    const data=JSON.parse(text);
    if(data?.schema==='st-chatu8.pixai-quick-copy') {
        const settings=data.settings;
        if(data.version!==1 || data.type!=='preset' || !settings || typeof settings!=='object' || Array.isArray(settings)) {
            throw new Error('Expected a version 1 PixAI Quick Copy preset.');
        }
        const {prompt,negativePrompt,modelVersionId,loras,aspectRatio,samplingMethod,steps,cfgScale,seed}=settings;
        if([prompt,negativePrompt,modelVersionId,aspectRatio,samplingMethod,steps,cfgScale,seed].every(value=>value===undefined) && !loras?.length) {
            throw new Error('No supported settings found in the PixAI Quick Copy preset.');
        }
        return [sanitizePreset({name:data.name,positivePrompt:prompt,negativePrompt,modelVersionId,loras,aspectRatio,samplingMethod,steps,cfgScale,seed})];
    }
    if(data?.schema!=='st-chatu8.pixai-presets' || data.version!==1 || !Array.isArray(data.presets) || !data.presets.length || data.presets.length>100)throw new Error('Expected a version 1 PixAI preset file or PixAI Quick Copy preset.');
    return data.presets.map(sanitizePreset);
}
export function addImportedPresets(state,presets,idFactory) {
    const names=new Set(Object.values(state.presets).map(p=>p.name));
    for(const item of presets){
        const p=sanitizePreset(item);const base=p.name;let n=2;
        while(names.has(p.name))p.name=base.slice(0,90)+` (${n++})`;
        names.add(p.name);const id=idFactory();state.presets[id]=p;state.activePresetId=id;
    }
}
