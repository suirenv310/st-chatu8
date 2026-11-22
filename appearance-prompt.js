/* Read-only reuse of Send Data / image-keyword context, 2026-11-22. AFPL v9. */
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const paths = name => String(name).trim().split('.');
const validPath = parts => parts.length && parts.every(part => part && !forbidden.has(part));
const valueText = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

// Simulate supported variable macros on private copies only. Extraction/preview
// must never write chatMetadata, extensionSettings or the live worldVars store.
export function createReadOnlyVariableRenderer(context = {}) {
    const stores = {
        var: structuredClone(context.chatMetadata?.variables || {}),
        globalvar: structuredClone(context.extensionSettings?.variables || {}),
        worldvar: {},
    };
    const get = (kind, name) => {
        const parts = paths(name);
        if (!validPath(parts)) return '';
        let value = stores[kind];
        for (const part of parts) {
            if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return '';
            value = value[part];
        }
        return valueText(value);
    };
    const set = (kind, name, value) => {
        const parts = paths(name);
        if (!validPath(parts)) return;
        let node = stores[kind];
        for (const part of parts.slice(0, -1)) {
            if (!Object.hasOwn(node, part) || !node[part] || typeof node[part] !== 'object') node[part] = {};
            node = node[part];
        }
        node[parts.at(-1)] = value;
    };
    return input => {
        let result = String(input || '');
        const setters = /\{@set(var|globalvar|worldvar)::([^:@]+)::([\s\S]*?)@\}|\{\{set(var|globalvar|worldvar)::([^:}]+)::([\s\S]*?)\}\}/g;
        result = result.replace(setters, (_match, kindA, nameA, valueA, kindB, nameB, valueB) => {
            set(kindA || kindB, nameA || nameB, valueA ?? valueB ?? '');
            return '';
        });
        for (let round = 0; round < 3; round++) {
            const next = result.replace(/\{@get(var|globalvar|worldvar)::([^@]+)@\}|\{\{get(var|globalvar|worldvar)::([^}]+)\}\}/g,
                (_match, kindA, nameA, kindB, nameB) => get(kindA || kindB, nameA || nameB));
            if (next === result) break;
            result = next;
        }
        // Getter values can themselves contain macros. Never pass a remaining
        // assignment to the downstream (normally stateful) request processor.
        result = result.replace(setters, '');
        return result.replace(/\{\{user\}\}|<user>/g, () => context.name1 || '')
            .replace(/\{\{char\}\}/g, () => context.name2 || '');
    };
}

export function readOnlyPromptVariables(messages, context) {
    const render = createReadOnlyVariableRenderer(context);
    return messages.map(message => ({ ...message, content: typeof message.content === 'string'
        ? render(message.content)
        : Array.isArray(message.content) ? message.content.map(part => part.type === 'text' ? { ...part, text: render(part.text) } : { ...part }) : message.content }));
}

export function appearancePromptOptions(settings) {
    return { useImagePrompt: settings?.appearanceExtraction?.useImagePrompt !== false };
}

export function prepareAppearanceSources(sources, context) {
    const render = createReadOnlyVariableRenderer(context);
    // Worldbook assignments are local to this read and may supply later references.
    const lorebook = render(sources.lorebook);
    return { ...sources, lorebook, name: render(sources.name), card: render(sources.card), persona: render(sources.persona), description: render(sources.description) };
}

export function renderImageKeywordReference(messages, sources, context) {
    const demand = `Extract stable body appearance for ${sources.name || 'the single named character'} into Character Preset fields.\n${sources.description || ''}`;
    const body = [sources.description, sources.card, sources.persona].filter(Boolean).join('\n\n');
    const replacements = new Map([
        ['上下文', ''], ['楼层信息', ''], ['正文', body], ['世界书触发', sources.lorebook || ''],
        ['用户需求', demand], ['当前角色', sources.card || ''], ['当前服装', ''], ['服装列表', ''],
        ['角色启用列表', ''], ['通用服装启用列表', ''], ['通用角色启用列表', ''],
        ['视频素材', ''], ['视频资产', ''], ['角色资产', ''], ['身体部位', ''], ['身体部位资产', ''],
        ['场景资产', ''], ['道具资产', ''], ['姿势资产', ''], ['秒数', ''], ['视频秒数', ''], ['duration', ''],
    ]);
    const filled = messages.map(message => ({ ...message, content: typeof message.content === 'string'
        ? message.content.replace(/\{\{([^{}]+)\}\}/g, (match, key) => replacements.has(key) ? replacements.get(key) : match)
        : message.content }));
    return readOnlyPromptVariables(filled, context);
}
