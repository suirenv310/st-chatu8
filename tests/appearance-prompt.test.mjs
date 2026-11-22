import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createReadOnlyVariableRenderer, readOnlyPromptVariables, appearancePromptOptions } from '../appearance-prompt.js';
import { prepareAppearanceRequest, parseAppearanceResult, saveAppearancePreset, contextIdentity } from '../appearance.js';

const bundle = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
function functionSource(name) {
    const pattern = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    const start = bundle.search(pattern);
    assert.notEqual(start, -1, name);
    const end = bundle.indexOf('\n}', start) + 2;
    return bundle.slice(start, end);
}
const context = () => ({ characterId: 0, chatId: 'Ayato branch', name1: 'Sui', name2: 'Ayato',
    chatMetadata: { variables: { hair: 'blue_hair', count: 0, nested: { eyes: 'blue_eyes' }, flag: false } },
    extensionSettings: { variables: { skin: 'pale_skin' } }, chat: [{ mes: 'DO NOT READ OR WRITE THIS CHAT' }] });
const sources = () => ({ name: 'Ayato', card: 'Ayato is a man with blue hair.', persona: '',
    lorebook: 'Ayato: short hair, blue eyes. Another character: red hair.', description: 'Ayato has pale skin.' });

test('reuses active image-keyword conversion rules with real source placeholders, output remains body JSON', async () => {
    const ctx = context(), original = structuredClone(ctx);
    let trigger;
    const messages = await prepareAppearanceRequest(sources(), {
        getContext: () => ctx,
        getKeywordPrompt: text => {
            trigger = text;
            return [{ role: 'system', content: 'Map 苍蓝色头发 to blue_hair; keep atomic Danbooru tags. Scene format: <image>...</image>.' },
                { role: 'user', content: '{{世界书触发}}\n{{正文}}\n{{用户需求}}\n{{上下文}}\n{{角色启用列表}}' }];
        },
    });
    assert.match(trigger, /Ayato.*\n/s);
    assert.match(trigger, /Another character/);
    assert.match(messages[1].content, /Map 苍蓝色头发 to blue_hair/);
    assert.match(messages[1].content, /Ayato: short hair, blue eyes/);
    assert.doesNotMatch(messages[1].content, /\{\{(?:世界书触发|正文|上下文|用户需求|角色启用列表)\}\}/);
    assert.match(messages[0].content, /FIELD PLACEMENT/);
    assert.match(messages.at(-1).content, /Return exactly one JSON object/);
    assert.match(messages[1].content, /Never copy example traits into the target/);
    assert.doesNotMatch(JSON.stringify(messages), /DO NOT READ OR WRITE THIS CHAT/);
    assert.deepEqual(ctx, original);
});

test('conversion prompt follows selection afresh on each run; disabled reuse keeps independent extraction', async () => {
    let profile = 'conversion-A', calls = 0;
    const dependencies = { getContext: context, getKeywordPrompt: () => { calls++; return [{ role: 'user', content: profile }]; } };
    const a = await prepareAppearanceRequest(sources(), dependencies);
    profile = 'conversion-B';
    const b = await prepareAppearanceRequest(sources(), dependencies);
    const independent = await prepareAppearanceRequest(sources(), { ...dependencies, useImagePrompt: false });
    assert.match(a[1].content, /conversion-A/);
    assert.match(b[1].content, /conversion-B/);
    assert.equal(independent.length, 2);
    assert.equal(calls, 2);
    assert.equal(appearancePromptOptions({}).useImagePrompt, true);
    assert.equal(appearancePromptOptions({ appearanceExtraction: { useImagePrompt: false } }).useImagePrompt, false);
});

test('empty data, missing context preset and switched chats fail before any save', async () => {
    await assert.rejects(prepareAppearanceRequest({ name: 'Ayato' }, { getContext: context, getKeywordPrompt: () => assert.fail() }), /No source text/);
    await assert.rejects(prepareAppearanceRequest(sources(), { getContext: context, getKeywordPrompt: () => [] }), /No active image-keyword/);
    const ctx = context();
    await assert.rejects(prepareAppearanceRequest({ ...sources(), identity: contextIdentity(ctx) }, {
        getContext: () => ctx,
        getKeywordPrompt: async () => { ctx.chatId = 'different chat'; return [{ role: 'user', content: 'rules' }]; },
    }), /changed/);
});

test('preview variable setters are simulated locally with nested/false/zero values; live state stays exact', () => {
    const ctx = context(), before = structuredClone(ctx);
    const render = createReadOnlyVariableRenderer(ctx);
    assert.equal(render('{@setvar::nested.eyes::green_eyes@}{{setglobalvar::skin::dark_skin}}{{setworldvar::build::slender}}'), '');
    assert.equal(render('{{getvar::nested.eyes}}, {@getglobalvar::skin@}, {{getworldvar::build}}, {{getvar::count}}, {{getvar::flag}}, {{user}}, {{char}}'),
        'green_eyes, dark_skin, slender, 0, false, Sui, Ayato');
    assert.deepEqual(ctx, before);
    assert.equal(render('{{setvar::__proto__.polluted::yes}}{{getvar::__proto__.polluted}}'), '');
    assert.equal({}.polluted, undefined);
});

test('sources and inherited prompt macros cannot write state via downstream preprocessing', async () => {
    const ctx = context(), before = structuredClone(ctx);
    const messages = await prepareAppearanceRequest({ ...sources(),
        lorebook: '{@setworldvar::hair::blue_hair@}Ayato: {@getworldvar::hair@}. {{setvar::changed::yes}}',
        description: '{{setglobalvar::skin::dark_skin}}Ayato: {{getglobalvar::skin}}.',
    }, { getContext: () => ctx, getKeywordPrompt: () => [{ role: 'user', content: '{{setvar::prompt_write::yes}}{{世界书触发}} {{getvar::nested.eyes}}' }] });
    assert.match(JSON.stringify(messages), /blue_hair/);
    assert.match(messages.at(-1).content, /dark_skin/);
    assert.doesNotMatch(JSON.stringify(messages), /(?:setvar|setglobalvar|setworldvar)::/);
    assert.deepEqual(ctx, before);
});

test('read-only macros preserve names, fields and multimodal parts without mutating inputs', () => {
    const input = [{ role: 'user', content: [{ type: 'text', text: '{{char}} {{getvar::hair}}' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] }];
    const original = structuredClone(input);
    const result = readOnlyPromptVariables(input, context());
    assert.equal(result[0].content[0].text, 'Ayato blue_hair');
    assert.deepEqual(result[0].content[1], input[0].content[1]);
    assert.deepEqual(input, original);
});

test('actual image_gen context builder keeps enabled/triggered entries and avoids stateful macro processing only for extraction', () => {
    const ctx = context(), settings = {
        llm_request_type_configs: { image_gen: { context_profile: 'custom' } },
        test_context_profiles: { custom: { entries: [
            { enabled: true, content: 'Danbooru conversion {{getvar::hair}}' },
            { enabled: false, content: 'DISABLED' },
            { enabled: true, triggerMode: 'trigger', triggerWords: 'Ayato', content: 'Ayato-specific conversion' },
            { enabled: true, triggerMode: 'trigger', triggerWords: 'SomeoneElse', content: 'WRONG CHARACTER' },
            { enabled: true, content: '{{setvar::changed::yes}}' },
        ] } },
    };
    let normalCalls = 0;
    const sandbox = vm.createContext({ extension_settings17: { test: settings }, extensionName: 'test',
        stripPresetComments: value => value, checkTriggerWords: (words, trigger) => trigger.includes(words),
        getMergeOptionsForRequestType: () => ({}), mergeAdjacentMessages: messages => messages,
        processRollPlaceholders: messages => messages, getContext4: () => ctx, readOnlyPromptVariables,
        processVariablePlaceholdersInMessages: messages => { normalCalls++; return messages; },
    });
    vm.runInContext(functionSource('buildPromptForRequestType'), sandbox);
    const result = sandbox.buildPromptForRequestType('image_gen', 'Ayato', { readOnly: true });
    assert.match(JSON.stringify(result), /blue_hair/);
    assert.match(JSON.stringify(result), /Ayato-specific/);
    assert.doesNotMatch(JSON.stringify(result), /DISABLED|WRONG CHARACTER|setvar::/);
    assert.equal(normalCalls, 0);
    sandbox.buildPromptForRequestType('image_gen', 'Ayato');
    assert.equal(normalCalls, 1);
    assert.equal(ctx.chatMetadata.variables.changed, undefined);
});

test('actual Send Data reader shares entry selection, force, disable and recursive triggers in read-only mode', async () => {
    const settings = { worldBookConfig: {
        worldBookSelections: { Lore: true, UnselectedBook: false },
        worldEntrySelections: { Lore: { 1: true, 2: 'force', 3: true, 4: false, 5: true, 6: true } },
    } };
    const entries = [
        { uid: 1, key: ['Ayato'], content: 'Ayato has blue hair. Yashiro.', order: 20 },
        { uid: 2, key: ['not present'], content: 'Forced entry.', order: 10 },
        { uid: 3, key: ['Yashiro'], content: 'Recursive entry.', order: 5 },
        { uid: 4, key: ['Ayato'], content: 'UNSELECTED ENTRY' },
        { uid: 5, key: ['Ayato'], content: 'DISABLED ENTRY', disable: true },
        { uid: 6, key: ['other'], content: 'UNTRIGGERED ENTRY' },
    ];
    let clears = 0, statefulExpansion = 0;
    const sandbox = vm.createContext({
        extension_settings13: { test: settings }, extensionName: 'test',
        clearWorldVars: () => clears++, processVariablePlaceholders: value => { statefulExpansion++; return value; },
        getcharWorld: async () => '', getrWorlds: async () => ['Lore', 'UnselectedBook'],
        getWorldEntries: async book => { assert.equal(book, 'Lore'); return entries; },
        prepareWorldEntries: entries => entries, getWorldEntrySelectionKey: entry => entry.uid,
        console: { log() {}, error(error) { throw error; } },
    });
    for (const name of ['processWorldBooksWithTrigger', 'processWorldBooksWithTriggerStructured', 'processSingleWorldBookStructured', 'processEntriesRecursively', 'checkEntryTrigger', 'checkKeywords', 'escapeRegex']) vm.runInContext(functionSource(name), sandbox);
    const result = await sandbox.processWorldBooksWithTrigger(['Ayato'], { readOnly: true });
    assert.match(result, /blue hair/);
    assert.match(result, /Forced entry/);
    assert.match(result, /Recursive entry/);
    assert.doesNotMatch(result, /UNSELECTED|DISABLED|UNTRIGGERED/);
    assert.equal(clears, 0);
    assert.equal(statefulExpansion, 0);
    await sandbox.processWorldBooksWithTrigger(['Ayato']);
    assert.equal(clears, 1);
    assert.equal(statefulExpansion, 1);
});

test('field parsing still removes outfits and preserves identity in Character traits; save creates a new preset', () => {
    const draft = parseAppearanceResult(JSON.stringify({ nameCN: '神里绫人', subjectTag: '1boy', characterTraits: 'blue_hair, white_coat',
        facialFeatures: 'blue_eyes, mole_under_eye', upperBodySFW: 'slender, gold_necklace', fullBodySFW: 'long_legs' }));
    assert.match(draft.characterTraits, /^1boy, blue_hair/);
    assert.match(draft.characterTraits, /blue_eyes/);
    assert.match(draft.characterTraits, /slender/);
    assert.doesNotMatch(JSON.stringify(draft), /white_coat|gold_necklace/);
    assert.equal(draft.nameCN, '神里绫人');
    const settings = { characterPresets: { '神里绫人': { untouched: true } }, apiKey: 'unchanged-test-value' };
    const id = saveAppearancePreset(settings, draft);
    assert.equal(id, '神里绫人 (2)');
    assert.deepEqual(settings.characterPresets['神里绫人'], { untouched: true });
    assert.equal(settings.apiKey, 'unchanged-test-value');
});
