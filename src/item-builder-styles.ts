/**
 * An item's styles in the item builder: which ones it has, and its visuals with one of them made
 * its only one.
 *
 * A worn item is in a style the player chose in the game, and its visuals carry every style at
 * once: an entry marked "style" "1" applies in the second one only, and the style's own block says
 * which material the model takes ("skin") and sometimes another model. A stock item is in its first
 * style and nobody can choose another, so a pick in style N is written as an item whose only style
 * is N's, under the number 0: its entries marked N relabelled 0, every other style's taken out.
 * The game then shows the item in it, and the files the build copies (src/item-builder-assets.ts)
 * are that style's. The first style is the item as the builder always wrote it.
 */
import { blockBounds, eachChild, type KvChild } from './schema.ts';

const MODIFIER = /^asset_modifier\d*$/i;
/** What a style holds that only means something to its owner: what unlocks it, what it cost. */
const OWNER_ONLY = new Set(['unlock', 'item_def', 'price', 'auto_style_rule', 'auto_style_reason']);

function stylesBlock(visuals: string): KvChild | null {
  let hit: KvChild | null = null;
  eachChild(visuals, blockBounds(visuals, 0), (c) => { if (!hit && c.isBlock && c.key.toLowerCase() === 'styles') hit = c; });
  return hit;
}

/** The name token of each of an item's styles, in their order ("#DOTA_Style_..."); [] for an item with one look. */
export function styleTokens(visuals: string | null): string[] {
  const block = visuals ? stylesBlock(visuals) : null;
  if (!block) return [];
  const out: string[] = [];
  eachChild(visuals!, block.body!, (s) => {
    if (!s.isBlock || !/^\d+$/.test(s.key)) return;
    let name = '';
    eachChild(visuals!, s.body!, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'name') name = f.value ?? ''; });
    out[Number(s.key)] = name;
  });
  return out.length > 1 ? Array.from(out, (n) => n || '') : [];
}

/** A pick's style out of its options' key (src/item-builder.ts effectKey): "style-2" is 2, none is 0. */
export const styleOf = (key: string): number => Number(/(?:^|,)style-(\d+)(?:,|$)/.exec(key)?.[1] || 0);

/**
 * The visuals with style `style` made the item's only one, and the model that style puts on the
 * item instead of its own (null: its own). Style 0, or a style the item has not got, leaves the
 * visuals as they are (`applied` false): the builder strips the styles, which leaves the item in
 * its first.
 */
export function withStyle(visuals: string, style: number): { visuals: string; model: string | null; applied: boolean } {
  const block = stylesBlock(visuals);
  let own: KvChild | null = null;
  if (block && style > 0) eachChild(visuals, block.body!, (s) => { if (s.isBlock && s.key === String(style)) own = s; });
  if (!block || !own) return { visuals, model: null, applied: false };
  const chosen = own as KvChild;
  const fields: string[] = [];
  let model: string | null = null;
  eachChild(visuals, chosen.body!, (f) => {
    if (OWNER_ONLY.has(f.key.toLowerCase())) return;
    if (!f.isBlock && f.key.toLowerCase() === 'model_player') model = f.value ?? null;
    fields.push(visuals.slice(f.start, f.end));
  });
  const cuts: { start: number; end: number; text: string }[] = [
    { start: block.start, end: block.end, text: `"styles"\r\n{\r\n"0"\r\n{\r\n${fields.join('\r\n')}\r\n}\r\n}` },
  ];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !MODIFIER.test(c.key)) return;
    let at: string | null = null;
    eachChild(visuals, c.body!, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'style') at = f.value ?? ''; });
    if (at === null) return;
    const text = visuals.slice(c.start, c.end);
    if (at === String(style)) cuts.push({ start: c.start, end: c.end, text: text.replace(/("style"\s+")\d+(")/i, '$10$2') });
    else cuts.push({ start: c.start - (/[ \t]*\r?\n[ \t]*$/.exec(visuals.slice(0, c.start))?.[0].length ?? 0), end: c.end, text: '' }); // its line too
  });
  let out = visuals;
  for (const cut of cuts.sort((a, b) => b.start - a.start)) out = out.slice(0, cut.start) + cut.text + out.slice(cut.end);
  return { visuals: out, model, applied: true };
}
