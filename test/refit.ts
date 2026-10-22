// An arcana lists model swaps for the paid wearables that do not fit its body (Queen of Pain's lists forty). A wearable
// the builder puts under a stock path is no longer named by its own path, so the pick takes the refit itself:
// without it the dress stays the plain-body one and sinks into the arcana's body.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createCosmetics } from '../src/cosmetics.ts';
import { buildVpk, entryAt, readVpkEntryFile } from '../src/vpk.ts';
import { fileHashes } from '../src/patcher-signatures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-refit-'));
const game = path.join(root, 'game');
fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
const binDir = path.join(game, 'bin', process.platform === 'linux' ? 'linuxsteamrt64' : 'win64');
fs.mkdirSync(binDir, { recursive: true });

const NL = '\r\n';
const item = (id: string, fields: string) => `\t\t"${id}"${NL}\t\t{${NL}${fields}\t\t}${NL}`;
const f = (k: string, v: string) => `\t\t\t"${k}"\t\t"${v}"${NL}`;
const heroes = (...h: string[]) => `\t\t\t"used_by_heroes"${NL}\t\t\t{${NL}${h.map((x) => `\t\t\t\t"${x}"\t\t"1"${NL}`).join('')}\t\t\t}${NL}`;
const modelSwap = (asset: string, modifier: string, style?: string) => `\t\t\t\t"asset_modifier"${NL}\t\t\t\t{${NL}\t\t\t\t\t"type"\t\t"model"${NL}\t\t\t\t\t"asset"\t\t"${asset}"${NL}\t\t\t\t\t"modifier"\t\t"${modifier}"${NL}${style ? `\t\t\t\t\t"style"\t\t"${style}"${NL}` : ''}\t\t\t\t}${NL}`;
const visuals = (...mods: string[]) => `\t\t\t"visuals"${NL}\t\t\t{${NL}${mods.join('')}\t\t\t}${NL}`;
const QOP = heroes('npc_dota_hero_queenofpain');
const M = (n: string) => `models/items/queenofpain/${n}.vmdl`;

const items = `"items_game"${NL}{${NL}\t"items"${NL}\t{${NL}`
  + item('9201', f('name', "Queen of Pain's Base") + f('prefab', 'default_item') + f('item_slot', 'hero_base') + f('model_player', 'models/heroes/queenofpain/queenofpain.vmdl') + QOP)
  + item('83', f('name', "Queen of Pain's Armor") + f('prefab', 'default_item') + f('item_slot', 'shoulder') + f('model_player', 'models/heroes/queenofpain/shoulders.vmdl') + QOP)
  // the arcana: its body, and the refits of two dresses (one refit is not in the game's files, one is for its second style only)
  + item('9301', f('name', 'Arcana') + f('prefab', 'wearable') + f('item_slot', 'hero_base') + f('model_player', M('arcana_body')) + QOP
    + visuals(modelSwap(M('frock'), M('frock_arcana')), modelSwap(M('frock2'), M('frock2_missing')), modelSwap(M('frock3'), M('frock3_second'), '1')))
  + item('9302', f('name', 'Frock') + f('prefab', 'wearable') + f('item_slot', 'shoulder') + f('model_player', M('frock')) + QOP)
  + item('9303', f('name', 'Frock Two') + f('prefab', 'wearable') + f('item_slot', 'shoulder') + f('model_player', M('frock2')) + QOP)
  + item('9304', f('name', 'Frock Three') + f('prefab', 'wearable') + f('item_slot', 'shoulder') + f('model_player', M('frock3')) + QOP)
  + Array.from({ length: 1200 }, (_, i) => item(String(20000 + i), f('name', `filler ${i}`))).join('')
  + `\t}${NL}}${NL}`;

const model = (p: string, data: string) => entryAt(`${p}_c`, Buffer.from(data));
fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
  entryAt('scripts/items/items_game.txt', Buffer.from(items, 'latin1')),
  entryAt('scripts/npc/heroes/npc_dota_hero_queenofpain.txt', Buffer.from('"DOTAHeroes"\n{\n\t"npc_dota_hero_queenofpain"\n\t{\n\t\t"Model"\t\t"models/heroes/queenofpain/queenofpain.vmdl"\n\t}\n}\n')),
  model('models/heroes/queenofpain/queenofpain.vmdl', 'PLAIN-BODY'),
  model('models/heroes/queenofpain/shoulders.vmdl', 'STOCK-SHOULDERS'),
  model(M('arcana_body'), 'ARCANA-BODY'),
  model(M('frock'), 'FROCK'), model(M('frock_arcana'), 'FROCK-REFIT'),
  model(M('frock2'), 'FROCK-TWO'),
  model(M('frock3'), 'FROCK-THREE'), model(M('frock3_second'), 'FROCK-THREE-STYLE-2'),
]));
const gi = `"GameInfo"${NL}{${NL}\tFileSystem${NL}\t{${NL}\t\tSearchPaths${NL}\t\t{${NL}\t\t\tGame\tdota${NL}\t\t\tMod\tdota${NL}\t\t\tGame\tcore${NL}\t\t}${NL}\t}${NL}}${NL}`;
const branch = `"GameInfo"${NL}{${NL}\tFileSystem${NL}\t{${NL}\t\tSteamAppId\t570${NL}\t}${NL}}${NL}`;
fs.writeFileSync(path.join(game, 'dota', 'gameinfo.gi'), gi);
fs.writeFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), branch);
const { sha1, crc } = fileHashes(Buffer.from(branch, 'latin1'));
fs.writeFileSync(path.join(binDir, 'dota.signatures'), `dota2.exe~SHA1:AAAA;CRC:BBBB${NL}...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}${NL}DIGEST:1234${NL}`);

const c = createCosmetics({ gamePath: game, dataDir: path.join(root, 'data') });
const builtPak = () => {
  const mod = fs.readdirSync(game).find((d) => d.startsWith('dota_') && fs.existsSync(path.join(game, d, 'pak99_dir.vpk')));
  return mod ? path.join(game, mod, 'pak99_dir.vpk') : null;
};
const shoulders = () => readVpkEntryFile(builtPak()!, 'models/heroes/queenofpain/shoulders.vmdl_c')?.data.toString();

const slots = c.heroSlots('queenofpain').slots;
const shoulder = slots.find((x) => x.equipSlot === 'shoulder')!;
const base = slots.find((x) => x.equipSlot === 'hero_base')!;
assert.ok(shoulder && base, 'both slots are offered');

// the dress alone: its own model under the stock path
c.pickItem(shoulder.slot, '9302', []);
assert.deepEqual(c.apply().failed, []);
assert.equal(shoulders(), 'FROCK');

// with the arcana worn: the arcana's refit of it goes under the stock path
c.pickItem(base.slot, '9301', []);
c.apply();
assert.equal(shoulders(), 'FROCK-REFIT', 'the refit the arcana lists for this dress');
const report = fs.readFileSync(path.join(root, 'data', 'refit-report.txt'), 'utf8');
assert.match(report, /lists 3 model swaps|lists 2 model swaps/);
assert.match(report, new RegExp(`${shoulder.slot}: refit .*frock\\.vmdl -> .*frock_arcana\\.vmdl`));

// the arcana taken off: the dress is its own again
c.pickItem(base.slot, null);
c.apply();
assert.equal(shoulders(), 'FROCK');

// a refit that is not in the game's files: the plain dress stays, and the report says so
c.pickItem(base.slot, '9301', []);
c.pickItem(shoulder.slot, '9303', []);
assert.deepEqual(c.apply().failed, []);
assert.equal(shoulders(), 'FROCK-TWO');
assert.match(fs.readFileSync(path.join(root, 'data', 'refit-report.txt'), 'utf8'), /refit not used/);

// a refit marked for another style is not this arcana's (its first style)
c.pickItem(shoulder.slot, '9304', []);
c.apply();
assert.equal(shoulders(), 'FROCK-THREE');
console.log('REFIT OK');
