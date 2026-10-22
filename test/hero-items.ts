// Hero items on a synthetic Dota tree: a hero with a stock item, a paid wearable with a model and a
// particle, a pick -> items_game block + files under the stock paths -> reset -> byte-exact restore.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createCosmetics } from '../src/cosmetics.ts';
import { buildVpk, entryAt, readVpkEntryFile } from '../src/vpk.ts';
import { signatureLine, fileHashes } from '../src/patcher-signatures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-hero-'));
const game = path.join(root, 'game');
fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
const binDir = path.join(game, 'bin', process.platform === 'linux' ? 'linuxsteamrt64' : 'win64');
fs.mkdirSync(binDir, { recursive: true });

const NL = '\r\n';
const item = (id: string, fields: string) => `\t\t"${id}"${NL}\t\t{${NL}${fields}\t\t}${NL}`;
const f = (k: string, v: string) => `\t\t\t"${k}"\t\t"${v}"${NL}`;
const heroes = (...h: string[]) => `\t\t\t"used_by_heroes"${NL}\t\t\t{${NL}${h.map((x) => `\t\t\t\t"${x}"\t\t"1"${NL}`).join('')}\t\t\t}${NL}`;

const items = `"items_game"${NL}{${NL}\t"items"${NL}\t{${NL}`
  // the stock head of Axe, with a model of its own
  + item('9001', f('name', 'Default Axe Head') + f('prefab', 'default_item') + f('item_slot', 'head') + f('model_player', 'models/heroes/axe/axe_head.vmdl') + heroes('npc_dota_hero_axe'))
  // a paid head for Axe: its own model, a particle, an unlock block that a free item cannot use
  + item('9002', f('name', 'Crown of Tests') + f('prefab', 'wearable') + f('item_slot', 'head') + f('model_player', 'models/items/axe/crown/crown.vmdl') + heroes('npc_dota_hero_axe')
    + `\t\t\t"visuals"${NL}\t\t\t{${NL}`
    + `\t\t\t\t"asset_modifier"${NL}\t\t\t\t{${NL}\t\t\t\t\t"type"\t\t"particle"${NL}\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_axe/axe_head.vpcf"${NL}\t\t\t\t\t"modifier"\t\t"particles/econ/items/axe/crown/crown_glow.vpcf"${NL}\t\t\t\t}${NL}`
    + `\t\t\t\t"unlock"${NL}\t\t\t\t{${NL}\t\t\t\t\t"x"\t\t"1"${NL}\t\t\t\t}${NL}`
    + `\t\t\t}${NL}`)
  + Array.from({ length: 1200 }, (_, i) => item(String(20000 + i), f('name', `filler ${i}`))).join('')
  + `\t}${NL}}${NL}`;

const pak = path.join(game, 'dota', 'pak01_dir.vpk');
fs.writeFileSync(pak, buildVpk([
  entryAt('scripts/items/items_game.txt', Buffer.from(items, 'latin1')),
  entryAt('models/heroes/axe/axe_head.vmdl_c', Buffer.from('STOCK-MODEL')),
  entryAt('models/items/axe/crown/crown.vmdl_c', Buffer.from('PAID-MODEL')),
  entryAt('particles/econ/items/axe/crown/crown_glow.vpcf_c', Buffer.from('PAID-PARTICLE')),
  entryAt('particles/units/heroes/hero_axe/axe_head.vpcf_c', Buffer.from('STOCK-PARTICLE')),
]));

const gi = `"GameInfo"${NL}{${NL}\tFileSystem${NL}\t{${NL}\t\tSearchPaths${NL}\t\t{${NL}\t\t\tGame\tdota${NL}\t\t\tMod\tdota${NL}\t\t\tGame\tcore${NL}\t\t}${NL}\t}${NL}}${NL}`;
const branch = `"GameInfo"${NL}{${NL}\tFileSystem${NL}\t{${NL}\t\tSteamAppId\t570${NL}\t}${NL}}${NL}`;
fs.writeFileSync(path.join(game, 'dota', 'gameinfo.gi'), gi);
fs.writeFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), branch);
const { sha1, crc } = fileHashes(Buffer.from(branch, 'latin1'));
const sigPath = path.join(binDir, 'dota.signatures');
fs.writeFileSync(sigPath, `dota2.exe~SHA1:AAAA;CRC:BBBB${NL}...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}${NL}DIGEST:1234${NL}`);
void signatureLine;

const c = createCosmetics({ gamePath: game, dataDir: path.join(root, 'data') });

// the grid: Axe, one slot, no sets
const grid = c.heroes();
console.log('heroes:', JSON.stringify(grid));
assert.equal(grid.length, 1);
assert.deepEqual([grid[0].id, grid[0].slots, grid[0].picked], ['axe', 1, 0]);

const { slots } = c.heroSlots('axe');
console.log('axe slots:', JSON.stringify(slots.map((s) => ({ slot: s.slot, base: s.base, options: s.options.map((o) => o.name) }))));
assert.equal(slots.length, 1);
assert.equal(slots[0].base, '9001');
assert.deepEqual(slots[0].options.map((o) => o.id), ['9002']);
assert.ok(c.effects().length > 1 && c.effects()[0].id === '');

// safe mode on: refused
assert.throws(() => c.pickItem(slots[0].slot, '9002'), /Безопасный режим/);

c.setEnabled(true);
const r = c.pickItem(slots[0].slot, '9002', ['fire']);
console.log('pick ->', r);
assert.ok(r.deployed && r.applied === 1 && r.failed.length === 0, JSON.stringify(r));
assert.equal(c.heroes()[0].picked, 1);

// the built pak: Axe's stock item now carries the crown's visuals, under the stock id and name
const built = path.join(game, 'dota_russian', 'pak99_dir.vpk');
const table = readVpkEntryFile(built, 'scripts/items/items_game.txt')!.data.toString('latin1');
const block = table.slice(table.indexOf('\t\t"9001"'), table.indexOf('\t\t"9002"'));
assert.ok(block.length > 50 && !block.includes('"9002"'), 'sliced exactly the stock item block');
assert.match(block, /"name"\s+"Default Axe Head"/, 'keeps the stock name');
assert.match(block, /"prefab"\s+"default_item"/, 'stays a default_item');
assert.match(block, /crown_glow\.vpcf/, 'carries the paid particle');
assert.match(block, /courier_trail_lava/, 'carries the chosen effect');
assert.doesNotMatch(block, /"unlock"/, 'drops the unlock block');
// the files: the paid model under the stock path, the paid particle under the stock particle's path
assert.equal(readVpkEntryFile(built, 'models/heroes/axe/axe_head.vmdl_c')?.data.toString(), 'PAID-MODEL');
assert.equal(readVpkEntryFile(built, 'particles/units/heroes/hero_axe/axe_head.vpcf_c')?.data.toString(), 'PAID-PARTICLE');
assert.equal(c.state().items[slots[0].slot].effects, 'fire');

// clearing the slot removes the pak; the game's own files are untouched throughout
const r2 = c.pickItem(slots[0].slot, null);
assert.ok(!r2.deployed);
assert.ok(!fs.existsSync(built));
c.pickItem(slots[0].slot, '9002');
assert.ok(fs.existsSync(built));
c.resetHero('axe');
assert.ok(!fs.existsSync(built), 'reset hero drops the pak');

assert.throws(() => c.pickItem('item:axe:nope', '9002'), /не найден/);
assert.throws(() => c.pickItem(slots[0].slot, '20001'), /не подходит/);

c.setEnabled(false);
assert.equal(fs.readFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), 'latin1'), branch, 'branch restored byte for byte');
console.log('HERO ITEMS OK');
