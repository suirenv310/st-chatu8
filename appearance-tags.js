/* Danbooru dictionary lookup + subject hints, v0.3.3, 2026-11-06. AFPL v9. */
export const BODY_TAG_FIELDS = ['characterTraits', 'facialFeatures', 'facialFeaturesBack', 'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack'];
export const SUBJECT_TAGS = ['', '1boy', '1girl', '1other'];
export const SCENE_SUBJECT_RULE = `[Scene subject / count / gender tags]
For EACH image, determine the actual visible subjects in THAT image. Use established Danbooru subject/count tags: 1boy, 1girl, 2boys, 2girls, etc. Use solo ONLY when exactly one subject is visible; omit solo for two or more subjects. For example one man = 1boy, solo; two women = 2girls (not 1girl, 1girl, solo); one man and one woman = 1boy, 1girl (no solo). Do not count people merely mentioned, off-screen speakers, or every person in the character card/lorebook. Do not add a gender not supported by the scene/character data. male_focus/female_focus are scene focus tags, not a substitute for the subject counts; use only when appropriate. Avoid generic male/female as standalone substitutes for Danbooru count tags.
Character preset subjectTag values and the leading 1boy/1girl/1other in Character traits describe ONE named individual, not an extra person. Aggregate them by the individuals actually visible; do not copy/sum a scene-wide count and individual counts twice. Character body presets must not force solo, plural counts or focus tags into every scene.
Use lowercase English Danbooru-style tags separated by commas. Preserve the existing output protocol, character names, $character markers$, JSON/tool-call keys and image insertion positions. Apply this to image prompt values only. Keep scene clothing/pose/action; the body-only rule applies to fixed appearance presets, not to the whole image.`;
export function injectSubjectRule(messages, requestType) {
  if (requestType !== 'image_gen' || !Array.isArray(messages)) return messages;
  if (messages.some(message => typeof message?.content === 'string' && message.content.includes('[Scene subject / count / gender tags]'))) return messages;
  return [...messages, { role: 'user', content: SCENE_SUBJECT_RULE }];
}
export function normalizeDanbooruTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/^\(+|\)+$/g, '').replace(/:\s*\d+(?:\.\d+)?$/, '').trim().replace(/\s+/g, '_');
}
export function isSubjectTag(tag) {
  return /^(?:\d+(?:boy|girl|other)s?|multiple_(?:boys|girls|others)|solo|solo_focus|male|female|male_focus|female_focus)$/i.test(normalizeDanbooruTag(tag));
}
export function getPresetSubject(raw) {
  if (SUBJECT_TAGS.includes(raw?.subjectTag)) return raw.subjectTag;
  const candidates = String(raw?.characterTraits || '').split(/[,，;；\n]+/).map(normalizeDanbooruTag);
  const found = [...new Set(candidates.map(tag => tag === 'male' ? '1boy' : tag === 'female' ? '1girl' : tag).filter(tag => ['1boy', '1girl', '1other'].includes(tag)))];
  return found.length === 1 ? found[0] : '';
}
export function subjectReferenceTraits(character) {
  const subject = getPresetSubject(character);
  const body = String(character?.characterTraits || '').split(',').map(tag => tag.trim()).filter(tag => tag && !isSubjectTag(tag));
  return [subject, ...body].filter(Boolean).join(', ');
}
export function isCoreIdentityTag(tag) {
  const plain = normalizeDanbooruTag(tag).replaceAll('_', ' ');
  return /\b(?:hair|bangs|fringe|ahoge|sidelocks?|sideburns?|ponytails?|twintails?|pigtails?|braids?|buns?|bald|hairless|eyes?|irises?|pupils?|heterochromia|skin|skinned|complexion|tan|tanned|pale|freckles|moles?)\b/i.test(plain)
    || /^(?:slim|slender|muscular|athletic|toned|chubby|plump|petite|curvy|stocky|average|lean|thin|fat|tall|short|hourglass)(?: (?:build|body|figure|physique|stature))?$/i.test(plain);
}
export function mergeCoreCharacterTraits(data, subject) {
  const merged = [], seen = new Set();
  const add = tag => {
    const key = normalizeDanbooruTag(tag);
    if (!key || isSubjectTag(key) || seen.has(key)) return;
    seen.add(key); merged.push(tag);
  };
  for (const tag of String(data.characterTraits || '').split(',').map(tag => tag.trim()).filter(Boolean)) add(tag);
  for (const field of BODY_TAG_FIELDS.filter(key => key !== 'characterTraits')) {
    const remaining = [];
    for (const tag of String(data[field] || '').split(',').map(tag => tag.trim()).filter(Boolean)) {
      if (isCoreIdentityTag(tag)) add(tag); else remaining.push(tag);
    }
    data[field] = remaining.join(', ');
  }
  data.characterTraits = [subject, ...merged].filter(Boolean).join(', ');
  return data;
}
const SPELLING_ALIASES = { blond_hair: 'blonde_hair', gray_hair: 'grey_hair', grey_hair: 'gray_hair', gray_eyes: 'grey_eyes', grey_eyes: 'gray_eyes' };
function candidatesFor(tag) {
  const normalized = normalizeDanbooruTag(tag);
  return [normalized, SPELLING_ALIASES[normalized]].filter(Boolean);
}
// Reads the existing vocabulary DB without changing its schema or loading a
// second copy of the whole dictionary into RAM. One bounded batch per operation.
export async function lookupInstalledDanbooru({ openDatabase, getVocabularies }, tags) {
  const installed = await getVocabularies();
  const files = new Set((installed || []).filter(item => /^danbooru_\d+\.json$/i.test(item.fileName || '')).map(item => item.fileName));
  if (!files.size) return { matches: {}, installedFiles: 0, warning: 'No installed Danbooru files found. Install them in Vocabulary; tags below remain unverified.' };
  const wanted = new Set(tags.flatMap(candidatesFor));
  if (wanted.size > 2000) throw new Error('Too many appearance tags. Use at most 2,000 distinct tags per preset.');
  const rows = new Map();
  if (wanted.size) {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('tags', 'readonly');
      const request = transaction.objectStore('tags').openCursor();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Vocabulary database read failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Vocabulary database read aborted.'));
      request.onerror = () => reject(request.error || new Error('Vocabulary cursor failed.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value;
        const canonical = normalizeDanbooruTag(row.name);
        if (files.has(row.fileName) && wanted.has(canonical)) rows.set(canonical, canonical);
        // Native imports currently keep names/translations, not a general alias
        // index. Only use an alias when an imported row actually provides it.
        if (files.has(row.fileName) && row.aliases) {
          const aliases = Array.isArray(row.aliases) ? row.aliases : String(row.aliases).split(',');
          for (const alias of aliases) {
            const key = normalizeDanbooruTag(alias);
            if (wanted.has(key) && !rows.has(key)) rows.set(key, canonical);
          }
        }
        cursor.continue();
      };
    });
  }
  const matches = {};
  for (const tag of tags) {
    for (const candidate of candidatesFor(tag)) {
      if (rows.has(candidate)) { matches[normalizeDanbooruTag(tag)] = rows.get(candidate); break; }
    }
  }
  return { matches, installedFiles: files.size, warning: '' };
}
export async function validateAppearanceDictionary(draft, lookup) {
  const data = structuredClone(draft);
  const tags = [...new Set([...BODY_TAG_FIELDS.flatMap(key => String(data[key] || '').split(',').map(normalizeDanbooruTag).filter(Boolean)), ...(data.subjectTag ? [data.subjectTag] : [])])];
  const result = lookup ? await lookup(tags) : { matches: {}, installedFiles: 0, warning: 'Dictionary lookup unavailable. Tags remain unverified.' };
  const matches = result.matches || {};
  const convert = tag => matches[normalizeDanbooruTag(tag)] || normalizeDanbooruTag(tag);
  for (const key of BODY_TAG_FIELDS) data[key] = [...new Set(String(data[key] || '').split(',').map(tag => tag.trim()).filter(Boolean).map(convert))].join(', ');
  data.inferredTraits = [...new Set((data.inferredTraits || []).map(convert))];
  data.unverifiedTags = tags.filter(tag => !Object.hasOwn(matches, tag));
  data.dictionaryStatus = result.warning || `Checked against ${result.installedFiles || 0} installed Danbooru files.`;
  return data;
}
