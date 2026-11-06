import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPreset, parseRecipeIds, buildPixaiPayload, exportPresets, parsePresetImport } from '../pixai-presets.js';
import { prepareRecipeRequest, submitGeneration } from '../plugins/chatu8-pixai/core.mjs';

const preset = { ...blankPreset('Recipes'), family: 'tsubaki', modelVersionId: '1983308862240288769', recipeIds: '2067029411454978868\n2047210364701843526' };

test('recipe links preserve order and reject duplicates, invalid input and excess IDs', () => {
    assert.deepEqual(parseRecipeIds('https://pixai.art/recipes/2067029411454978868, 2047210364701843526'), ['2067029411454978868', '2047210364701843526']);
    for (const value of ['123,123', 'https://example.invalid/recipes/123', Array.from({length:11}, (_, i) => String(i + 1)).join(',')]) assert.throws(() => parseRecipeIds(value));
});

test('recipe request preserves preset order, mode and seed through export/import', () => {
    const state = { activePresetId:'a', presets:{a:{...preset, mode:'pro', seed:42}} };
    const imported = parsePresetImport(JSON.stringify(exportPresets(state)))[0];
    const body = prepareRecipeRequest(buildPixaiPayload(imported, '1girl, garden'));
    assert.deepEqual(body.parameters.recipeIds, ['2067029411454978868', '2047210364701843526']);
    assert.equal(body.parameters.inferenceProfile, 'pro');
    assert.equal(body.parameters.seed, 42);
    assert.equal(body.parameters.batchSize, 1);
    assert.deepEqual(body.parameters.promptHelper, {enable:false});
    assert.equal(prepareRecipeRequest(buildPixaiPayload(preset, 'garden')).parameters.inferenceProfile, 'lite');
});

test('unsupported recipe combinations fail before submission', () => {
    for (const change of [{family:'sd'}, {modelVersionId:'123'}, {size:'1.5k'}, {aspectRatio:'1:3'}, {stylePreset:'chibi'}, {loras:[{modelId:'123',weight:1}]}]) {
        assert.throws(() => buildPixaiPayload({...preset, ...change}, 'garden'));
    }
    const payload = buildPixaiPayload(preset, 'garden');
    for (const change of [{enableADetailer:true}, {sampling:{steps:20}}, {recipeIds:['123','123']}]) assert.throws(() => prepareRecipeRequest({...payload, ...change}));
});

test('recipes submit once to v1 and leave application unverified; errors do not trigger fallback', async () => {
    const calls = [];
    const fetchFn = async (url, options) => {
        calls.push({url, body:JSON.parse(options.body)});
        return new Response(JSON.stringify({id:'recipe-task', status:'waiting'}), {status:200});
    };
    const result = await submitGeneration(buildPixaiPayload(preset, 'garden'), 'test-only', {fetchFn});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.pixai.art/v1/task');
    assert.equal(result.recipeApplicationVerified, false);
    let attempts = 0;
    await assert.rejects(submitGeneration(buildPixaiPayload(preset, 'garden'), 'test-only', {fetchFn:async () => { attempts++; throw new Error('lost response'); }}));
    assert.equal(attempts, 1);
});
