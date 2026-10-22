// Usage: node tools/dump-item.ts "<part of an item's name>" ["<...>/dota 2 beta/game"] [outFile]
//   e.g. node tools/dump-item.ts "Bloodfeather Frock"
// Writes item-dump.txt: the items_game block of every wearable whose name has that text, then the hero's stock
// items (default_item) with their blocks, and whether the model files are in pak01. It is what to look at when
// a wearable is put on wrong (a stock part still showing, a model in the wrong place...).
import fs from 'node:fs';
import path from 'node:path';
import { sharedVpkIndex } from '../src/vpk.ts';
import { findDotaGamePath } from '../src/steam.ts';
import { readGameSchema, listItems, toUtf8, itemFields } from '../src/schema.ts';
import { heroesOfItem } from '../src/item-builder.ts';

const query = (process.argv[2] || '').toLowerCase();
if (!query) { console.error('Usage: node tools/dump-item.ts "<part of the item name>" ["<...>/dota 2 beta/game"] [outFile]'); process.exit(1); }
const game = process.argv[3] || await findDotaGamePath();
if (!game) { console.error('Dota 2 not found: give the path to ".../dota 2 beta/game" as the second argument'); process.exit(1); }
const outFile = path.resolve(process.argv[4] || 'item-dump.txt');
const pak = path.join(game, 'dota', 'pak01_dir.vpk');
if (!fs.existsSync(pak)) { console.error('not found: ' + pak); process.exit(1); }

const { text, stamp } = readGameSchema(game);
const ix = sharedVpkIndex(pak);
const items = listItems(text);
const lines: string[] = [`game: ${game}`, `stamp: ${stamp}`, ''];
const block = (i: { start: number; end: number }) => text.slice(i.start, i.end).replace(/\r\n/g, '\n').trimEnd();
const modelsIn = (b: string) => [...new Set([...b.matchAll(/"([^"]+\.vmdl)"/gi)].map((m) => m[1].toLowerCase()))];
const modelState = (b: string) => modelsIn(b).map((m) => `  ${ix.has(`${m}_c`) ? 'in pak01' : 'MISSING '}  ${m}`);

const hits = items.filter((i) => toUtf8(i.name).toLowerCase().includes(query));
lines.push(`== ${hits.length} item(s) named like "${process.argv[2]}" ==`, '');
const heroes = new Set<string>();
for (const i of hits.slice(0, 8)) {
  const b = block(i);
  for (const h of heroesOfItem(text, i)) heroes.add(h);
  lines.push(`--- #${i.id} prefab=${i.prefab} slot=${itemFields(text, i).get('item_slot') ?? '(none)'} heroes=${heroesOfItem(text, i).join(',')} ---`, b, 'models:', ...modelState(b), '');
}
for (const h of heroes) {
  const stock = items.filter((i) => i.prefab === 'default_item' && heroesOfItem(text, i).includes(h));
  lines.push(`== stock items of ${h}: ${stock.length} ==`, '');
  for (const i of stock.slice(0, 20)) {
    const b = block(i);
    lines.push(`--- stock #${i.id} slot=${itemFields(text, i).get('item_slot') ?? '(none)'} ---`, b, 'models:', ...modelState(b), '');
  }
}
fs.writeFileSync(outFile, lines.join('\n'));
console.log(lines.slice(0, 3).join('\n'));
console.log(`${hits.length} item(s), ${heroes.size} hero(es) -> ${outFile}`);
