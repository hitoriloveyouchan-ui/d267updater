/**
 * An emblem's attack effect.
 *
 * The game's items table gives an attack effect to the Diretide emblems only (type "diretide_effect"). The TI9 one
 * (Overgrown Emblem) exists as particles in the game (particles/econ/attack/attack_modifier_ti9*) with nothing linking
 * it to the emblem. The other emblems have no attack effect at all. So the effect is built here, the way the
 * "kisilev_ind" pack does it: the hero's base-attack particles are replaced by wrappers that draw an effect on top of
 * the original attack (kept under kisilev_ind/). Particles are drawn by each client from its own files, so this is
 * a local, visual-only change.
 *
 * assets/emblem-attack/ti9-template.vpk holds the wrappers (about 150 heroes' attacks) and the three "core" particles
 * that spawn the effect. Overgrown Emblem uses it as it is: its effect is the game's own TI9 one. For an emblem
 * with a colour in TINTS, the game's TI9 attack particles are copied, moved to that colour and put under
 * kisilev_ind/particles/emblem_attack/<emblem>/, and the cores are pointed at the copies.
 *
 * A VPK named after an emblem in assets/emblem-attack/ ("Sunken Emblem" -> sunken-emblem.vpk) is used instead, as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVpkEntries, entryPath } from './vpk-read.ts';
import { entryAt, type VpkEntry } from './vpk-write.ts';
import { sharedVpkIndex } from './vpk-shared.ts';
import { dataBlock, references, replaceReferences } from './resource.ts';
import { readKv3 } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { recolorResource, type Rgb } from './recolor.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'emblem-attack');
const TEMPLATE = 'ti9-template.vpk';
/** the game's TI9 attack particles, and where their recoloured copies go */
const SRC_PREFIX = 'particles/econ/attack/attack_modifier_ti9';
const CORE = /(^|\/)attack_modifier_core\d+_kisilev_ind\.vpcf_c$/i;

/**
 * The colour of each emblem's attack effect (emblem slug -> RGB); null keeps the game's TI9 colours.
 * Colours are the emblem's own look: change a line to change the effect.
 */
export const TINTS: Record<string, Rgb | null> = {
  'overgrown-emblem': null,
  // The other emblems have no attack effect in the game; these recoloured TI9 ones are off for now (uncomment to use):
  // 'sunken-emblem': [70, 190, 230],
  // 'emblem-of-the-crystal-echelon': [160, 110, 230],
  // 'emblem-of-divinity': [255, 200, 80],
  // 'nemestice-emblem-2021': [210, 110, 230],
  // 'aghanim-s-2021-emblem': [80, 150, 255],
  // 'battle-pass-2022-emblem': [255, 90, 50],
};

/** "Overgrown Emblem" -> "overgrown-emblem": the name a pack file and a colour are looked up by. */
export function emblemSlug(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function dropIn(slug: string, dir: string): string | null {
  if (!slug || !fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.vpk$/i.test(f) || f.toLowerCase() === TEMPLATE) continue;
    if (emblemSlug(f.replace(/(_dir)?\.vpk$/i, '')) === slug) return path.join(dir, f);
  }
  return null;
}

/** Whether the emblem with this name has an attack effect (a pack of its own, or a colour for the TI9 one). */
export function hasAttackEffect(name: string, dir = ROOT): boolean {
  const slug = emblemSlug(name);
  return slug in TINTS || !!dropIn(slug, dir);
}

const readPack = (file: string): VpkEntry[] => readVpkEntries(fs.readFileSync(file), file) as VpkEntry[];

/** The file with the children (and RERL names) `map` renames pointed at their new paths. */
function remap(file: Buffer, map: (p: string) => string | null): Buffer {
  const d = dataBlock(file);
  const kv = readKv3(d.data);
  let changed = false;
  const kids = kv.root.kind === 'object' ? kv.root.members.get('m_Children') : undefined;
  if (kids && kids.kind === 'array') {
    for (const it of kids.items) {
      const ref = it.kind === 'object' ? it.members.get('m_ChildRef') : undefined;
      if (ref && ref.kind === 'string') { const n = map(ref.value); if (n) { ref.value = n; changed = true; } }
    }
  }
  let out = changed ? d.replace(writeKv3(kv)) : file;
  const names = references(out);
  const next = names.map((n) => map(n) ?? n);
  if (next.some((n, i) => n !== names[i])) out = replaceReferences(out, next);
  return out;
}

/** The template with the game's TI9 attack particles recoloured to `tint`, copied under the emblem's own folder. */
export function tintedEntries(template: VpkEntry[], pak01: string, slug: string, tint: Rgb): VpkEntry[] {
  const ix = sharedVpkIndex(pak01);
  const dest = `kisilev_ind/particles/emblem_attack/${slug}/`;
  const map = (p: string): string | null => {
    const l = p.toLowerCase();
    return l.startsWith(SRC_PREFIX) && l.endsWith('.vpcf') ? dest + l.slice(l.lastIndexOf('/') + 1) : null;
  };
  const out: VpkEntry[] = [];
  for (const en of template) {
    const p = entryPath(en);
    out.push(CORE.test(p) ? entryAt(p, remap(Buffer.from(en.data), map)) : en);
  }
  const done = new Set<string>();
  const queue = template.filter((en) => CORE.test(entryPath(en))).flatMap((en) => references(en.data).filter((n) => map(n)));
  while (queue.length) {
    const src = queue.shift()!;
    if (done.has(src)) continue;
    done.add(src);
    const raw = ix.read(`${src}_c`);
    if (!raw) throw new Error(`в игре нет частицы ${src}`);
    const colored = recolorResource(Buffer.from(raw), tint).file;
    out.push(entryAt(`${map(src)!}_c`, remap(colored, map)));
    for (const n of references(raw)) if (map(n)) queue.push(n);
  }
  return out;
}

/** The files of the emblem's attack effect for the mod's pak, or null when it has none. */
export function attackEntriesFor(name: string, pak01: string, dir = ROOT): VpkEntry[] | null {
  const slug = emblemSlug(name);
  const own = dropIn(slug, dir);
  if (own) return readPack(own);
  if (!(slug in TINTS)) return null;
  const template = readPack(path.join(dir, TEMPLATE));
  const tint = TINTS[slug];
  return tint ? tintedEntries(template, pak01, slug, tint) : template;
}
