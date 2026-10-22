// The Ethereal Gems' effects for the effect picker, read out of the player's own game.
//
// The first effects (Fire, Lightnings...) are a hand-made list in item-builder-effects.ts. This adds the
// ethereal gems ("Ethereal: Burning Animus", "Ethereal: Sunfire"...): each is an item whose `visuals` has an
// asset_modifier of type "particle_create", the same kind of entry Fire and Lightnings are written as. The
// particle path and the fields next to it (attach type, control points...) are copied from the gem as the
// game has it, so the effect looks as the gem does.
//
// Nothing is invented here: an effect is listed only when an ethereal item of this build of the game really
// creates that particle and the particle file really is in pak01, so a Dota update can only add or drop
// entries, never leave one that points at nothing.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sharedVpkIndex } from './vpk.ts';
import { listItems, eachChild, blockBounds, toUtf8 } from './schema.ts';
import type { ItemEffect } from './item-builder-effects.ts';

/** "Ethereal: Burning Animus": how the gems are named. */
const GEM_NAME = /^\s*ethereal\s*[:：]\s*/i;
const LOOSE = /ethereal/i;
const MAX = 120;

export interface GameEffects { effects: ItemEffect[]; report: string[] }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const normalize = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase();

/** "ethereal_flames_ambient" -> "Ethereal Flames Ambient": only to tell a gem's second particle from its first. */
function prettyParticle(file: string): string {
  return file.replace(/\.vpcf$/, '').split(/[_\-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

interface Seen { item: string; name: string; slot: string; strict: boolean; mods: { type: string; modifier: string; extra: string }[] }

export function discoverGameEffects(gamePath: string, text: string, skip: Set<string> = new Set()): GameEffects {
  const ix = sharedVpkIndex(path.join(gamePath, 'dota', 'pak01_dir.vpk'));
  const seen: Seen[] = [];

  for (const item of listItems(text)) {
    if (!item.hasVisuals || item.baseitem) continue;
    const name = toUtf8(item.name).trim();
    const strict = GEM_NAME.test(name);
    if (!strict && !LOOSE.test([name, item.itemName, item.prefab, item.slot].filter(Boolean).join(' '))) continue;
    const mods: Seen['mods'] = [];
    eachChild(text, blockBounds(text, item.start), (c) => {
      if (!c.isBlock || c.key.toLowerCase() !== 'visuals') return;
      eachChild(text, c.body, (m) => {
        if (!m.isBlock || !/^asset_modifier\d*$/i.test(m.key)) return;
        let type = '', modifier = '';
        const extra: string[] = [];
        eachChild(text, m.body, (x) => {
          const k = x.key.toLowerCase();
          if (!x.isBlock && k === 'type') type = x.value.toLowerCase();
          else if (!x.isBlock && k === 'modifier') modifier = x.value;
          else extra.push(text.slice(x.start, x.end)); // attach type, control points...: kept as the game has them
        });
        mods.push({ type, modifier, extra: extra.join('\r\n\t\t') });
      });
    });
    seen.push({ item: item.id, name, slot: item.slot || item.prefab || '', strict, mods });
  }

  // the gems by their name; when no item is named like one, anything with "ethereal" in it (and the report says so)
  const gems = seen.some((s) => s.strict) ? seen.filter((s) => s.strict) : seen;
  const byPath = new Map<string, { name: string; extra: string }>();
  let particles = 0, missing = 0;
  for (const g of gems) {
    const label = g.name.replace(GEM_NAME, '').trim() || g.name;
    for (const m of g.mods) {
      if (m.type !== 'particle_create') continue;
      const mod = normalize(m.modifier);
      if (!mod.endsWith('.vpcf')) continue;
      particles++;
      if (skip.has(mod) || byPath.has(mod)) continue;
      if (!ix.has(`${mod}_c`)) { missing++; continue; }
      byPath.set(mod, { name: label, extra: m.extra });
    }
  }

  // the same gem on several particles: the second and later get their file name to tell them apart
  const used = new Map<string, number>();
  const effects: ItemEffect[] = [];
  for (const [mod, info] of [...byPath].sort((a, b) => a[1].name.localeCompare(b[1].name) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const file = path.posix.basename(mod);
    let name = info.name || prettyParticle(file);
    const n = (used.get(name) || 0) + 1;
    used.set(name, n);
    if (n > 1) name = `${name} (${prettyParticle(file)})`;
    const id = `g-${slug(file.replace(/\.vpcf$/, '')).slice(0, 40)}-${createHash('sha1').update(mod).digest('hex').slice(0, 6)}`;
    effects.push({ id, name, type: 'particle_create', modifier: mod, ...(info.extra ? { extra: info.extra } : {}) });
    if (effects.length >= MAX) break;
  }

  const report = [
    `ethereal effects offered: ${effects.length} (items named "Ethereal: ...": ${seen.filter((s) => s.strict).length}, `
    + `particle_create particles seen: ${particles}, not in pak01: ${missing}${seen.some((s) => s.strict) ? '' : '; NO item is named "Ethereal: ...", so every item with "ethereal" in it was used'})`,
    '',
    '== offered (id, name, particle) ==',
    ...effects.map((e) => `${e.id}\t${e.name}\t${e.modifier}`),
    '',
    '== every item with "ethereal" in it: id, slot/prefab, name, then its asset_modifiers (type -> modifier) ==',
    ...seen.slice(0, 400).map((s) => `#${s.item} [${s.slot}] ${s.name}${s.mods.length ? ' | ' + s.mods.map((m) => `${m.type || '?'} -> ${m.modifier || '(none)'}`).join('; ') : ' | (no asset_modifier)'}`),
  ];
  return { effects, report };
}
