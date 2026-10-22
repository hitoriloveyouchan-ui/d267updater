// An item of one hero that switches an animation set on for all activities (Bloodfeather Frock, "qop_2022") puts the
// hero's own model back under its path with that set made the default: a match never switches it on, and the dress made
// for it sinks into the body. Only that kind of item, and only when the model has something to change.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { itemAssets, gameAssetEntries } from '../src/item-builder-assets.ts';
import { buildVpk, entryAt } from '../src/vpk.ts';

const NL = '\r\n';
const am = (o: Record<string, string>) => `\t\t"asset_modifier"${NL}\t\t{${NL}${Object.entries(o).map(([k, v]) => `\t\t\t"${k}"\t\t"${v}"${NL}`).join('')}\t\t}${NL}`;
const vis = (...mods: string[]) => `"visuals"${NL}{${NL}${mods.join('')}}${NL}`;
const text = `"items_game"${NL}{${NL}\t"items"${NL}\t{${NL}\t}${NL}}${NL}`;
const QOP = ['npc_dota_hero_queenofpain'];
const owns = (v: string, heroes = QOP) => itemAssets(text, v, heroes).assetCopies.filter((c) => 'own' in c);

// the Frock: an activity for ALL, a style-1 taunt, a particle swap
const frock = vis(
  am({ type: 'activity', asset: 'ALL', modifier: 'qop_2022' }),
  am({ type: 'activity', asset: 'ACT_DOTA_TAUNT', modifier: 'qop_2022_taunt_style_2', style: '1', gesture: '1' }),
  am({ type: 'particle', asset: 'particles/a.vpcf', modifier: 'particles/b.vpcf' }),
);
assert.deepEqual(owns(frock), [{ from: '', hero: 'npc_dota_hero_queenofpain', activities: ['qop_2022'], own: true }]);

// not for: another activity than ALL, a style's own, a hero model swap (the arcana's copy does this), an item of two heroes, no activity
assert.deepEqual(owns(vis(am({ type: 'activity', asset: 'ACT_DOTA_ATTACK', modifier: 'x' }))), []);
assert.deepEqual(owns(vis(am({ type: 'activity', asset: 'ALL', modifier: 'x', style: '1' }))), []);
assert.deepEqual(owns(vis(am({ type: 'activity', asset: 'ALL', modifier: 'x' }), am({ type: 'entity_model', asset: 'npc_dota_hero_queenofpain', modifier: 'models/x.vmdl' }))), []);
assert.deepEqual(owns(frock, ['npc_dota_hero_a', 'npc_dota_hero_b']), []);
assert.deepEqual(owns(vis(am({ type: 'particle_create', modifier: 'particles/c.vpcf' }))), []);

// the build: the hero's model is read from its script; a model with nothing to change is not staged again
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-own-'));
fs.mkdirSync(path.join(root, 'dota'), { recursive: true });
fs.writeFileSync(path.join(root, 'dota', 'pak01_dir.vpk'), buildVpk([
  entryAt('scripts/npc/heroes/npc_dota_hero_queenofpain.txt', Buffer.from('"DOTAHeroes"\n{\n\t"npc_dota_hero_queenofpain"\n\t{\n\t\t"Model"\t\t"models/heroes/queenofpain/queenofpain.vmdl"\n\t}\n}\n')),
  entryAt('models/heroes/queenofpain/queenofpain.vmdl_c', Buffer.from('NOT A RESOURCE')),
]));
assert.deepEqual(gameAssetEntries(root, owns(frock)), [], 'a model the reader cannot change goes in as nothing');
console.log('OWN ANIMATIONS OK');
