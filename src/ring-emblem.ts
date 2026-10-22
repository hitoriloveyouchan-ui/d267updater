/**
 * Emblems that only their owner sees.
 *
 * An emblem put in items_game as the slot's "baseitem" is the default of every account that wears
 * nothing in that slot: bots and enemies got it, and the owner, who has an emblem of their own on,
 * did not. The selection ring is different: particles/ui_mouseactions/selected_ring is drawn by
 * each client for the units that client selected, so a child particle hung on it is seen by the
 * player alone. That is how the emblem packs found on other sites work (pak28: the stock ring and
 * one extra child, the Diretide 2020 emblem effect).
 *
 * The template in assets/ring-emblem is that ring. Only its second child, the emblem's particle,
 * and the RERL line naming it change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataBlock, references, replaceReferences } from './resource.ts';
import { readKv3 } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { findItem } from './schema-items.ts';
import { eachChild, blockBounds } from './schema-kv.ts';
import { entryAt, type VpkEntry } from './vpk-write.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'ring-emblem');
export const RING_PATH = 'particles/ui_mouseactions/selected_ring.vpcf_c';
/** the stock ring the emblem hangs on, the first child of the template */
const STOCK_CHILD = 'particles/ui_mouseactions/selected_ring_b.vpcf';

/** The emblem item's particle (its asset_modifier of type particle_create), or null when it has none. */
export function emblemParticle(text: string, itemId: string | number): string | null {
  const item = findItem(text, itemId);
  if (!item) return null;
  let found: string | null = null;
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'visuals') return;
    eachChild(text, c.body, (a) => {
      if (!a.isBlock || !/^asset_modifier\d*$/i.test(a.key)) return;
      const f = new Map<string, string>();
      eachChild(text, a.body, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value); });
      const style = f.get('style');
      const mod = (f.get('modifier') || '').replace(/\\/g, '/').toLowerCase();
      // the hero's own effect only: the ones with an "asset" (npc_dota_loadout_generic) are for the loadout screen
      if (!found && !f.get('asset') && (f.get('type') || '').toLowerCase() === 'particle_create' && mod.endsWith('.vpcf') && (!style || style === '0')) found = mod;
    });
  });
  return found;
}

/**
 * The emblem's attack effect on its own: the item's block with only its "diretide_effect" modifier(s) left,
 * marked "baseitem" so the game wears it, or null when the emblem has none (the TI ones). The hero's own
 * particle is not in it: the selection ring carries that one, for the player alone. Unlike the ring this
 * default is the game's for every account with an empty emblem slot, which is what the attack effect needs.
 */
export function emblemAttackPatch(text: string, itemId: string | number): string | null {
  const item = findItem(text, itemId);
  if (!item) return null;
  const cut: [number, number][] = [];
  let keep = 0;
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'visuals') return;
    eachChild(text, c.body, (a) => {
      if (!a.isBlock || !/^asset_modifier\d*$/i.test(a.key)) return;
      let type = '';
      eachChild(text, a.body, (x) => { if (!x.isBlock && x.key.toLowerCase() === 'type') type = x.value.toLowerCase(); });
      if (type === 'diretide_effect') keep++; else cut.push([a.start - item.start, a.end - item.start]);
    });
  });
  if (!keep) return null;
  let block = item.text;
  for (const [a, b] of cut.sort((x, y) => y[0] - x[0])) block = block.slice(0, a) + block.slice(b);
  block = block.replace(/^[ \t]*"expiration_date"[ \t]+"[^"\r\n]*"[ \t]*\r?\n/gm, '');
  if (!/^[ \t]*"baseitem"[ \t]+"1"/m.test(block)) {
    const open = block.indexOf('{');
    block = block.slice(0, open + 1) + '\r\n\t\t\t"baseitem"\t"1"' + block.slice(open + 1);
  }
  return block;
}

/** Every asset_modifier of the emblem as one line each (type, asset, modifier, the rest), for emblems-report.txt. */
export function emblemModifiers(text: string, itemId: string | number): string[] {
  const item = findItem(text, itemId);
  if (!item) return [];
  const out: string[] = [];
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'visuals') return;
    eachChild(text, c.body, (a) => {
      if (a.isBlock) {
        const parts: string[] = [];
        eachChild(text, a.body, (x) => { parts.push(x.isBlock ? `${x.key}={...}` : `${x.key}=${x.value}`); });
        out.push(`${a.key}: ${parts.join('; ')}`);
      } else out.push(`${a.key}=${a.value}`);
    });
  });
  return out;
}

/** selected_ring.vpcf_c with `effect` (a .vpcf path) as the emblem child. */
export function ringEmblemFile(effect: string): Buffer {
  const file = fs.readFileSync(path.join(ROOT, RING_PATH));
  const d = dataBlock(file);
  const kv = readKv3(d.data);
  const kids = kv.root.kind === 'object' ? kv.root.members.get('m_Children') : undefined;
  if (!kids || kids.kind !== 'array' || kids.items.length < 2) throw new Error('ring-emblem: в шаблоне кольца нет дочерней частицы');
  const slot = kids.items[1];
  const ref = slot.kind === 'object' ? slot.members.get('m_ChildRef') : undefined;
  if (!ref || ref.kind !== 'string') throw new Error('ring-emblem: в шаблоне кольца нет m_ChildRef');
  ref.value = effect;
  const out = d.replace(writeKv3(kv));
  const names = references(file).filter((n) => n.toLowerCase() === STOCK_CHILD || !n.toLowerCase().endsWith('.vpcf'));
  return replaceReferences(out, [...names, effect]);
}

/** The ring as a file for the mod's VPK. */
export function ringEmblemEntries(effect: string): VpkEntry[] {
  return [entryAt(RING_PATH, ringEmblemFile(effect))];
}
