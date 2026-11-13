/* Word-vocal completions (#44, word-vocals P3). One provider through the public registry (intellisense.js is unchanged).
   Reads data/intellisense/words.json = the item shape of engine/vocals/complete.py ({items:[{name, kind, detail, n}]}); names and counts only, no audio.
   A user bank's output can replace that file (complete.py --samples-dir D > words.json). Items are string items, so they show inside quotes, e.g. word("ca. */
const reg = () => window.strudelCraft && window.strudelCraft.intellisense;
const data = fetch('data/intellisense/words.json').then((r) => r.json()).then((d) => d.items || []).catch(() => []);
const api = reg();
if (api) api.register({ id: 'words', items: async () => (await data).map((i) => ({ label: i.name, string: true, category: i.kind === 'word' ? 'words' : i.kind + 's', detail: `${i.detail} x${i.n}`, info: `${i.kind}: ${i.n} take${i.n === 1 ? '' : 's'}; word("${i.name}:N") picks take N` })) });
