# PixAI / English patch v0.6.1

Based on st-chatu8 3.2.1 (`a4c417f98e9697be44935486a0504713532994b3`).
Original author: 从前跟你一样 / damoshen123. Modified 2026-11-19.
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

## Changes in patch v0.6.0

Merged upstream 3.2.1, including RunningHub paid-point balance support,
NovelAI Anlas/V5 balance queries and collapsible LLM parameter/history sections.
The extension manifest reports 3.2.1. The PixAI server bridge reports 0.5.0.

Expanded the existing English translation of dynamic menus, confirmation
dialogs, Vibe/reference status messages, summary controls, theme colors and the
new balance panels. Protocol placeholders and stored identifiers retain their
original spelling. Historical upstream release notes remain in their original
language.

Version checks and reinstall guidance now use this fork's main branch.
Validation includes the 25 PixAI/recipe tests, a merge structure comparison,
mocked RunningHub paid-point balance checks and browser checks of the NovelAI
balance panel at mobile and desktop widths. Provider billing and a deployed
SillyTavern session were not exercised.

## Changes in patch v0.6.1

Translated locally generated errors and validation details across image/video
providers, storage, LLM requests, speech and workflow editing. Translated option
labels and tooltips for built-in presets, themes, voices and speaking styles.
Option values and custom preset/model names retain their original identifiers.
Empty-state captions in Vibe/reference groups and task status labels are English.

Cancellation, timeout and non-retryable configuration-error detection recognize
the translated messages. Validation includes all 29 tests, an audit of 530 local
error fragments, stored-value comparisons and browser selector checks at 430px
and 1200px. Provider-returned messages and existing user-authored content can
still use their original language.

## PixAI Quick Copy

1. Install [PixAI Quick Copy v4.1](https://raw.githubusercontent.com/suirenv310/st-chatu8/main/tools/pixai-quick-copy.user.js) in Tampermonkey. Replace or disable any older copy of the userscript.
2. In the PixAI image editor, click **Copy PixAI Preset** and confirm the preview.
3. In st-chatu8, open **Banana / Grok / PixAI → Paste PixAI Quick Copy preset**. Paste the JSON and click **Import pasted preset**.

The import creates a preset and selects it. The copied prompt becomes the fixed
positive prefix. Model version ID, LoRAs, negative prompt, aspect ratio, seed,
sampler, steps and CFG are imported when present and supported. Set the model
family and resolution in st-chatu8. Sampler, steps and CFG are sent to PixAI
when you select **SD / SDXL**.

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


## Changes in patch v0.7.0 — private image metadata

Moves `jiuguanStorage` into per-user server storage with verified migration,
permanent legacy backups, ten rolling revision snapshots and offline rollback.
Install the separate `plugins/chatu8-storage` server plugin before updating.
All image references and existing provider configurations are retained.

R2 is an optional additional mirror, OFF by default. Configuration alone does
not enable uploads. New images and an explicitly requested existing-library
copy are separate actions. Local files and paths remain authoritative.

See [Vietnamese deployment, migration and rollback guide](STORAGE-MIGRATION.vi.md).
No runtime credentials are included. Server data and keys belong outside this
checkout. Validation uses local/mocked tests; VPS and real R2 remain unverified.


## Changes in patch v0.7.1 — Send Data prompt reuse for Character Preset

Character Manager → Appearance → Character Preset → Generate appearance tags
can now reuse the active **Image generation** (`image_gen`) context preset's
prose-to-Danbooru conversion rules, together with the worldbook entries selected
in Send Data. The new “Reuse active image-keyword LLM context prompt” checkbox
defaults to enabled; turn it off to use the independent body extraction prompt.
Edit the shared conversion instructions in LLM settings → Image generation →
Context preset. Enabled/keyword-triggered prompt entries are resolved for the
current target on every preview/generation.

The shared prompt is a conversion reference. The extraction JSON schema remains
authoritative: hair/eye/skin/build identity stays in Character traits, additional
body details go to their corresponding fields, and clothing/accessories are
filtered. Other characters and example traits must not be copied to the target.
The existing character-design API profile/connection handles this extraction;
copying the image-keyword prompt does not switch providers or generate images.

Use **Preview sources + full prompt** before generating to inspect the exact
sources, inherited conversion reference and final JSON task. Preview sends no
LLM request. Generation produces an editable draft, checked against the installed
Danbooru dictionary; only **Save new character preset** persists a new preset,
with a collision-safe name. Existing presets and saved context profiles remain
unchanged. Missing active image-keyword context produces a clear error when
reuse is enabled, rather than silently using unrelated instructions.

The shared Send Data selector retains book/entry selection, force/disable,
keyword and recursion behavior. Extraction reads it without clearing live world
variables, and variable macros are simulated on private copies. Preview and
extraction do not persist chat/global variable assignments from source entries
or inherited prompt examples. Normal image generation keeps its existing path.
No chat history is read for this body preset operation.

This is an extension-side update; update the extension checkout to the branch
containing this patch and reload the browser completely. Existing metadata/R2
server plugin files do not need an update for this change.

Validation adds nine tests for prompt reuse/switching, placeholders, source
priorities/output boundaries, read-only macros, actual bundled prompt/worldbook
selectors, conflict checks and safe preset saves. Live LLM output quality and
the user's deployed SillyTavern session remain unverified.
