// Usage: node tools/scan-model.ts <modifier> <pak path prefix>... [--game "<...>/dota 2 beta/game"] [--out file]
//   e.g. node tools/scan-model.ts qop_2022 models/heroes/queenofpain models/items/queenofpain/qop_2022_immortal
// For every model (.vmdl_c) of pak01 under those prefixes: its resource blocks, its skeleton size, the models it
// includes or references, and the animation sequences / clips that play for an activity modifier (the word you give).
// Writes model-scan.txt. It answers where an item's animation set lives (the hero's model, the item's, another)
// and what the item's model is made of, so a wearable that sits wrong can be traced without opening a viewer.
import fs from 'node:fs';
import path from 'node:path';
import { sharedVpkIndex } from '../src/vpk.ts';
import { findDotaGamePath } from '../src/steam.ts';
import { resourceBlocks, resourceBlock, references } from '../src/resource.ts';
import { readKv3 } from '../src/kv3.ts';
import type { Kv3Node } from '../src/kv3.ts';

const args = process.argv.slice(2);
const take = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? null : args.splice(i, 2)[1] ?? null; };
const gameArg = take('--game');
const outFile = path.resolve(take('--out') || 'model-scan.txt');
const [modifier, ...prefixes] = args;
if (!modifier || !prefixes.length) { console.error('Usage: node tools/scan-model.ts <modifier> <pak path prefix>... [--game "<...>/dota 2 beta/game"] [--out file]'); process.exit(1); }
const game = gameArg || await findDotaGamePath();
if (!game) { console.error('Dota 2 not found: add --game ".../dota 2 beta/game"'); process.exit(1); }
const pak = path.join(game, 'dota', 'pak01_dir.vpk');
if (!fs.existsSync(pak)) { console.error('not found: ' + pak); process.exit(1); }
const ix = sharedVpkIndex(pak);
const want = modifier.toLowerCase();

const str = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');
const obj = (n: Kv3Node | undefined) => (n?.kind === 'object' ? n.members : null);
const arr = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const lines: string[] = [`game: ${game}`, `modifier: ${modifier}`, `prefixes: ${prefixes.join(' ')}`, ''];
const log = (...s: string[]) => lines.push(...s);

let files = 0, withHits = 0;
for (const p of [...ix.paths()].map((x) => x.toLowerCase()).filter((x) => x.endsWith('.vmdl_c') && prefixes.some((pre) => x.startsWith(pre.toLowerCase()))).sort()) {
  files++;
  const data = ix.read(p);
  if (!data) { log(`## ${p}: cannot read`); continue; }
  const head: string[] = [];
  const hits: string[] = [];
  try {
    const blocks = resourceBlocks(data);
    head.push(`blocks: ${blocks.map((b) => `${b.name}(${b.size})`).join(' ')}`);
    for (const [name, listKey] of [['ASEQ', 'm_localS1SeqDescArray'], ['ANIM', 'm_animArray']] as const) {
      if (!blocks.some((b) => b.name === name)) continue;
      const kv = readKv3(resourceBlock(data, name).data);
      const list = arr(obj(kv.root)?.get(listKey));
      head.push(`${name}: ${list.length} entries`);
      for (const x of list) {
        const m = obj(x);
        const acts = arr(m?.get('m_activityArray')).map((a) => str(obj(a)?.get('m_name')));
        const nm = str(m?.get('m_name'));
        if (acts.some((a) => a.toLowerCase().includes(want)) || nm.toLowerCase().includes(want)) hits.push(`  ${name} "${nm}" activities: ${acts.join(', ') || '(none)'}`);
      }
    }
    if (blocks.some((b) => b.name === 'DATA')) {
      const root = obj(readKv3(resourceBlock(data, 'DATA').data).root);
      const bones = arr(obj(root?.get('m_modelSkeleton'))?.get('m_boneName')).length;
      if (bones) head.push(`skeleton: ${bones} bones`);
      const keys = root ? [...root.keys()].filter((k) => /anim|include|group|attach|hide|combine|cloth|physics/i.test(k)) : [];
      if (keys.length) head.push(`DATA keys: ${keys.join(', ')}`);
      for (const k of keys.filter((k) => /include|animgroup|refanim/i.test(k))) {
        const v = root!.get(k);
        const strs = arr(v).map(str).filter(Boolean);
        if (strs.length) head.push(`  ${k}: ${strs.slice(0, 12).join(' | ')}${strs.length > 12 ? ' ...' : ''}`);
      }
    }
    const refs = references(data).filter((r) => /\.vmdl|\.vanmgrph|\.vagrp|\.vseq|\.vmat/i.test(r));
    head.push(`references: ${refs.length}${refs.length ? ' e.g. ' + refs.slice(0, 6).join(' | ') : ''}`);
  } catch (err) {
    head.push(`cannot read: ${(err as Error).message}`);
  }
  if (hits.length) withHits++;
  log(`## ${p}${hits.length ? `   <-- ${hits.length} entries for "${modifier}"` : ''}`, ...head.map((h) => '  ' + h), ...hits.slice(0, 40), '');
}
log(`== ${files} model(s) scanned, ${withHits} carry "${modifier}" ==`);
fs.writeFileSync(outFile, lines.join('\n'));
console.log(lines.filter((l) => l.startsWith('##') && l.includes('<--')).join('\n') || '(no model carries it)');
console.log(`${files} model(s) scanned, ${withHits} with "${modifier}" -> ${outFile}`);
