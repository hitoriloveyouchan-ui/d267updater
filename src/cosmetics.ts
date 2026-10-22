// Free cosmetics, as one small service: the slot picker, hero items and the patch they need.
//
// Built on the modules lifted from Dota 2 Mod Manager (GPL-3.0, see LICENSE and NOTICE):
//   patcher.ts  registers the extra content folder in gameinfo_branchspecific.gi and signs it;
//   schema.ts   rebuilds items_game.txt from the installed game and packs it as pak01_dir.vpk.
// This file is the glue and is written for this project: it keeps its own tiny state file, so it
// needs no library or settings object from the host app.
//
// What a "pick" is: every slot (weather, courier, ward, loading screen, announcer...) has a free
// base item every account owns. A pick copies the `visuals` block of another item of that slot
// onto the base item, so the game draws the picked look in place of the default one.
//
// Hero items ("Предметы") work the same way one level down: every hero has a stock default_item per
// equip slot, and a hero pick writes a wearable's block over it (src/item-builder.ts), together with
// the models, particles, sounds and portraits it needs under the plain paths of the game's files.
import { errorStockEntries } from './error-stock.ts';
import { emblemParticle, emblemModifiers, emblemAttackPatch, ringEmblemEntries } from './ring-emblem.ts';
import { attackEntriesFor, hasAttackEffect } from './emblem-attack.ts';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as patcher from './patcher.ts';
import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import { itemSlots, itemSets, type ItemSlot, type ItemSet } from './item-builder.ts';
import { soundEntries, type SoundSwap, type VoiceCue } from './item-sounds.ts';
import { portraitEntries } from './item-portraits.ts';
import type { PortraitSwap, SpriteSwap } from './item-builder-assets.ts';
import { heroDisplayName, entryAt, entryPath, sharedVpkIndex, type VpkEntry } from './vpk.ts';
import { RECOLOR_SETS, recolorFiles, recolorMaterial, recolorResource, type Rgb } from './recolor.ts';
import { normalizeAssetPath } from './item-builder-assets.ts';
import { modFolderName, ensureModFolder } from './modfolder.ts';
import { abilityIconCatalog, iconCopies, type HeroIcons } from './ability-icons.ts';

export interface CosmeticsOptions {
  /** ...\dota 2 beta\game  (the folder that holds `dota` and `bin`) */
  gamePath: string;
  /** where this module keeps its backups and state file, e.g. app.getPath('userData') */
  dataDir: string;
}

export interface CosmeticSlotInfo {
  slot: string;
  /** the free base item of the slot */
  base: string;
  /** item id currently picked for the slot, or null */
  picked: string | null;
  options: { id: string; name: string; /** the emblem has an attack effect (its own in the item table, or a pack here) */ attack?: boolean }[];
}

export interface CosmeticsState {
  patched: boolean;
  signed: boolean;
  signable: boolean;
  outdated: boolean;
  foreign: string | null;
  deployed: boolean;
  /** picks made since the last «Применить косметику»: the game's files do not have them yet */
  pending: boolean;
  picks: Record<string, string>;
  /** hero item picks by builder slot id (item:<hero>:<slot>) */
  items: Record<string, HeroPick>;
  /** ability icon picks: ability name -> the picture (file name under spellicons) it shows */
  icons: Record<string, string>;
  /** effects on free-cosmetic slots that take them (the courier): slot -> effect ids as itemBuilder.effectKey writes them */
  fx: Record<string, string>;
  /** the colour of Terrorblade's gem, or null: the arcana as the game's own files make it */
  gem: Rgb | null;
}

/** A hero slot's pick: the wearable and its effects as itemBuilder.effectKey writes them. */
export interface HeroPick { itemId: string; effects: string }

export interface HeroSummary {
  id: string; name: string;
  /** equip slots the builder can dress for this hero */
  slots: number;
  /** slots with a pick on them */
  picked: number;
  /** sets the builder can put on in one go */
  sets: number;
}

export interface HeroSlotInfo extends Omit<ItemSlot, 'kind'> { picked: HeroPick | null }

/* Terrorblade's gem. The arcana is red because it comes with a gem (Reflection's Shade); a mod has no
 * gem, so the colour is written into the arcana's particles and materials instead (src/recolor.ts,
 * the same as the original's arcana window). It is applied while one of the arcana's items is worn. */
const GEM_SET = 'terrorblade-arcana';
/** the slot of the emblems (prefab "emblem"), which has no free base item */
const EMBLEM_SLOT = 'emblem';
/** the key in `fx` of the switch «эффект атаки эмблемы»: not an effect id, a flag (it is in the snapshot, so a change makes the build pending) */
/** free-cosmetic slots that can carry the builder's particle effects */
const FX_SLOTS = new Set(['courier']);
/** Fractal Horns of Inner Abysm and the second piece of the set (src/arcana-bases.ts) */
const GEM_ITEMS = new Set(['5957', '37161']);
export const DEFAULT_GEM: Rgb = RECOLOR_SETS[GEM_SET].gem;

/** A colour from the window: three whole numbers 0-255, or null. */
export function validGem(c: unknown): Rgb | null {
  return Array.isArray(c) && c.length === 3 && c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? c as Rgb : null;
}
const wearsGem = (slotId: string, rec: HeroPick) => slotId.startsWith('item:terrorblade:') && GEM_ITEMS.has(String(rec.itemId));

/** What a build is made from: the picks of every kind. The pak in the game always matches one of these (`applied`). */
interface Snap { picks: Record<string, string>; items: Record<string, HeroPick>; icons: Record<string, string>; fx: Record<string, string>; gem: Rgb | null }

interface Saved {
  /** the mod folder the pak was last written into (dota_russian...) */ folder?: string | null;
  picks: Record<string, string>; items: Record<string, HeroPick>; icons?: Record<string, string>; fx?: Record<string, string>; gem?: Rgb | null; stamp: string | null;
  /** the picks the pak in the game was last built from; the picks above can be ahead of it until «Применить косметику» */
  applied?: Snap;
}

/** The picks as a build sees them (the gem colour only counts while a gem item is worn). */
function snap(s: Pick<Saved, 'picks' | 'items' | 'icons' | 'fx' | 'gem'>): Snap {
  const items = s.items ?? {};
  const gem = s.gem && Object.entries(items).some(([slotId, rec]) => wearsGem(slotId, rec)) ? s.gem : null;
  return { picks: s.picks ?? {}, items, icons: s.icons ?? {}, fx: s.fx ?? {}, gem };
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const sameSnap = (a: Snap, b: Snap) => canon(a) === canon(b);

export function isGameRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      return /dota2\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH'], { encoding: 'utf8', windowsHide: true }));
    }
    execFileSync('pgrep', ['-x', 'dota2'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function createCosmetics({ gamePath, dataDir }: CosmeticsOptions) {
  const backupDir = path.join(dataDir, 'backups', 'patch');
  const stateFile = path.join(dataDir, 'cosmetics.json');

  function load(): Saved {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const cur = {
        picks: s.picks && typeof s.picks === 'object' ? s.picks : {},
        items: s.items && typeof s.items === 'object' ? s.items : {}, icons: s.icons && typeof s.icons === 'object' ? s.icons : {}, fx: s.fx && typeof s.fx === 'object' ? s.fx : {}, gem: validGem(s.gem),
      };
      // a state file from before the apply button: whatever was built then matches the picks (a stamp says something was built)
      const applied: Snap = s.applied && typeof s.applied === 'object'
        ? snap({ picks: s.applied.picks ?? {}, items: s.applied.items ?? {}, icons: s.applied.icons ?? {}, fx: s.applied.fx ?? {}, gem: validGem(s.applied.gem) })
        : s.stamp ? snap(cur) : snap({ picks: {}, items: {}, icons: {}, fx: {}, gem: null });
      return { ...cur, stamp: s.stamp ?? null, folder: s.folder ?? null, applied };
    } catch { return { picks: {}, items: {}, icons: {}, fx: {}, gem: null, stamp: null, applied: snap({ picks: {}, items: {}, icons: {}, fx: {}, gem: null }) }; }
  }
  function save(s: Saved): void {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s, null, 2));
    fs.renameSync(stateFile + '.tmp', stateFile);
  }
  /** The game's language folder, where the patch and the pak go: dota_russian, dota_koreana or dota_schinese. */
  const folder = (): string => modFolderName(gamePath);

  /* Earlier versions kept everything in game/dota_cosmetics, and a language change moves the target
   * folder. Whatever pak of ours is left in a folder that is no longer the target is removed; the
   * folders themselves are only dropped when nothing else is in them (schema.undeploy). */
  function cleanOldFolders(): void {
    const now = folder();
    const legacy = path.join(gamePath, 'dota_cosmetics');
    try {
      // only ever held our own pak (then named pak01_dir.vpk): anything else in it is not ours to delete
      if (fs.existsSync(legacy) && fs.readdirSync(legacy).every((f) => f.toLowerCase() === 'pak01_dir.vpk')) {
        fs.rmSync(legacy, { recursive: true, force: true });
      }
    } catch { /* left for the next start */ }
    const was = load().folder;
    if (was && was !== now) schema.undeploy({ gamePath, folder: was });
  }

  function guard(): void {
    if (isGameRunning()) throw new Error('Dota 2 запущена: закрой игру перед изменением файлов.');
  }

  /* A hero pick as built, kept for as long as the game's table is the one it was built from: the
   * files of one pick are read out of pak01 and a build of thirty would otherwise do it thirty times. */
  type BuiltPick = Awaited<ReturnType<typeof buildHeroPick>>;
  const built = new Map<string, BuiltPick>();
  let builtStamp: string | null = null;

  function buildHeroPick(baseText: string, rec: HeroPick, avoid?: Set<string>) {
    const made = itemBuilder.itemEffectPatch(baseText, rec.itemId, rec.effects, avoid);
    return { ...made, assets: itemBuilder.gameAssetEntries(gamePath, made.assetCopies) };
  }

  /** The pick with a model another worn item refits (itemBuilder.modelSwaps) put under its stock path in place of its own. */
  function refitPick(pick: BuiltPick, swaps: Map<string, string>, slotId: string, report: string[]): BuiltPick {
    const used: string[] = [];
    const assetCopies = pick.assetCopies.map((c) => {
      const to = 'to' in c ? swaps.get(normalizeAssetPath(c.from)) : undefined;
      if (!to || !('to' in c)) return c;
      used.push(`${c.from} -> ${to}`);
      return { ...c, from: to };
    });
    if (!used.length) return pick;
    try {
      const assets = itemBuilder.gameAssetEntries(gamePath, assetCopies);
      report.push(`${slotId}: refit ${used.join('; ')}`);
      return { ...pick, assetCopies, assets };
    } catch (err) {
      report.push(`${slotId}: refit not used (${(err as Error).message}): ${used.join('; ')}`); // not in the game's files: the plain model stays
      return pick;
    }
  }

  /* Valve's files of the set in one colour, kept for as long as the game and the colour are the same:
   * the recolour parses every particle of the set (seconds), and a rebuild happens on every pick. */
  let gemKept: { key: string; files: Map<string, Buffer>; failed: number } | null = null;
  const underAny = (p: string, prefixes: string[]) => prefixes.some((x) => p.startsWith(x));

  /**
   * Terrorblade's arcana in the gem's colour. The files the picks carry (the arcana's particles
   * copied under the hero's plain paths) are recoloured where they are, and the rest of the set
   * (particles and materials the arcana only names) is Valve's own file in the colour, returned
   * to go under every pick. `ownTo`: the paths a pick filled from the arcana's own particles.
   */
  function gemOverlay(color: Rgb, stamp: string, patches: schema.SchemaPatch[], ownTo: Set<string>): { beneath: VpkEntry[]; failed: string[] } {
    const def = RECOLOR_SETS[GEM_SET];
    const failed: string[] = [];
    const filled = new Set<string>();
    for (const patch of patches) {
      if (!patch.assets) continue;
      patch.assets = patch.assets.map((en) => {
        const p = entryPath(en).toLowerCase();
        filled.add(p);
        const own = ownTo.has(p) || underAny(p, def.own);
        const particle = p.endsWith('.vpcf_c') && (own || underAny(p, def.shared));
        const material = p.endsWith('.vmat_c') && underAny(p, def.materials);
        if (!particle && !material) return en;
        try {
          const r = particle ? recolorResource(en.data, color, { gem: def.gem, own, bake: true }) : recolorMaterial(en.data, color, { bake: true });
          return r.changed ? entryAt(p, r.file) : en;
        } catch { return en; }
      });
    }
    const key = `${stamp}|${color.join(',')}`;
    if (gemKept?.key !== key) {
      const r = recolorFiles({ pak01: path.join(gamePath, 'dota', 'pak01_dir.vpk'), set: GEM_SET, target: color, bake: true });
      gemKept = { key, files: r.files, failed: r.failed.length };
    }
    if (gemKept.failed) failed.push(`gem: ${gemKept.failed} файлов остались в своём цвете`);
    return { beneath: [...gemKept.files].filter(([p]) => !filled.has(p.toLowerCase())).map(([p, data]) => entryAt(p, data)), failed };
  }

  /**
   * Rebuild the schema pak from the game's own table + the picks (or remove it). Only «Применить косметику»
   * (apply) builds from the current picks; `from` is for putting back what was built before (heal).
   */
  function rebuild(from?: Snap): { deployed: boolean; applied: number; missing: string[]; failed: string[] } {
    const cur = load();
    const s: Saved = from ? { ...cur, ...from } : cur;
    const appliedNow = from ? cur.applied : snap(cur);
    const base = schema.readGameSchema(gamePath);
    if (builtStamp !== base.stamp) { built.clear(); builtStamp = base.stamp; }
    const patches: schema.SchemaPatch[] = [];
    const failed: string[] = [];
    const fxOf = (slot: string) => (FX_SLOTS.has(slot) ? s.fx?.[slot] || '' : '');
    let ringEffect: string | null = null;
    let attackPackFiles: VpkEntry[] = [];
    const slotIds = new Set([...Object.keys(s.picks), ...Object.keys(s.fx ?? {}).filter((k) => FX_SLOTS.has(k) && s.fx?.[k])]);
    for (const slot of slotIds) {
      const itemId = s.picks[slot];
      if (slot === EMBLEM_SLOT) {
        // An emblem is not put in the table as a default item (that went to every account with an empty slot:
        // bots and enemies). Its particle is hung on the selection ring, which each client draws for itself.
        if (itemId) {
          try {
            const fx = emblemParticle(base.text, itemId);
            if (!fx) failed.push(`${slot}: у этой эмблемы нет частицы`);
            else ringEffect = fx;
            // the emblem's own attack effect, when it has a pack: its particle files go into the pak while the emblem is worn
            const emblemName = schema.listItems(base.text).find((i) => i.id === String(itemId))?.name;
            if (emblemName) attackPackFiles = attackEntriesFor(schema.toUtf8(emblemName), path.join(gamePath, 'dota', 'pak01_dir.vpk')) ?? [];
            // the attack effect has no file to put under a path: the game takes it from the emblem worn in the slot
            const block = emblemAttackPatch(base.text, itemId);
            if (block) patches.push({ id: String(itemId), block, source: `${slot}:${itemId}:attack` });
          } catch (err) { failed.push(`${slot}: ${(err as Error)?.message || err}`); }
        }
        continue;
      }
      const target = schema.baseItemFor(base.text, slot);
      if (!target) continue; // Valve removed the slot: the pick just drops out
      try {
        // no pick but effects: the free item itself, with the effects on top of its own look
        let block = itemId ? schema.baseItemPatch(base.text, target.id, itemId) : schema.findItem(base.text, target.id)!.text;
        const fx = fxOf(slot);
        if (fx) block = itemBuilder.withItemEffects(block, fx);
        patches.push({ id: target.id, block, source: `${slot}:${itemId ?? 'default'}` });
      } catch (err) {
        // the donor item is gone from this build, or an effect is not known
        if (fxOf(slot)) failed.push(`${slot}: ${(err as Error)?.message || err}`);
      }
    }

    // hero items: each pick built once, then the sounds, voices and portraits of all of them
    const heroPatches: schema.SchemaPatch[] = [];
    const sounds: SoundSwap[] = [], voices: VoiceCue[] = [], portraits: PortraitSwap[] = [], sprites: SpriteSwap[] = [];
    const ownTo = new Set<string>();
    const gemOwn = RECOLOR_SETS[GEM_SET].own;
    // a pick for a slot whose stock item has no model borrows another stock item's path: not one that is
    // worn itself, and not one another such pick has taken
    const offered = builderOffer().slots;
    try { writeStockReport(base.text, [...new Set(Object.keys(s.items).flatMap((id) => offered.find((x) => x.slot === id)?.heroIds ?? []))]); } catch { /* only a help */ }
    const wornStock = new Set(Object.keys(s.items).map((id) => offered.find((x) => x.slot === id)?.targetId).filter((x): x is string => !!x));
    const lent = new Set<string>();
    // what each worn item says another worn item's model is to be: an arcana's refits of paid wearables to its body
    const swapsOf = new Map<string, Map<string, string>>();
    for (const [slotId, rec] of Object.entries(s.items)) {
      try {
        const swaps = itemBuilder.modelSwaps(base.text, rec.itemId, itemBuilder.styleOfKey(itemBuilder.effectKey(rec.effects)));
        if (swaps.size) swapsOf.set(slotId, swaps);
      } catch { /* the wearable is gone: its own pick reports it */ }
    }
    const refitLines: string[] = [];
    for (const [slotId, rec] of Object.entries(s.items)) {
      const avoid = offered.find((x) => x.slot === slotId)?.bare ? new Set([...wornStock, ...lent]) : undefined;
      const key = `${rec.itemId}|${itemBuilder.effectKey(rec.effects)}${avoid ? `|${[...avoid].sort().join(',')}` : ''}`;
      try {
        let pick = built.get(key);
        if (!pick) { pick = buildHeroPick(base.text, rec, avoid); built.set(key, pick); }
        if (pick.borrowed) lent.add(pick.borrowed);
        // another worn item of the hero refits this one's model (the arcana's body): its refit goes under the stock path
        const mine = new Set(offered.find((x) => x.slot === slotId)?.heroIds ?? []);
        const swaps = new Map<string, string>();
        for (const [other, m] of swapsOf) {
          if (other === slotId || !(offered.find((x) => x.slot === other)?.heroIds ?? []).some((h) => mine.has(h))) continue;
          for (const [from, to] of m) if (!swaps.has(from)) swaps.set(from, to);
        }
        if (swaps.size) pick = refitPick(pick, swaps, slotId, refitLines);
        heroPatches.push({ id: pick.id, block: pick.block, assets: pick.assets, source: slotId });
        for (const copy of pick.assetCopies) {
          if (!('to' in copy)) continue;
          const to = normalizeAssetPath(copy.to);
          if (underAny(normalizeAssetPath(copy.from), gemOwn)) ownTo.add(to.endsWith('_c') ? to : `${to}_c`);
        }
        sounds.push(...pick.sounds); voices.push(...pick.voices);
        portraits.push(...pick.portraits); sprites.push(...pick.sprites);
      } catch (err) {
        // the wearable is gone from this build, or the builder refuses it: the rest still goes in
        failed.push(`${slotId}: ${(err as Error)?.message || err}`);
      }
    }
    if (swapsOf.size) {
      // what was refitted, for when a wearable still sits wrong on an arcana's body
      try {
        const lines = [...[...swapsOf].map(([slotId, m]) => `${slotId}: lists ${m.size} model swaps`), '', ...(refitLines.length ? refitLines : ['no worn item was refitted: none of the swaps names a worn item\'s model'])];
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'refit-report.txt'), lines.join('\n'));
      } catch { /* only a help */ }
    }
    if (heroPatches.length) {
      // Two picks rewrite the same soundevents file, portrait settings and sprite sheet, and the
      // pak keeps the first file of a path it is given: so they go into one copy, ahead of the rest.
      const first = heroPatches[0];
      let soundFiles: VpkEntry[] = [], portraitFiles: VpkEntry[] = [];
      try { soundFiles = soundEntries(gamePath, sounds, voices); }
      catch (err) { failed.push(`sounds: ${(err as Error)?.message || err}`); }
      try { portraitFiles = portraitEntries(gamePath, portraits, sprites); }
      catch (err) { failed.push(`portraits: ${(err as Error)?.message || err}`); }
      first.assets = [...soundFiles, ...portraitFiles, ...(first.assets || [])];
      patches.push(...heroPatches);
    }
    let beneath: VpkEntry[] = [];
    if (s.gem && Object.entries(s.items).some(([slotId, rec]) => wearsGem(slotId, rec))) {
      try {
        const g = gemOverlay(s.gem, base.stamp, heroPatches, ownTo);
        beneath = g.beneath;
        failed.push(...g.failed);
      } catch (err) { failed.push(`gem: ${(err as Error)?.message || err}`); }
    }

    // ability icons: Valve's own pictures under the abilities' plain paths. They go first, so they win over
    // the same ability's picture that a worn item brings; with no item patch at all they ride beneath.
    const icons = s.icons ?? {};
    let iconFiles: VpkEntry[] = [];
    try { iconFiles = itemBuilder.gameAssetEntries(gamePath, iconCopies(icons)); }
    catch (err) { failed.push(`icons: ${(err as Error)?.message || err}`); }
    if (iconFiles.length) {
      if (patches.length) patches[0].assets = [...iconFiles, ...(patches[0].assets || [])];
      else beneath = [...beneath, ...iconFiles];
    }

    // the emblem: the selection ring with its particle, under the plain path (only the player's own client draws it)
    let ringFiles: VpkEntry[] = [];
    if (ringEffect) {
      try { ringFiles = ringEmblemEntries(ringEffect); }
      catch (err) { failed.push(`emblem: ${(err as Error)?.message || err}`); }
    }
    if (ringFiles.length) beneath = [...beneath, ...ringFiles];
    if (attackPackFiles.length) beneath = [...beneath, ...attackPackFiles];

    // a worn pick on a slot with no stock model shows as ERROR after a reconnect: make that invisible
    if (Object.keys(s.items).some((id) => offered.find((x) => x.slot === id)?.bare)) {
      try { beneath = [...beneath, ...errorStockEntries()]; }
      catch (err) { failed.push(`error-stock: ${(err as Error)?.message || err}`); }
    }

    cleanOldFolders();
    if (!patches.length && !iconFiles.length && !ringFiles.length && !attackPackFiles.length) {
      // nothing worn: the game's files go back as they were
      schema.undeploy({ gamePath, folder: folder() });
      if (patcher.state(gamePath, folder()).patched) patcher.revert({ gamePath, folder: folder(), backupDir });
      save({ ...cur, stamp: null, folder: null, applied: appliedNow });
      return { deployed: false, applied: 0, missing: [], failed };
    }
    ensurePatch();
    const res = schema.deploy({ gamePath, folder: folder(), patches, base, beneath });
    save({ ...cur, stamp: base.stamp, folder: folder() , applied: appliedNow });
    return { deployed: true, applied: res.applied.length, missing: res.missing, failed };
  }

  /** A pick only changes the saved choices: no file of the game is touched until apply(). */
  function staged() {
    return { deployed: schema.isDeployed(gamePath, folder()), applied: 0, missing: [] as string[], failed: [] as string[] };
  }

  /** «Применить косметику»: build the pak from everything picked so far (or take it out when nothing is worn). */
  function apply() {
    guard();
    return rebuild();
  }

  /** Put the patch (gameinfo line + signature) in, or repair it after a Dota update. Idempotent. */
  function ensurePatch(): boolean {
    ensureModFolder(gamePath, folder());
    const st = patcher.state(gamePath, folder());
    if (st.patched && !st.outdated && !(st.signable && !st.signed)) return false;
    patcher.apply({ gamePath, folder: folder(), backupDir });
    return true;
  }

  /** Slots that have a free base item and something to put on it, read from the installed game. */
  function slots(): CosmeticSlotInfo[] {
    const { text } = schema.readGameSchema(gamePath);
    const picks = load().picks;
    const out: CosmeticSlotInfo[] = [];
    const seen = new Set<string>();
    for (const base of schema.listItems(text).filter((i) => i.baseitem)) {
      const slot = base.slot || base.prefab || '';
      if (!slot || seen.has(slot)) continue;
      seen.add(slot);
      const options = schema.cosmeticOptions(text, slot);
      if (options.length) out.push({ slot, base: base.id, picked: picks[slot] ?? null, options });
    }
    return out;
  }

  /** stock-report.txt in the data folder: every stock item of the heroes that wear something, with its slot and model. */
  function writeStockReport(text: string, heroIds: string[]): void {
    const all = schema.listItems(text);
    const lines: string[] = [`stamp ${schema.readGameSchema(gamePath).stamp}`, ''];
    for (const hero of heroIds) {
      const mine = all.filter((i) => i.prefab === 'default_item' && itemHeroesOf(text, i).includes(`npc_dota_hero_${hero}`) || (i.prefab === 'default_item' && itemHeroesOf(text, i).includes(hero)));
      lines.push(`== ${hero}: ${mine.length} stock items ==`);
      for (const i of mine.slice(0, 80)) {
        const f = schema.itemFields(text, i);
        lines.push(`#${i.id} slot=${f.get('item_slot') ?? '(none)'} model=${i.model || '(none)'} name=${schema.toUtf8(i.name)} heroes=${itemHeroesOf(text, i).join(',')}`);
      }
      lines.push('');
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'stock-report.txt'), lines.join('\n'));
  }
  const itemHeroesOf = (text: string, i: { start: number }) => itemBuilder.heroesOfItem(text, i);

  /** emblems-report.txt in the data folder: how emblems and their slot-mates are written in this game's table. */
  function writeEmblemReport(text: string, slotIds: string[]): void {
    const all = schema.listItems(text);
    const lines: string[] = [`stamp ${schema.readGameSchema(gamePath).stamp}`, `slots with emblems: ${slotIds.join(', ') || '(none)'}`, ''];
    const dump = (i: (typeof all)[number]) => {
      const f = schema.itemFields(text, i);
      return `#${i.id} baseitem=${i.baseitem} visuals=${i.hasVisuals} | ${[...f].filter(([k]) => k !== 'image_inventory' || true).map(([k, v]) => `${k}=${schema.toUtf8(v)}`).join('; ')}`;
    };
    const emblemItems = all.filter((i) => /emblem/.test(schema.itemSearchText(i)));
    lines.push(`== items mentioning emblem (${emblemItems.length}) ==`);
    for (const i of emblemItems.slice(0, 60)) {
      lines.push(dump(i));
      for (const m of emblemModifiers(text, i.id)) lines.push(`    ${m}`);
    }
    for (const slot of slotIds) {
      const mates = all.filter((i) => (i.slot || i.prefab) === slot);
      lines.push('', `== all ${mates.length} items of slot/prefab "${slot}" (first 40; base items first) ==`);
      for (const i of [...mates].sort((a, b) => Number(b.baseitem) - Number(a.baseitem)).slice(0, 40)) lines.push(dump(i));
    }
    const defaults = all.filter((i) => i.baseitem && /emblem|diretide|badge|tribute/.test(schema.itemSearchText(i)));
    lines.push('', `== base items mentioning emblem/diretide/badge/tribute (${defaults.length}) ==`);
    for (const i of defaults.slice(0, 20)) lines.push(dump(i));
    // the attack particles the game itself ships (particles/econ/attack/attack_modifier_*): the items table does not link them to emblems
    try {
      const ix = sharedVpkIndex(path.join(gamePath, 'dota', 'pak01_dir.vpk'));
      const atk = [...ix.paths()].filter((x) => /^particles\/econ\/attack\/attack_modifier/i.test(x)).sort();
      lines.push('', `== game attack-modifier particles (${atk.length}) ==`, ...atk);
    } catch { /* the report is only a help */ }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'emblems-report.txt'), lines.join('\n'));
  }

  /** Emblems (Diretide and the like): found by name in the installed game, grouped by the slot they sit in.
   *  `base` is the slot's free item; without one there is nothing to put the look on. */
  function emblems(): CosmeticSlotInfo[] {
    const { text } = schema.readGameSchema(gamePath);
    const picks = load().picks;
    const groups = new Map<string, { id: string; name: string; attack: boolean }[]>();
    for (const i of schema.listItems(text)) {
      if (i.baseitem || !i.hasVisuals || !i.name) continue;
      if (!/emblem/.test(schema.itemSearchText(i))) continue;
      if (!emblemParticle(text, i.id)) continue; // nothing to hang on the ring
      const slot = i.slot || i.prefab || '';
      if (!slot) continue;
      const list = groups.get(slot) ?? [];
      list.push({ id: i.id, name: schema.toUtf8(i.name), attack: hasAttackEffect(schema.toUtf8(i.name)) || !!emblemAttackPatch(text, i.id) });
      groups.set(slot, list);
    }
    try { writeEmblemReport(text, [...groups.keys()]); } catch { /* the report is only a help */ }
    return [...groups].map(([slot, options]) => ({
      slot, base: schema.baseItemFor(text, slot)?.id ?? (slot === EMBLEM_SLOT ? 'self' : ''), picked: picks[slot] ?? null,
      options: options.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  /** Put an emblem on its slot, or clear it with null. Refuses when the slot has no free base item. */
  function pickEmblem(slot: string, itemId: string | null) {
    const group = emblems().find((g) => g.slot === slot);
    if (!group) throw new Error('Эмблемы не найдены в этой версии игры.');
    if (itemId !== null && !group.base) throw new Error('У этого слота нет бесплатного базового предмета: заменить нечего.');
    if (itemId !== null && !group.options.some((o) => o.id === String(itemId))) throw new Error('Эта эмблема не подходит к слоту.');
    return pick(slot, itemId);
  }

  /** Effects on a free-cosmetic slot that takes them (the courier); an empty list takes them off. */
  function setSlotFx(slot: string, effectIds: string | string[]) {
    if (!FX_SLOTS.has(slot)) throw new Error('На этот слот эффекты не вешаются.');
    const s = load();
    const key = itemBuilder.effectKey(effectIds);
    const fx = { ...(s.fx ?? {}) };
    if (key) fx[slot] = key; else delete fx[slot];
    save({ ...s, fx });
    return staged();
  }

  /** Put an item on a slot, or clear the slot with null. */
  function pick(slot: string, itemId: string | null) {
    const s = load();
    const picks = { ...s.picks };
    // effects belong to the item they were put on: another item (or the default) starts without them
    const fx = { ...(s.fx ?? {}) };
    if (FX_SLOTS.has(slot) && (itemId === null ? picks[slot] !== undefined : picks[slot] !== String(itemId))) delete fx[slot];
    if (itemId === null) delete picks[slot]; else picks[slot] = String(itemId);
    save({ ...s, picks, fx });
    return staged();
  }

  /** An item (or the default, with null) and its effects on a slot that takes them, in one write. */
  function pickFx(slot: string, itemId: string | null, effectIds: string | string[]) {
    if (!FX_SLOTS.has(slot)) throw new Error('На этот слот эффекты не вешаются.');
    const s = load();
    const picks = { ...s.picks };
    if (itemId === null) delete picks[slot]; else picks[slot] = String(itemId);
    const key = itemBuilder.effectKey(effectIds);
    const fx = { ...(s.fx ?? {}) };
    if (key) fx[slot] = key; else delete fx[slot];
    save({ ...s, picks, fx });
    return staged();
  }

  // ---------- hero items ----------

  /* What the builder offers, read once per game build: itemSlots walks all 26 000 items (~0.5 s). */
  let offer: { stamp: string; slots: ItemSlot[]; sets: ItemSet[] } | null = null;
  function builderOffer() {
    const base = schema.readGameSchema(gamePath);
    if (!offer || offer.stamp !== base.stamp) {
      const slots = itemSlots(base.text);
      offer = { stamp: base.stamp, slots, sets: itemSets(base.text, slots) };
    }
    return offer;
  }

  const heroOf = (id: string) => (slot: { heroIds: string[] }) => slot.heroIds.includes(id);

  /** Every hero the builder can dress, for the grid: how many slots it has, how many carry a pick, how many sets fit. */
  function heroes(): HeroSummary[] {
    const { slots, sets } = builderOffer();
    const items = load().items;
    const byHero = new Map<string, HeroSummary>();
    for (const slot of slots) {
      for (const id of slot.heroIds) {
        const h = byHero.get(id) || { id, name: heroDisplayName(id), slots: 0, picked: 0, sets: 0 };
        h.slots++;
        if (items[slot.slot]) h.picked++;
        byHero.set(id, h);
      }
    }
    for (const set of sets) for (const id of set.heroIds) { const h = byHero.get(id); if (h) h.sets++; }
    return [...byHero.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One hero's slots with their wearables, and the sets that fit it. */
  function heroSlots(heroId: string): { slots: HeroSlotInfo[]; sets: ItemSet[] } {
    const { slots, sets } = builderOffer();
    const items = load().items;
    return {
      slots: slots.filter(heroOf(heroId)).map(({ kind: _kind, ...slot }) => ({ ...slot, picked: items[slot.slot] ?? null })),
      sets: sets.filter(heroOf(heroId)),
    };
  }

  /** The effects that can go on top of a pick ('' is none). */
  function effects() { return itemBuilder.itemEffects(); }

  /** Put a wearable on a hero's slot, with effects, or clear the slot with null. */
  function pickItem(slotId: string, itemId: string | null, effectIds: string | string[] = []) {
    const s = load();
    const slot = builderOffer().slots.find((x) => x.slot === slotId);
    if (!slot) throw new Error(`Слот ${slotId} не найден в этой версии игры.`);
    const items = { ...s.items };
    if (itemId === null) delete items[slotId];
    else {
      if (!slot.options.some((o) => o.id === String(itemId))) throw new Error('Этот предмет не подходит к слоту.');
      items[slotId] = { itemId: String(itemId), effects: itemBuilder.effectKey(effectIds) };
    }
    save({ ...s, items });
    return staged();
  }

  /** Put every piece of a set that has a slot on the hero, in one write. */
  function pickSet(setId: string) {
    const s = load();
    const set = builderOffer().sets.find((x) => x.id === String(setId));
    if (!set) throw new Error('Набор не найден в этой версии игры.');
    const items = { ...s.items };
    for (const piece of set.pieces) if (piece.fits) items[piece.slot] = { itemId: piece.itemId, effects: '' };
    save({ ...s, items });
    return staged();
  }

  /** Take every pick off one hero (the stock items come back). */
  function resetHero(heroId: string) {
    const s = load();
    const ids = new Set(builderOffer().slots.filter(heroOf(heroId)).map((x) => x.slot));
    const items = Object.fromEntries(Object.entries(s.items).filter(([slot]) => !ids.has(slot)));
    save({ ...s, items });
    return staged();
  }

  /** Terrorblade's gem in a colour, or null for the arcana as the game makes it. */
  function setGem(color: unknown) {
    const s = load();
    const gem = color === null ? null : validGem(color);
    if (color !== null && !gem) throw new Error('Не тот цвет: нужны три числа от 0 до 255.');
    save({ ...s, gem });
    return staged();
  }

  /** Take everything off at once: free cosmetics and every hero's items. The gem colour is kept for next time. */
  function clearAll() {
    const s = load();
    save({ ...s, picks: {}, items: {}, icons: {}, fx: {} });
    return staged();
  }

  // ---------- ability icons ----------

  let iconCatalog: { stamp: string; heroes: HeroIcons[] } | null = null;
  /** Every hero's abilities that have more than one picture in this build (read once per build of the game). */
  function abilityIcons(): HeroIcons[] {
    const base = schema.readGameSchema(gamePath);
    if (!iconCatalog || iconCatalog.stamp !== base.stamp) iconCatalog = { stamp: base.stamp, heroes: abilityIconCatalog(gamePath, base.text) };
    return iconCatalog.heroes;
  }

  /** Make an ability show one of its pictures, or null for its own. */
  function setAbilityIcon(ability: string, icon: string | null) {
    const s = load();
    const a = String(ability);
    const found = abilityIcons().flatMap((h) => h.abilities).find((x) => x.ability === a);
    if (!found) throw new Error('Для этой способности нет других иконок в этой версии игры.');
    const icons = { ...(s.icons ?? {}) };
    if (icon === null || icon === a) delete icons[a];
    else {
      if (!found.variants.some((v) => v.icon === String(icon))) throw new Error('Эта иконка не подходит к способности.');
      icons[a] = String(icon);
    }
    save({ ...s, icons });
    return staged();
  }

  /** After a Dota update: put the patch back and rebuild the table. Safe to call on every start. */
  function heal(): { healed: string[] } {
    const s = load();
    const was = s.applied!; // what the game was last built from: picks made since stay unbuilt until apply()
    const healed: string[] = [];
    // nothing built: nothing of ours in the game, nothing to repair
    if (!Object.keys(was.picks).length && !Object.keys(was.items).length && !Object.keys(was.icons).length && !Object.keys(was.fx).length) return { healed };
    guard();
    if (ensurePatch()) healed.push('patch');
    if (s.stamp !== schema.readGameSchema(gamePath).stamp || !schema.isDeployed(gamePath, folder())) {
      rebuild(was);
      healed.push('schema');
    }
    return { healed };
  }

  /** Everything worn now, named, for the "Надето" window: free cosmetics, hero items by hero, the gem. */
  function equipped() {
    const s = load();
    const base = schema.readGameSchema(gamePath);
    const free = Object.entries(s.picks).map(([slot, itemId]) => ({
      slot, itemId: String(itemId),
      name: schema.cosmeticOptions(base.text, slot).find((o) => o.id === String(itemId))?.name ?? null,
    }));
    const offered = builderOffer().slots;
    const heroItems = Object.entries(s.items).map(([slotId, rec]) => {
      const sl = offered.find((x) => x.slot === slotId);
      const opt = sl?.options.find((o) => o.id === String(rec.itemId));
      const hero = sl?.heroIds[0] ?? slotId.split(':')[1] ?? '';
      return {
        slot: slotId, hero, heroName: heroDisplayName(hero), slotLabel: sl?.slotLabel ?? slotId, icon: sl?.icon ?? 'auto_awesome',
        itemId: String(rec.itemId), name: opt?.name ?? null, effects: rec.effects,
        styled: !!(opt && opt.styles && opt.styles.length > 1),
        gem: wearsGem(slotId, rec) ? s.gem : undefined,
      };
    }).sort((a, b) => a.heroName.localeCompare(b.heroName) || a.slotLabel.localeCompare(b.slotLabel));
    const catalog = Object.keys(s.icons ?? {}).length ? abilityIcons() : [];
    const abilityPicks = Object.entries(s.icons ?? {}).map(([ability, icon]) => {
      const hero = catalog.find((h) => h.abilities.some((a) => a.ability === ability));
      const ab = hero?.abilities.find((a) => a.ability === ability);
      return { ability, icon, name: ab?.name ?? ability, hero: hero?.hero ?? '', heroName: hero?.name ?? '', label: ab?.variants.find((v) => v.icon === icon)?.label ?? '' };
    }).sort((a, b) => a.heroName.localeCompare(b.heroName) || a.name.localeCompare(b.name));
    return { free, heroItems, abilityPicks };
  }

  function state(): CosmeticsState {
    const s = load();
    const st = patcher.state(gamePath, folder());
    return {
      patched: st.patched, signed: st.signed, signable: st.signable,
      outdated: st.outdated, foreign: st.foreign, deployed: schema.isDeployed(gamePath, folder()), pending: !sameSnap(snap(s), s.applied!), picks: s.picks, items: s.items, icons: s.icons ?? {}, fx: s.fx ?? {}, gem: s.gem ?? null,
    };
  }

  return { abilityIcons, setAbilityIcon, clearAll, apply, equipped, slots, emblems, pickEmblem, setSlotFx, pickFx, pick, heal, state, rebuild, heroes, heroSlots, effects, pickItem, pickSet, resetHero, setGem };
}
