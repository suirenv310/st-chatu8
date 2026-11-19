import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { optionLabel } from '../ui-labels.js';

test('built-in option labels are English while custom names and API identifiers are preserved', () => {
    assert.equal(optionLabel('默认'), 'Default');
    assert.equal(optionLabel('作者预set 2'), 'Author preset 2');
    assert.equal(optionLabel('默认-视频工作流'), 'Default - Video workflow');
    assert.equal(optionLabel('Cherry / 芊悦'), 'Cherry');
    assert.equal(optionLabel('zh-CN-XiaoxiaoNeural'), 'zh-CN-XiaoxiaoNeural');
    assert.equal(optionLabel('我的自定义角色'), '我的自定义角色');
    assert.equal(optionLabel('Lumine portrait'), 'Lumine portrait');
    assert.equal(optionLabel('__proto__'), '__proto__');
    assert.equal(optionLabel(null), null);
});

test('the NovelAI preset selector retains request values and the saved selection after label translation', async () => {
    const bundle = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = bundle.indexOf('function updateNovelaiUcpOptions()');
    const end = bundle.indexOf('\nfunction ', start + 1);
    const select = { value: '', selectedIndex: 0, options: [], add(option) { this.options.push(option); } };
    const settings = { UCP_novelai: 'Heavy' };
    const context = {
        optionLabel,
        extensionName: 'test',
        extension_settings75: { test: settings },
        document: { getElementById(id) { return id === 'novelaimode' ? { value: 'nai-diffusion-4-5-full' } : select; } },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } }
    };
    vm.createContext(context);
    vm.runInContext(bundle.slice(start, end), context);
    context.updateNovelaiUcpOptions();
    assert.equal(select.value, 'Heavy');
    assert.equal(settings.UCP_novelai, 'Heavy');
    assert.equal(select.options[0].text, 'None');
    assert.equal(select.options[0].value, '');
    assert.equal(select.options.find(option => option.text === 'Author preset').value.startsWith('bad proportions,'), true);
    assert.equal(select.options.find(option => option.text === 'Author preset 2').value.startsWith('negativeXL_D,'), true);
    assert(select.options.every(option => !/\p{Script=Han}/u.test(option.text)));
});

test('translated configuration errors remain non-retryable and provider-localized errors are recognized', async () => {
    const bundle = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = bundle.indexOf('function isNonRetryableError(');
    const end = bundle.indexOf('\nfunction ', start + 1);
    const context = {};
    vm.createContext(context);
    vm.runInContext(bundle.slice(start, end), context);
    for (const message of [
        'Configure valid GCP service account JSON credentials for Vertex.',
        'Configure the API URL, API key and model.',
        'No fixed prompt preset configured',
        'API URL 未配置',
        'Invalid API key (401)'
    ]) {
        assert.equal(context.isNonRetryableError(new Error(message)), true, message);
    }
    assert.equal(context.isNonRetryableError(new Error('Temporary gateway error (502)')), false);
});

test('all built-in speech voices and speaking styles have English labels with unchanged provider IDs', async () => {
    const bundle = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const voices = vm.runInNewContext(bundle.match(/EDGE_VOICES = (\[[\s\S]*?\n    \]);/)[1]);
    const styles = vm.runInNewContext('(' + bundle.match(/EDGE_STYLE_MAP = (\{[\s\S]*?\n    \});/)[1] + ')');
    const qwen = vm.runInNewContext(bundle.match(/AVAILABLE_VOICES = (\[[\s\S]*?\n    \]);/)[1]);
    const appended = [];
    const context = {
        optionLabel,
        getEdgeVoices: () => voices,
        getEdgeVoiceStyles: id => voices.find(voice => voice.id === id).styles.map(id => ({id, name: styles[id]})),
        getQwenVoices: () => qwen,
        dom: {
            ttsEdgeVoiceSelect: {empty() {}, append(html) { appended.push(html); }, val() {}},
            ttsEdgeStyleSelect: {empty() {}, append(html) { appended.push(html); }, val() {}},
            ttsQwenVoiceSelect: {empty() {}, append(html) { appended.push(html); }, val() {}}
        }
    };
    vm.createContext(context);
    for (const name of ['populateEdgeVoices', 'populateEdgeStyles', 'populateQwenVoices']) {
        const start = bundle.indexOf('function ' + name + '(');
        const end = bundle.indexOf('\nfunction ', start + 1);
        vm.runInContext(bundle.slice(start, end), context);
    }
    context.populateEdgeVoices(voices[0].id);
    for (const voice of voices) context.populateEdgeStyles(voice.id, 'general');
    context.populateQwenVoices(qwen[0]);
    for (const html of appended) {
        const [, value, text] = html.match(/<option value="([^"]*)">([\s\S]*?)<\/option>/);
        assert(!/\p{Script=Han}/u.test(text), text);
        assert(voices.some(voice => voice.id === value) || Object.hasOwn(styles, value) || qwen.includes(value), value);
    }
});
