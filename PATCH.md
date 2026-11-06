# PixAI / English patch v0.5.0

Based on st-chatu8 3.1.8 (`340a337b44b6089662408df3a33287fe50d45d75`).
Original author: 从前跟你一样 / damoshen123. Modified 2026-11-06.
Distributed free of charge under the included Aladdin Free Public License v9.

This fork includes the English settings UI, PixAI presets, body appearance
extraction, Danbooru subject/Character traits improvements, SDXL Face Fix and
experimental Tsubaki.2 recipes. Original protocols, settings keys and author
credits are retained. Saved user content and prompts are not translated.

## Installation and updates

1. Install or update the extension from `https://github.com/suirenv310/st-chatu8`.
   For an existing patched installation, back up its folder and settings, then
   replace its extension files with this fork's files. Avoid duplicate copies.
2. Copy the **contents** of `plugins/chatu8-pixai/` from this repository into
   `<SillyTavern>/plugins/chatu8-pixai/`. This is a separate server plugin;
   installing/updating the extension alone does not update the server copy.
3. Enable server plugins with `enableServerPlugins: true` in SillyTavern's
   `config.yaml` if needed. Restart SillyTavern, then hard-refresh the browser.
4. Open Banana / Grok / PixAI, enable PixAI and enter your official PixAI API key.
   Keep existing settings and presets; no reset is required.

When updating this fork, repeat step 2 if the bridge files changed. The bridge's
health endpoint `/api/plugins/chatu8-pixai/health` should report version `0.5.0`
and features `faceFix: true`, `recipes: true`.

## Recipes (experimental)

Select family **Tsubaki**, model version ID `1983308862240288769` and size **1k**.
Enter numeric recipe IDs or PixAI recipe links, separated by commas or newlines.
Their order is preserved; settings are stored per preset and survive export/import.
Leave the field blank to disable recipes. Set API style to **None**, use no LoRAs
or Face Fix, and avoid aspect ratios 1:3 and 3:1. Default mode maps to `lite`;
explicit modes are sent as `inferenceProfile`.

The REST recipe route is undocumented. The prior user-run request produced an
image, but did not establish that every hidden recipe was applied. This patch
does not download hidden recipe prompts or claim verified recipe application.
Submissions are not automatically retried or replaced with paid fallback calls.

Face Fix remains available separately for supported SDXL models.

## Character traits

Character traits holds stable identity tags: `1boy`/`1girl`/`1other`, hair, eyes,
skin and build. The subject dropdown and traits stay synchronized when generating,
rechecking or saving. Scene counts and `solo` remain scene-level information.
Existing saved character presets are not silently rewritten: regenerate or edit
their traits if needed. Main → Image display size controls chat display width;
it does not change generation resolution.

## Validation

Run `node --test tests/*.test.mjs` from the repository root.
Tests use mocks and do not spend PixAI credits. Local tests do not establish live
provider behavior or full SillyTavern browser integration.

The original README below remains available for upstream features and history.
