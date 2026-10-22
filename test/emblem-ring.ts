// Emblem on the selection ring, on a synthetic Dota tree: a hero whose ability has a gold and a red picture (two items swap
// it), a pick -> the variant's file under the ability's plain path -> pick another -> reset -> clean game.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createCosmetics } from '../src/cosmetics.ts';
import { buildVpk, entryAt, readVpkEntryFile } from '../src/vpk.ts';
import { references, dataBlock } from '../src/resource.ts';
import { readKv3 } from '../src/kv3.ts';
import { fileHashes } from '../src/patcher-signatures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-icons-'));
const game = path.join(root, 'game');
fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
const binDir = path.join(game, 'bin', process.platform === 'linux' ? 'linuxsteamrt64' : 'win64');
fs.mkdirSync(binDir, { recursive: true });

const NL = '\r\n';
const item = (id: string, fields: string) => `\t\t"${id}"${NL}\t\t{${NL}${fields}\t\t}${NL}`;
const f = (k: string, v: string) => `\t\t\t"${k}"\t\t"${v}"${NL}`;
const heroes = (...h: string[]) => `\t\t\t"used_by_heroes"${NL}\t\t\t{${NL}${h.map((x) => `\t\t\t\t"${x}"\t\t"1"${NL}`).join('')}\t\t\t}${NL}`;
let modN = 0;
const mod = (type: string, modifier: string, asset = '') => `\t\t\t\t"asset_modifier${modN++}"${NL}\t\t\t\t{${NL}\t\t\t\t\t"type"\t\t"${type}"${NL}${asset ? `\t\t\t\t\t"asset"\t\t"${asset}"${NL}` : ''}\t\t\t\t\t"modifier"\t"${modifier}"${NL}\t\t\t\t}${NL}`;
const rich = (fx: string) => `\t\t\t"visuals"${NL}\t\t\t{${NL}`
  + mod('particle_create', 'particles/econ/events/x/loadout.vpcf', 'npc_dota_loadout_generic')
  + mod('particle_create', fx)
  + mod('diretide_effect', 'particles/econ/events/x/attack_modifier.vpcf', 'emblem_attack_effect')
  + `\t\t\t}${NL}`;
const emblem = (fx: string) => `\t\t\t"visuals"${NL}\t\t\t{${NL}\t\t\t\t"asset_modifier0"${NL}\t\t\t\t{${NL}\t\t\t\t\t"type"\t\t"particle_create"${NL}\t\t\t\t\t"modifier"\t"${fx}"${NL}\t\t\t\t}${NL}\t\t\t}${NL}`;
const FX = 'particles/econ/events/diretide_2020/emblem/fall20_emblem_v1_effect.vpcf';

const items = `"items_game"${NL}{${NL}\t"items"${NL}\t{${NL}`
  + item('8001', f('name', 'Diretide Emblem') + f('prefab', 'emblem') + f('item_slot', 'emblem') + f('expiration_date', '1700000000') + rich(FX))
  + item('8002', f('name', 'Plain Emblem') + f('prefab', 'emblem') + f('item_slot', 'emblem'))
  + item('8003', f('name', 'Overgrown Emblem') + f('prefab', 'emblem') + f('item_slot', 'emblem') + emblem(FX))
  + item('8004', f('name', 'Sunken Emblem') + f('prefab', 'emblem') + f('item_slot', 'emblem') + emblem(FX))
  + Array.from({ length: 1200 }, (_, i) => item(String(20000 + i), f('name', `filler ${i}`))).join('')
  + `\t}${NL}}${NL}`;

// stand-ins for the game's TI9 attack particles (any compiled particle will do)
const standIn = readVpkEntryFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'emblem-attack', 'ti9-template.vpk'), 'particles/items2_fx/skadi_projectile_core_glow.vpcf_c')!.data;
const TI9 = ['burst_endcap', 'darktrail', 'ember', 'flash', 'glow', 'launch', 'launch_burst', 'petals', 'ribbon', 'tip', 'trail_core_b', 'trail_sparks_endcap'];
fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
  entryAt('scripts/items/items_game.txt', Buffer.from(items, 'latin1')),
  ...TI9.map((n) => entryAt(`particles/econ/attack/attack_modifier_ti9_${n}.vpcf_c`, Buffer.from(standIn))),
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

// only the emblem that has a particle is offered
const groups = c.emblems();
assert.deepEqual(groups.map((g) => g.options.map((o) => o.id)), [['8001', '8003', '8004']]);
assert.deepEqual(groups[0].options.map((o) => !!o.attack), [true, true, false], 'Diretide and Overgrown have an attack effect, Sunken has none');

c.pickEmblem('emblem', '8001');
assert.equal(builtPak(), null);
const r = c.apply();
assert.equal(r.deployed, true);
assert.deepEqual(r.failed, []);

const pak = builtPak()!;
const ring = readVpkEntryFile(pak, 'particles/ui_mouseactions/selected_ring.vpcf_c');
assert.ok(ring, 'the ring is in the mod pak');
const refs = references(ring!.data);
assert.ok(refs.includes(FX), 'the ring names the emblem particle');
const kids = (readKv3(dataBlock(ring!.data).data).root as any).members.get('m_Children').items.map((i: any) => i.members.get('m_ChildRef').value);
assert.deepEqual(kids, ['particles/ui_mouseactions/selected_ring_b.vpcf', FX]);

// the attack effect is always on for an emblem that has one: its attack modifier is the slot's default item, the hero particle is not
const table2 = readVpkEntryFile(pak, 'scripts/items/items_game.txt')!.data.toString('latin1');
const at = table2.indexOf('"8001"');
const block = table2.slice(at, table2.indexOf('"8002"'));
assert.match(block, /"baseitem"\s+"1"/);
assert.match(block, /diretide_effect/);
assert.ok(!/particle_create/.test(block), 'the hero particle and the loadout ones stay off the default item');
assert.ok(!/expiration_date/.test(block));

// an emblem with an attack pack brings its particle files while worn, and takes them away when another one is picked
const PACK_FILES = ['particles/units/heroes/hero_rubick/rubick_base_attack.vpcf_c', 'kisilev_ind/particles/modifier_attack/attack_modifier_core3_kisilev_ind.vpcf_c'];
c.pickEmblem('emblem', '8003');
assert.deepEqual(c.apply().failed, []);
for (const f of PACK_FILES) assert.ok(readVpkEntryFile(builtPak()!, f), `the pack's ${f} is in the mod pak`);
assert.ok(readVpkEntryFile(builtPak()!, 'particles/ui_mouseactions/selected_ring.vpcf_c'), 'the ring comes with it');
c.pickEmblem('emblem', '8001');
c.apply();
for (const f of PACK_FILES) assert.ok(!readVpkEntryFile(builtPak()!, f), `${f} is gone with the other emblem`);

// an emblem with no attack effect brings none
c.pickEmblem('emblem', '8004');
assert.deepEqual(c.apply().failed, []);
for (const f of PACK_FILES) assert.ok(!readVpkEntryFile(builtPak()!, f), `${f} is not in the pak of an emblem without an attack effect`);

// clear -> clean game
c.pickEmblem('emblem', null);
c.apply();
assert.equal(builtPak(), null);
console.log('EMBLEM RING OK');
