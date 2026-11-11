/* PixAI integration, 2026-11-06. Distributed under the accompanying AFPL v9. */
const ROOT = '/api/plugins/chatu8-pixai';
import { STYLE_KEYS, blankPreset, sanitizePreset, ensurePixaiState, generationConfig, buildPixaiPayload, exportPresets, parsePresetImport, addImportedPresets } from './pixai-presets.js';
export async function generatePixaiImage({ settings, prompt, signal, headers, onProgress = () => {}, onPayload = () => {} }) {
    if (!settings.apiKey?.trim()) throw new Error('PixAI: enter your official API key.');
    if (!/^\d+$/.test(settings.modelVersionId || '')) throw new Error('PixAI: enter the model version ID (numeric suffix in the version URL).');
    const payload = buildPixaiPayload(settings, prompt);
    onPayload(payload);
    async function request(route, data) {
        const response = await fetch(ROOT + route, {
            method: 'POST', headers: headers(), signal,
            body: JSON.stringify({ apiKey: settings.apiKey.trim(), ...data }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `PixAI bridge HTTP ${response.status}. Check the server plugin and reload SillyTavern.`);
        }
        return response.json();
    }
    const sleep = (ms) => new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const cancel = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
        signal?.addEventListener('abort', cancel, { once: true });
    });
    const health = await fetch(ROOT + '/health', { signal });
    const bridge = await health.json().catch(() => ({}));
    if (!health.ok || bridge.provider !== 'PixAI' || !['0.2.0','0.4.0','0.5.0'].includes(bridge.version)) throw new Error('Install PixAI server plugin v0.2.0, v0.4.0 or v0.5.0 before generating images.');
    if(payload.enableADetailer && bridge.features?.faceFix!==true)throw new Error('Face Fix needs server plugin v0.4.0. Copy both server files and restart SillyTavern before generating.');
    if(payload.recipeIds?.length && bridge.features?.recipes!==true)throw new Error('Recipes need server plugin v0.5.0. Copy both server files and restart SillyTavern.');
    onProgress('Submitting request');
    // Never retry task creation automatically: a lost response may still have spent credits.
    let task = await request('/submit', { payload });
    const resolvedPrompt=task.resolvedPrompt || payload.prompt;
    const taskId = task.id;
    if (!taskId) throw new Error('PixAI returned no task ID. Check history before retrying.');
    const deadline = Date.now() + 20 * 60 * 1000;
    let failures = 0;
    while (!['completed', 'failed', 'cancelled'].includes(task.status)) {
        if (Date.now() > deadline) throw new Error(`PixAI timed out. Task ${taskId}; no additional images generated automatically.`);
        onProgress(`${task.status || 'waiting'} · ${taskId}`);
        await sleep(Math.min(1500 * (2 ** failures), 12000));
        try { task = await request('/task', { taskId }); failures = 0; }
        catch (error) {
            if (signal?.aborted) throw error;
            if (++failures >= 4) throw new Error(`${error.message} · Task ${taskId}; no automatic retry.`);
        }
    }
    if (task.status !== 'completed') throw new Error(`PixAI: ${task.status} · ${taskId}`);
    const mediaId = task.outputs?.mediaIds?.[0];
    if (!mediaId) throw new Error(`PixAI completed without a media ID. Task ${taskId}`);
    onProgress('Downloading image');
    const result = await request('/image', { mediaId });
    return {
        image: result.image, isVideo: false, format: result.format,
        originalUrl: '', genParams: { provider: 'PixAI', taskId, presetId: settings.presetId, preset: settings.name, model: payload.modelVersionId, resolvedPrompt, negativePrompt: payload.negativePrompt,faceFixRequested:payload.enableADetailer===true,recipeIdsRequested:payload.recipeIds || [],recipeApplicationVerified:false,apiVersion:payload.enableADetailer || payload.recipeIds?.length?'v1':'v2' },
    };
}

export function initPixaiSettings({ getSettings, save }) {
    const mount = () => {
        const container=document.getElementById('st-chatu8-tab-banana');
        const parent=getSettings();
        if(!container || !parent || container.querySelector('#ch-pixai-settings'))return;
        const state=ensurePixaiState(parent);
        const section=document.createElement('section');
        section.id='ch-pixai-settings';section.className='st-chatu8-settings-section';
        section.innerHTML=`
          <h3>PixAI · Image presets</h3>
          <p>Positive prefix → character / scene keywords from LLM → positive suffix. Negative and LoRAs are sent separately.</p>
          <label><input type="checkbox" data-global="enabled"> Enable PixAI provider (main mode: Banana/Grok)</label>
          <div class="st-chatu8-field-col"><label>PixAI API key · shared across presets, excluded from preset exports</label><input class="st-chatu8-text-input" type="password" autocomplete="off" data-global="apiKey"></div>
          <label><input type="checkbox" data-global="keywordOnly"> Ask LLM for content keywords only, without style, quality boosts, or parameters</label>
          <p>Applies to PixAI image-prompt requests only. Preserves output structure and image insertion positions.</p>
          <div class="st-chatu8-field-col"><label>Active preset</label><select class="st-chatu8-select" id="ch-pixai-preset"></select></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
            <button class="st-chatu8-btn" type="button" data-action="new">New</button>
            <button class="st-chatu8-btn" type="button" data-action="copy">Duplicate</button>
            <button class="st-chatu8-btn" type="button" data-action="save">Save</button>
            <button class="st-chatu8-btn" type="button" data-action="delete">Delete</button>
            <button class="st-chatu8-btn" type="button" data-action="export">Export current preset</button>
            <button class="st-chatu8-btn" type="button" data-action="export-all">Export all</button>
            <button class="st-chatu8-btn" type="button" data-action="import">Import presets</button>
            <input hidden type="file" accept=".json,application/json" id="ch-pixai-import">
          </div>
          <details>
            <summary>Paste PixAI Quick Copy preset</summary>
            <textarea class="st-chatu8-textarea" rows="4" id="ch-pixai-import-text" aria-label="PixAI preset JSON" placeholder="Paste the JSON from Copy PixAI Preset"></textarea>
            <button class="st-chatu8-btn" type="button" data-action="import-text">Import pasted preset</button>
          </details>
          <div class="st-chatu8-field-col"><label>Preset name · edit to rename</label><input class="st-chatu8-text-input" data-preset="name" maxlength="100"></div>
          <div class="st-chatu8-field-col"><label>Fixed positive prefix · before keywords</label><textarea class="st-chatu8-textarea" rows="3" data-preset="positivePrompt" placeholder="Fixed style, quality, and artist tags..."></textarea></div>
          <div class="st-chatu8-field-col"><label>Fixed positive suffix · after keywords</label><textarea class="st-chatu8-textarea" rows="2" data-preset="postfixPrompt"></textarea></div>
          <div class="st-chatu8-field-col"><label>Fixed negative prompt</label><textarea class="st-chatu8-textarea" rows="3" data-preset="negativePrompt"></textarea></div>
          <div class="st-chatu8-field-col"><label>Model version ID · numeric suffix in the PixAI version URL</label><input class="st-chatu8-text-input" data-preset="modelVersionId" inputmode="numeric"></div>
          <div class="st-chatu8-field-col"><label>Model family · determines supported API parameters</label><select class="st-chatu8-select" data-preset="family"><option value="default">Default · omit sampling / mode / style API parameters</option><option value="sd">SD / SDXL</option><option value="tsubaki">Tsubaki</option></select></div>
          <div class="st-chatu8-field-col"><label>Aspect ratio</label><select class="st-chatu8-select" data-preset="aspectRatio">${['1:1','2:3','3:2','3:4','4:3','3:5','5:3','9:16','16:9','1:3','3:1'].map(x=>`<option>${x}</option>`).join('')}</select></div>
          <div class="st-chatu8-field-col"><label>Resolution</label><select class="st-chatu8-select" data-preset="size"><option value="1k">1k</option><option value="1.5k">1.5k</option></select></div>
          <div class="st-chatu8-field-col"><label>Seed · blank for random</label><input class="st-chatu8-text-input" type="number" min="0" step="1" data-preset="seed"></div>
          <div data-family="sd">
            <label><input type="checkbox" data-preset="enableADetailer"> Face Fix / ADetailer · extra PixAI credits</label>
            <p>SDXL checkpoints only. Your screenshot showed +400 credits; actual billing is set by PixAI. Off by default, saved per preset. Requires bridge v0.4.0 and an ST restart after installation. Uses API v1 with 1k presets up to 1280px per side. LoRA trigger words are preserved automatically. Turning this on affects new generations only.</p>
            <div class="st-chatu8-field-col"><label>Sampler · blank for model default</label><input class="st-chatu8-text-input" data-preset="samplingMethod" placeholder="E.g. DPM++ 2M Karras"></div>
            <div class="st-chatu8-field-col"><label>Steps (1–100) · blank for default</label><input class="st-chatu8-text-input" type="number" min="1" max="100" step="1" data-preset="steps"></div>
            <div class="st-chatu8-field-col"><label>CFG · blank for default</label><input class="st-chatu8-text-input" type="number" min="0" step="0.1" data-preset="cfgScale"></div>
          </div>
          <div data-family="tsubaki">
            <div class="st-chatu8-field-col"><label>Recipe IDs / PixAI recipe links · experimental</label><textarea class="st-chatu8-textarea" rows="3" data-preset="recipeIds" placeholder="2067029411454978868&#10;2047210364701843526"></textarea></div>
            <p>Comma or newline separated; order is preserved. Blank disables recipes. Saved per preset and included in preset exports. Tested with Tsubaki.2 (1983308862240288769), 1k only. Use API style None and no LoRAs. Default mode uses lite on this route. Hidden prompts stay on PixAI. REST recipe support is undocumented; a completed image does not confirm every recipe applied. Requires bridge v0.5.0 and an ST restart.</p>
            <div class="st-chatu8-field-col"><label>Tsubaki mode</label><select class="st-chatu8-select" data-preset="mode"><option value="">Default</option>${['lite','standard','pro','ultra'].map(x=>`<option>${x}</option>`).join('')}</select></div>
            <div class="st-chatu8-field-col"><label>Tsubaki API style · optional, separate from fixed positive</label><select class="st-chatu8-select" data-preset="stylePreset"><option value="">None</option>${STYLE_KEYS.map(x=>`<option>${x}</option>`).join('')}</select></div>
          </div>
          <h4>Preset LoRAs</h4>
          <div id="ch-pixai-loras"></div><button class="st-chatu8-btn" type="button" data-action="add-lora">+ Add LoRA</button>
          <p>LoRA version ID; weight 0–1. Blank trigger words use LoRA defaults. Match the LoRA to its base model.</p>
          <label><input type="checkbox" data-preset="filterKeywords"> Remove redundant quality tags from dynamic keywords</label>
          <div class="st-chatu8-field-col"><label>Blocked tags · exact tag match, comma-separated</label><textarea class="st-chatu8-textarea" rows="2" data-preset="blockedTags"></textarea></div>
          <p>Only dynamic keywords are filtered. Your fixed positive / negative prompts are preserved. PixAI Prompt Helper is always disabled.</p>
          <details><summary>Preview prompt composition · no credits used</summary>
            <textarea class="st-chatu8-textarea" rows="2" id="ch-pixai-example" placeholder="Example scene keywords">1boy, black hair, brown eyes, cream cardigan, smiling, recording studio, best quality</textarea>
            <button class="st-chatu8-btn" type="button" data-action="preview">Xem prompt</button>
            <pre id="ch-pixai-preview" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
          </details>
          <button class="st-chatu8-btn" type="button" data-action="health">Check server plugin · no image generated</button>
          <p id="ch-pixai-status" aria-live="polite"></p>
          <p>Presets apply to the next generation or regeneration. Existing and cached images keep their style.</p>
          <p>Valid fields save automatically. The key is stored in SillyTavern settings. Preset export buttons exclude it; full st-chatu8 settings exports may include it.</p>`;
        container.prepend(section);
        const find=s=>section.querySelector(s);
        const status=text=>{find('#ch-pixai-status').textContent=text;};
        const select=find('#ch-pixai-preset');
        const currentState=()=>ensurePixaiState(getSettings());
        let deleting=null;
        const renderSelect=()=>{
            const s=currentState();select.replaceChildren();
            for(const [id,p] of Object.entries(s.presets)){
                const option=document.createElement('option');option.value=id;option.textContent=p.name;select.append(option);
            }
            select.value=s.activePresetId;
        };
        const familyVisibility=()=>{
            const family=find('[data-preset="family"]').value;
            section.querySelectorAll('[data-family]').forEach(el=>{el.hidden=el.dataset.family!==family;});
        };
        function appendLora(lora={modelId:'',weight:0.7}) {
            const row=document.createElement('div');row.className='ch-pixai-lora';
            row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;align-items:center';
            row.innerHTML='<input class="st-chatu8-text-input" data-lora="modelId" aria-label="LoRA version ID" placeholder="LoRA version ID" style="flex:2;min-width:140px"><input class="st-chatu8-text-input" data-lora="weight" type="number" min="0" max="1" step="0.05" aria-label="LoRA weight" style="flex:1;min-width:70px"><input class="st-chatu8-text-input" data-lora="triggerWords" placeholder="Trigger words (optional)" aria-label="LoRA trigger words" style="flex:2;min-width:120px"><button class="st-chatu8-btn" type="button" aria-label="Remove LoRA">×</button>';
            for(const key of ['modelId','weight','triggerWords'])row.querySelector(`[data-lora="${key}"]`).value=lora[key] ?? '';
            row.querySelector('button').onclick=()=>{row.remove();saveForm();};
            find('#ch-pixai-loras').append(row);
        }
        function collectForm() {
            const raw={};
            section.querySelectorAll('[data-preset]').forEach(el=>{raw[el.dataset.preset]=el.type==='checkbox' ? el.checked : el.value;});
            raw.loras=[...section.querySelectorAll('.ch-pixai-lora')].map(row=>{
                const trigger=row.querySelector('[data-lora="triggerWords"]').value.trim();
                return {modelId:row.querySelector('[data-lora="modelId"]').value.trim(),weight:Number(row.querySelector('[data-lora="weight"]').value),...(trigger ? {triggerWords:trigger}: {})};
            });
            const p=sanitizePreset(raw);const s=currentState();
            if(Object.entries(s.presets).some(([id,item])=>id!==s.activePresetId && item.name===p.name))throw new Error('Preset name already exists. Choose another.');
            return p;
        }
        function saveForm() {
            try{
                const p=collectForm();const s=currentState();s.presets[s.activePresetId]=p;save();
                const option=[...select.options].find(o=>o.value===s.activePresetId);if(option)option.textContent=p.name;
                familyVisibility();status('Preset saved: '+p.name);return true;
            }catch(error){status('Not saved: '+error.message);return false;}
        }
        const renderForm=()=>{
            const s=currentState();const p=sanitizePreset(s.presets[s.activePresetId]);
            section.querySelectorAll('[data-preset]').forEach(el=>{if(el.type==='checkbox')el.checked=p[el.dataset.preset];else el.value=p[el.dataset.preset];});
            find('#ch-pixai-loras').replaceChildren();p.loras.forEach(appendLora);familyVisibility();
            deleting=null;find('[data-action="delete"]').textContent='Delete';find('#ch-pixai-preview').textContent='';
        };
        section.querySelectorAll('[data-global]').forEach(input=>{
            const key=input.dataset.global;
            if(input.type==='checkbox')input.checked=state[key]!==false;else input.value=state[key] || '';
            input.onchange=()=>{currentState()[key]=input.type==='checkbox' ? input.checked : input.value.trim();save();};
        });
        section.addEventListener('change',event=>{
            if(event.target.matches('[data-preset],[data-lora]'))saveForm();
        });
        select.onchange=()=>{
            const next=select.value;
            if(!saveForm()){select.value=currentState().activePresetId;return;}
            currentState().activePresetId=next;save();renderForm();status('Switched to '+currentState().presets[next].name);
        };
        const uniqueName=base=>{base=base.slice(0,90);let name=base,n=2;const names=Object.values(currentState().presets).map(p=>p.name);while(names.includes(name))name=base.slice(0,90)+` (${n++})`;return name;};
        const makeId=()=>crypto.randomUUID();
        const importPresets=text=>{
            const presets=parsePresetImport(text);
            addImportedPresets(currentState(),presets,makeId);
            save();renderSelect();renderForm();
            status(`Imported ${presets.length} presets. Current API key preserved.`);
        };
        section.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
            const action=button.dataset.action;
            try {
                if(action==='health'){
                    const r=await fetch(ROOT+'/health');const info=await r.json();
                    if(!r.ok || info.provider!=='PixAI' || !['0.2.0','0.4.0','0.5.0'].includes(info.version))throw new Error('Install PixAI server plugin v0.5.0 and restart SillyTavern.');
                    status(`Server plugin v${info.version} ready. Face Fix: ${info.features?.faceFix?'available':'needs bridge v0.4.0'}. Recipes: ${info.features?.recipes?'available':'needs bridge v0.5.0'}. API key and quota have not been checked.`);return;
                }
                if(action==='import'){find('#ch-pixai-import').click();return;}
                if(!saveForm())return;
                if(action==='import-text'){
                    const input=find('#ch-pixai-import-text');
                    if(!input.value.trim())throw new Error('Paste a PixAI preset first.');
                    importPresets(input.value);
                    input.value='';
                    return;
                }
                const s=currentState();
                if(action==='add-lora'){
                    if(section.querySelectorAll('.ch-pixai-lora').length>=15)throw new Error('Maximum 15 LoRAs.');
                    appendLora();saveForm();
                }else if(action==='new' || action==='copy'){
                    const p=action==='new' ? blankPreset(uniqueName('New preset')) : {...sanitizePreset(s.presets[s.activePresetId]),name:uniqueName(s.presets[s.activePresetId].name+' — copy')};
                    const id=makeId();s.presets[id]=p;s.activePresetId=id;save();renderSelect();renderForm();status('Created '+p.name);
                }else if(action==='delete'){
                    if(Object.keys(s.presets).length<=1)throw new Error('Keep at least one preset.');
                    if(deleting!==s.activePresetId){deleting=s.activePresetId;button.textContent='Click again to delete';status('Click Delete again to confirm.');return;}
                    delete s.presets[s.activePresetId];s.activePresetId=Object.keys(s.presets)[0];save();renderSelect();renderForm();status('Preset deleted.');
                }else if(action==='export' || action==='export-all'){
                    const blob=new Blob([JSON.stringify(exportPresets(s,action==='export-all'),null,2)],{type:'application/json'});
                    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='PixAI_presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Presets exported without API key.');
                }else if(action==='preview'){
                    const payload=buildPixaiPayload(generationConfig(getSettings()),find('#ch-pixai-example').value);
                    find('#ch-pixai-preview').textContent=`Positive:\n${payload.prompt}\n\nNegative:\n${payload.negativePrompt || '(empty)'}\n\nModel: ${payload.modelVersionId || '(not entered)'} · Prompt Helper: disabled`;
                }
            }catch(error){status(error.message);}
        });
        find('#ch-pixai-import').onchange=async event=>{
            try{
                if(!saveForm())return;
                const file=event.target.files?.[0];if(!file)return;
                if(file.size>1000000)throw new Error('Preset file exceeds 1MB.');
                importPresets(await file.text());
            }catch(error){status(error.message);}finally{event.target.value='';}
        };
        renderSelect();renderForm();save();
    };
    const start=()=>{mount();const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
