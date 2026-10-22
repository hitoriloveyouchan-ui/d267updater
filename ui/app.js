// The window. Plain JS, no build step: it only talks to window.api (preload.cjs).
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.api;
  const META = new Map(window.SLOTS.map(([id, label, icon], i) => [id, { label, icon, order: i }]));
  const meta = (slot) => META.get(slot) || { label: slot.replace(/_/g, ' '), icon: 'auto_awesome', order: 1000 };

  const S = {
    connected: false, gameRunning: false, pending: false, applying: false, picks: {}, slots: null, loading: false, current: null, query: '',
    // hero items: the view (a slot of the free cosmetics, or the heroes), the grid, one hero's data, the picks
    why: new Map(), tab: 'cos', eq: null, eqLoading: false, pics: new Map(), tool: null, toolBusy: false, set: null,
    view: 'slot', emblems: null, emblemsLoading: false, slotFx: {}, effects: [], items: {}, icons: {}, spells: null, spellsLoading: false, spellHero: null, gem: null, heroes: null, heroLoading: false, hero: null, heroData: null, heroSlot: null, fx: new Set(), setsOpen: false,
  };

  // replaceChildren(null) writes the text "null" into the page (it was showing under «Иконки способностей»):
  // skip empty kids the way h() does, for every call in this file
  {
    const rc = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...kids) { return rc.apply(this, kids.flat().filter((k) => k != null && k !== false)); };
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM: setAttribute('style') is blocked by the page's CSP
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }
  const icon = (name) => h('span', { class: 'mi', text: name });

  let toastTimer;
  function toast(msg, err = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, err ? 6000 : 2600);
  }

  /** Every IPC answer is { ok, ... }; an error becomes a toast and null. */
  async function call(fn, ...args) {
    const r = await fn(...args);
    if (!r || !r.ok) { toast((r && r.error) || 'Что-то пошло не так', true); return null; }
    return r;
  }

  const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
  const tint = (s) => `linear-gradient(135deg, hsl(${200 + hue(s) % 40} 52% 26%), hsl(${215 + (hue(s) + 50) % 35} 56% 14%))`;

  // ---------- pictures from the player's own game ----------
  // A tile draws its colour at once and an <img> that fades in when the picture arrives; the
  // pictures are asked for in batches after each paint. No picture (no game file, tool not
  // downloaded) just leaves the colour.
  const pic = (kind, id) => h('img', { class: 'pic', alt: '', 'data-kind': kind, 'data-id': id, draggable: 'false' });
  let picGen = 0;
  async function fillPics(roots) {
    roots = Array.isArray(roots) ? roots : [roots];
    const imgsOf = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
    const gen = ++picGen;
    const need = { item: [], hero: [], spell: [] };
    for (const img of imgsOf('img.pic')) {
      const key = img.dataset.kind + ':' + img.dataset.id;
      const hit = S.pics.get(key);
      if (hit) { img.src = hit; img.classList.add('on'); }
      else if (hit === undefined) need[img.dataset.kind].push(img.dataset.id);
    }
    const run = async (kind, ids, fn, size) => {
      ids = [...new Set(ids)];
      for (let i = 0; i < ids.length; i += size) {
        const chunk = ids.slice(i, i + size);
        const r = await fn(chunk);
        const got = (r && r.ok && r.pictures) || {};
        const why = (r && r.ok && r.reasons) || {};
        for (const id of chunk) { S.pics.set(kind + ':' + id, got[id] || null); if (!got[id] && why[id]) S.why.set(kind + ':' + id, why[id]); }
        if (gen !== picGen) return; // the tiles were replaced meanwhile
        for (const img of imgsOf(`img.pic[data-kind="${kind}"]`)) {
          const uri = S.pics.get(kind + ':' + img.dataset.id);
          if (uri && !img.src) { img.src = uri; img.classList.add('on'); }
          // no picture: the tile says why (hover) instead of staying an unexplained empty square
          else if (!uri && S.why.has(kind + ':' + img.dataset.id) && img.parentElement && !img.parentElement.dataset.why) {
            const t = img.parentElement; t.dataset.why = '1';
            t.title = (t.title ? t.title + '\n' : '') + 'Нет картинки: ' + S.why.get(kind + ':' + img.dataset.id);
          }
        }
      }
    };
    await Promise.all([run('item', need.item, api.iconsItems, 24), run('hero', need.hero, api.iconsHeroes, 60), run('spell', need.spell, api.iconsSpells, 40)]);
  }

  function applyState(state, running) {
    if (state) { S.pending = !!state.pending; S.picks = state.picks || {}; S.items = state.items || {}; S.icons = state.icons || {}; S.gem = state.gem || null; S.slotFx = state.fx || {}; }
    if (typeof running === 'boolean') S.gameRunning = running;
    renderBar(); renderEqTab();
  }

  function renderBar() {
    const dot = $('dot'), txt = $('statusText');
    if (!S.connected) { dot.className = 'dot bad'; txt.textContent = 'Dota 2 не найдена'; }
    else if (S.pending) { dot.className = 'dot warn'; txt.textContent = S.gameRunning ? 'Есть неприменённые изменения: закрой Dota 2 и нажми «Применить косметику»' : 'Есть неприменённые изменения'; }
    else if (S.gameRunning) { dot.className = 'dot warn'; txt.textContent = 'Dota 2 запущена: закрой её, чтобы менять косметику'; }
    else { dot.className = 'dot ok'; txt.textContent = 'Dota 2 подключена'; }
    const ab = $('applyBtn');
    ab.disabled = !S.connected || S.applying || !S.pending;
    ab.classList.toggle('pending', S.connected && S.pending && !S.applying);
    $('applyLabel').textContent = S.applying ? 'Применяю…' : 'Применить косметику';
    $('playBtn').disabled = !S.connected;
    $('folderBtn').disabled = !S.connected;
  }

  function renderRail() {
    const rail = $('rail');
    rail.hidden = S.tab !== 'cos';
    if (S.tab !== 'cos') return;
    rail.replaceChildren(h('div', { class: 'rail-label', text: 'Косметика' }));
    if (!S.connected) return;
    // «Эмблемы», «Предметы» and «Иконки способностей» sit at the very top, above the free-cosmetic slots
    rail.append(h('button', { class: 'rail-item' + (S.view === 'emblems' ? ' active' : ''), type: 'button', onclick: openEmblems },
      icon('military_tech'), h('span', { class: 'grow', text: 'Эмблемы' }),
      (S.emblems || []).some((g) => S.picks[g.slot]) ? h('i', { class: 'rail-dot', title: 'Выбрано' }) : null));
    rail.append(h('button', { class: 'rail-item' + (S.view === 'heroes' ? ' active' : ''), type: 'button', onclick: openHeroes },
      icon('accessibility_new'), h('span', { class: 'grow', text: 'Предметы' }),
      Object.keys(S.items).length ? h('i', { class: 'rail-dot', title: 'Есть выбранные предметы' }) : null));
    rail.append(h('button', { class: 'rail-item' + (S.view === 'spells' ? ' active' : ''), type: 'button', onclick: openSpells },
      icon('stars'), h('span', { class: 'grow', text: 'Иконки способностей' }),
      Object.keys(S.icons).length ? h('i', { class: 'rail-dot', title: 'Есть выбранные иконки' }) : null));
    if (S.loading) { rail.append(h('div', { class: 'rail-hint', text: 'Читаю таблицу предметов игры…' })); return; }
    const emblemSlots = new Set((S.emblems || []).map((g) => g.slot));
    for (const s of S.slots || []) {
      if (emblemSlots.has(s.slot)) continue; // shown under «Эмблемы»
      const m = meta(s.slot);
      rail.append(h('button', {
        class: 'rail-item' + (S.view === 'slot' && S.current === s.slot ? ' active' : ''), type: 'button',
        onclick: () => { S.view = 'slot'; S.current = s.slot; S.query = ''; $('search').value = ''; renderRail(); renderContent(); },
      }, icon(m.icon), h('span', { class: 'grow', text: m.label }), S.picks[s.slot] ? h('i', { class: 'rail-dot', title: 'Выбрано' }) : null));
    }
  }

  // The entrance animation plays when the screen changes (another tab, category, hero) or when the content arrives
  // after a loader, not on every redraw: a pick redraws the grid and the cards must not jump again.
  let lastViewKey = '', lastWasEmpty = false, enterTimer = 0;
  const viewKey = () => { const id = (v) => (v && typeof v === 'object' ? (v.id ?? v.hero ?? v.slot ?? '') : (v ?? '')); return [S.tab, S.view, S.current, id(S.hero), id(S.spellHero), id(S.heroSlot)].join('|'); };
  function playEnter(c) {
    clearTimeout(enterTimer);
    c.classList.remove('enter'); void c.offsetWidth; c.classList.add('enter');
    enterTimer = setTimeout(() => c.classList.remove('enter'), 900);
  }
  function renderContent() {
    const c = $('content');
    const key = viewKey();
    const changed = key !== lastViewKey;
    lastViewKey = key;
    if (changed) playEnter(c);
    renderContentInner(c);
    const empty = !!(c.firstElementChild && c.firstElementChild.classList.contains('empty'));
    if (!changed && lastWasEmpty && !empty) playEnter(c);
    lastWasEmpty = empty;
    if (!(S.tab === 'cos' && S.view === 'heroes' && S.hero)) renderPicker();
    if (S.tab === 'cos') fillPics([c, $('pickerHost')]);
  }

  /* The brush on a card: a round button that shows when the card is hovered and opens a small menu of
   * effects for that one item. `apply(ids)` puts the item on with those effects and answers false when
   * it did not go in. The menu stays open (it lives on the page, not in the grid that is redrawn). */
  /* The effects in the order the picker shows them, each with a picture of what it does (ui/img/fx).
   * An effect with no picture (one the game adds) gets an icon tile. */
  const FX_ORDER = ['fire', 'lightnings', 'frostbloom', 'bubbles', 'snow', 'sand-storm', 'ghost'];
  const FX_PICS = new Set(FX_ORDER);
  const fxSorted = (list) => {
    const all = list.filter((e) => e.id);
    const at = (id) => { const i = FX_ORDER.indexOf(id); return i < 0 ? FX_ORDER.length : i; };
    return all.map((e, i) => ({ e, i })).sort((a, b) => at(a.e.id) - at(b.e.id) || a.i - b.i).map((x) => x.e);
  };
  function fxThumb(id) {
    if (!FX_PICS.has(id)) return h('span', { class: 'fxnone' }, icon(id === 'sand-storm' ? 'air' : 'auto_awesome'));
    const img = h('img', { class: 'fxpic', src: `img/fx/${id}.jpg`, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(h('span', { class: 'fxnone' }, icon('auto_awesome'))));
    return img;
  }
  let fxMenuEl = null;
  function closeFxMenu() {
    if (fxMenuEl) { fxMenuEl.remove(); fxMenuEl = null; }
    document.removeEventListener('keydown', fxEsc, true);
  }
  function fxEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeFxMenu(); } }
  /* The effects window: a dialog in the middle of the screen over a dimmed backdrop, with big picture tiles. */
  function openFxMenu(anchor, ids, apply, title) {
    closeFxMenu();
    let cur = [...ids];
    const menu = h('div', { class: 'overlay fxoverlay' });
    const box = h('div', { class: 'fxmenu', role: 'dialog', 'aria-modal': 'true' });
    menu.append(box); // the box is made once, so a pick redraws its content without replaying the pop-in
    const paint = () => box.replaceChildren(...[
      h('div', { class: 'fxmenu-head' },
        icon('brush'),
        h('span', { class: 'fxlabel', text: 'Эффекты' }),
        title && title !== 'null' ? h('span', { class: 'fxmenu-title', text: String(title) }) : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Закрыть', onclick: closeFxMenu }, icon('close'))),
      h('div', { class: 'fxgrid' }, ...fxSorted(S.effects).map((e) => {
        const on = cur.includes(e.id);
        return h('button', {
          class: 'fxtile' + (on ? ' active' : ''), type: 'button', title: e.name, 'aria-pressed': on ? 'true' : 'false',
          onclick: async () => {
            const next = on ? cur.filter((x) => x !== e.id) : [...cur, e.id];
            if (await apply(next) !== false) { cur = next; paint(); }
          },
        }, fxThumb(e.id), h('span', { class: 'fxname', text: e.name }), on ? h('span', { class: 'fxcheck' }, icon('check_circle')) : null);
      })),
      h('div', { class: 'fxmenu-foot' },
        cur.length ? h('button', { class: 'btn', type: 'button', onclick: async () => { if (await apply([]) !== false) { cur = []; paint(); } } }, 'Убрать все эффекты') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', type: 'button', onclick: closeFxMenu }, 'Готово')),
    ].filter(Boolean));
    paint();
    menu.addEventListener('mousedown', (e) => { if (e.target === menu) closeFxMenu(); });
    document.body.append(menu);
    fxMenuEl = menu;
    document.addEventListener('keydown', fxEsc, true);
  }
  /** A card with the brush on it: `on` when the item carries effects. */
  function withBrush(card, { on, ids, apply, title }) {
    const brush = h('button', {
      class: 'fxbrush' + (on ? ' on' : ''), type: 'button', title: 'Эффекты', 'aria-label': 'Эффекты',
      onclick: (e) => { e.stopPropagation(); openFxMenu(brush, ids, apply, title); },
    }, icon('brush'));
    return h('div', { class: 'cardwrap' }, card, brush);
  }

  function renderContentInner(c) {
    if (S.tab === 'set') { renderSettings(c); return; }
    if (S.tab === 'eq') { renderEquipped(c); return; }
    c.scrollTop = 0;
    if (!S.connected) {
      c.replaceChildren(h('div', { class: 'empty' }, icon('folder_off'),
        h('h2', { text: 'Dota 2 не найдена' }),
        h('p', { text: 'Укажи папку игры: …\\steamapps\\common\\dota 2 beta\\game' }),
        h('button', { class: 'btn primary', type: 'button', onclick: chooseGame, text: 'Выбрать папку' })));
      return;
    }
    if (S.view === 'heroes') { renderHeroes(c); return; }
    if (S.view === 'spells') { renderSpells(c); return; }
    if (S.view === 'emblems') { renderEmblems(c); return; }
    if (S.loading) { c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Читаю таблицу предметов…' }))); return; }
    const slot = (S.slots || []).find((s) => s.slot === S.current);
    if (!slot) { c.replaceChildren(h('div', { class: 'empty' }, icon('category'), h('h2', { text: 'Выбери категорию слева' }))); return; }

    const q = S.query.trim().toLowerCase();
    const opts = slot.options.filter((o) => !q || o.name.toLowerCase().includes(q));
    const m = meta(slot.slot);
    const picked = S.picks[slot.slot];
    const fxSlot = slot.slot === 'courier' && S.effects.length > 0;
    const fxIds = (S.slotFx[slot.slot] || '').split(',').filter(Boolean);
    /* The cards of the slot. A courier (the slot with effects) puts the worn one first, then the default. */
    const courierCards = () => {
      const fxTag = (o) => fxTags({ effects: S.slotFx[slot.slot] || '' }, S.effects, null);
      const cards = opts.map((o) => {
        const on = picked === o.id;
        const card = h('button', { class: 'card' + (on ? ' picked' : ''), type: 'button', title: o.name, onclick: () => pick(slot.slot, on ? null : o.id) },
          pic('item', o.id),
          on ? h('span', { class: 'badge' }, icon('check_circle'), 'Надето') : null,
          on && fxSlot ? fxTag(o) : null,
          h('div', { class: 'name', text: o.name }), h('div', { class: 'sub', text: m.label }));
        card.style.setProperty('--tint', tint(o.name));
        return { id: o.id, el: fxSlot ? withBrush(card, { on: on && fxIds.length > 0, ids: on ? fxIds : [], title: o.name, apply: (next) => pickFx(slot.slot, o.id, next) }) : card };
      });
      if (!fxSlot) return cards.map((x) => x.el);
      const lead = cards.filter((x) => x.id === picked).map((x) => x.el);
      const rest = cards.filter((x) => x.id !== picked).map((x) => x.el);
      const def = [];
      if (!q) {
        const on = !picked;
        const card = h('button', { class: 'card' + (on ? ' picked' : ''), type: 'button', title: 'Стандартный курьер', onclick: () => pick(slot.slot, null) },
          pic('item', slot.base),
          on ? h('span', { class: 'badge' }, icon('check_circle'), 'Надето') : null,
          on ? fxTag(null) : null,
          h('div', { class: 'name', text: 'Стандартный курьер' }), h('div', { class: 'sub', text: m.label }));
        card.style.setProperty('--tint', tint('default'));
        def.push(withBrush(card, { on: on && fxIds.length > 0, ids: on ? fxIds : [], title: 'Стандартный курьер', apply: (next) => pickFx(slot.slot, null, next) }));
      }
      return [...lead, ...def, ...rest];
    };
    c.replaceChildren(
      h('div', { class: 'head' },
        h('h1', { text: m.label }), h('span', { class: 'count', text: `${opts.length} из ${slot.options.length}` }), h('div', { class: 'line' }),
        picked ? h('button', { class: 'btn', type: 'button', onclick: () => pick(slot.slot, null), text: 'Сбросить на стандартный' }) : null),
      opts.length || (fxSlot && !q) ? h('div', { class: 'grid' }, courierCards()) : h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: 'Ничего не найдено' })));
  }


  // ---------- hero items («Предметы») ----------
  const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many}`;
  /** A pick's effects string ("fire,snow,style-2") as the effect ids and the style number. */
  const parsePick = (rec) => {
    const ids = rec ? rec.effects.split(',').filter(Boolean) : [];
    return { fx: ids.filter((x) => !/^style-\d+$/.test(x)), style: Number((ids.find((x) => /^style-\d+$/.test(x)) || '').slice(6)) || 0 };
  };
  const buildFx = (fx, style) => [...fx, ...(style ? [`style-${style}`] : [])];

  // ---------- emblems («Эмблемы») ----------
  function openEmblems() {
    S.view = 'emblems'; S.query = ''; $('search').value = '';
    renderRail(); renderContent();
    loadEmblems(); // read again: a VPK put in assets/emblem-attack since changes the marks
  }

  async function loadEmblems() {
    S.emblemsLoading = true; renderContent();
    const r = await call(api.emblems);
    S.emblemsLoading = false;
    S.emblems = r ? r.groups : [];
    renderRail(); renderContent();
  }

  async function pickEmblem(slot, itemId) {
    if (picking) return;
    picking = true;
    try {
      const r = await call(api.pickEmblem, slot, itemId);
      if (!r) return;
      applyState(r.state);
      S.eq = null;
      toast(itemId ? 'Эмблема выбрана. Нажми «Применить косметику».' : 'Эмблема сброшена. Нажми «Применить косметику».');
      renderRail(); renderContent();
    } finally { picking = false; }
  }

  function renderEmblems(c) {
    if (S.emblemsLoading || !S.emblems) { c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Ищу эмблемы…' }))); return; }
    if (!S.emblems.length) {
      c.replaceChildren(h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: 'Эмблемы не найдены' }),
        h('p', { text: 'В таблице предметов этой версии игры нет эмблем с внешним видом.' })));
      return;
    }
    const q = S.query.trim().toLowerCase();
    const kids = [];
    for (const g of S.emblems) {
      const opts = g.options.filter((o) => !q || o.name.toLowerCase().includes(q));
      if (!opts.length) continue;
      const picked = S.picks[g.slot];
      kids.push(h('div', { class: 'head' },
        h('h1', { text: 'Эмблемы' }), h('span', { class: 'count', text: `${opts.length} из ${g.options.length}` }), h('div', { class: 'line' }),
        picked ? h('button', { class: 'btn', type: 'button', onclick: () => pickEmblem(g.slot, null), text: 'Сбросить на стандартную' }) : null));
      kids.push(h('p', { class: 'rail-hint', text: 'Эффект атаки у эмблем с пометкой «эффект атаки» включается сам, когда ты их надеваешь. Эффект Diretide видят и другие игроки без своей эмблемы: файлом сделать его только своим нельзя.' }));
      if (!g.base) kids.push(h('p', { class: 'rail-hint', text: 'У этого слота нет бесплатного базового предмета, поэтому заменить эмблему не получится.' }));
      kids.push(h('div', { class: 'grid' }, opts.map((o) => {
        const on = picked === o.id;
        const card = h('button', { class: 'card' + (on ? ' picked' : ''), type: 'button', title: o.name, onclick: () => pickEmblem(g.slot, on ? null : o.id) },
          pic('item', o.id),
          on ? h('span', { class: 'badge' }, icon('check_circle'), 'Надето') : null,
          h('div', { class: 'name', text: o.name }), h('div', { class: 'sub', text: o.attack ? 'Эмблема · эффект атаки' : 'Эмблема · без эффекта атаки' }));
        card.style.setProperty('--tint', tint(o.name));
        return card;
      })));
    }
    c.replaceChildren(...(kids.length ? kids : [h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: 'Ничего не найдено' }))]));
  }

  // ---------- ability icons («Иконки способностей») ----------
  function openSpells() {
    S.view = 'spells'; S.spellHero = null; S.query = ''; $('search').value = '';
    renderRail(); renderContent();
  }

  async function loadSpells() {
    S.spellsLoading = true; renderContent();
    const r = await call(api.spellList);
    S.spellsLoading = false;
    S.spells = r ? r.heroes : [];
    renderContent();
  }

  async function spellPick(ability, iconName) {
    if (picking) return;
    picking = true;
    const keep = $('content').scrollTop;
    try {
      const r = await call(api.spellPick, ability, iconName);
      if (!r) return;
      applyState(r.state);
      S.eq = null;
      if (r.failed && r.failed.length) toast('Не вошло в сборку: ' + r.failed[0], true); else toast(iconName ? 'Иконка выбрана. Нажми «Применить косметику».' : 'Иконка сброшена. Нажми «Применить косметику».');
      renderRail(); renderContent();
      $('content').scrollTop = keep;
    } finally { picking = false; }
  }

  function renderSpells(c) {
    if (S.spellsLoading || !S.spells) {
      c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Читаю иконки способностей…' })));
      if (!S.spells && !S.spellsLoading) loadSpells();
      return;
    }
    const picked = (a) => S.icons[a.ability] || null;
    // Valve stores many of these pictures compressed: reading them needs the extra content from the settings
    const needTool = S.tool && S.tool.available && !S.tool.ready
      ? h('div', { class: 'notice' }, icon('image_not_supported'), h('div', {},
        h('b', { text: 'Картинок иконок может не быть' }),
        h('p', { text: 'Часть иконок Valve хранит сжатыми, и без дополнительного контента (Source 2 Viewer, около 50 МБ) их не прочитать: останутся только подписи. Выбор иконок при этом работает.' }),
        h('button', { class: 'btn sm primary', type: 'button', disabled: S.toolBusy, onclick: installTool }, icon('download'), 'Скачать'))) : null;
    if (!S.spellHero) {
      const q = S.query.trim().toLowerCase();
      const list = S.spells.filter((x) => !q || x.name.toLowerCase().includes(q));
      c.replaceChildren(
        h('div', { class: 'head' }, h('h1', { text: 'Иконки способностей' }), h('span', { class: 'count', text: `${list.length} из ${S.spells.length}` }), h('div', { class: 'line' })),
        needTool,
        list.length ? h('div', { class: 'grid heroes' }, list.map((x) => {
          const n = x.abilities.filter(picked).length;
          const card = h('button', { class: 'card hero' + (n ? ' picked' : ''), type: 'button', onclick: () => { S.spellHero = x.hero; renderContent(); } },
            pic('hero', x.hero),
            h('div', { class: 'name', text: x.name }),
            h('div', { class: 'sub', text: n ? `Изменено ${n} из ${x.abilities.length}` : plural(x.abilities.length, 'способность', 'способности', 'способностей') }));
          card.style.setProperty('--tint', tint(x.name));
          return card;
        })) : h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: S.spells.length ? 'Ничего не найдено' : 'У героев нет альтернативных иконок' })));
      return;
    }
    const hero = S.spells.find((x) => x.hero === S.spellHero);
    if (!hero) { S.spellHero = null; renderSpells(c); return; }
    const back = h('button', { class: 'btn', type: 'button', onclick: () => { S.spellHero = null; renderContent(); } }, icon('arrow_back'), 'Герои');
    const any = hero.abilities.some(picked);
    c.replaceChildren(
      h('div', { class: 'head' }, back, h('h1', { text: hero.name }), h('span', { class: 'count', text: plural(hero.abilities.length, 'способность', 'способности', 'способностей') }), h('div', { class: 'line' }),
        any ? h('button', { class: 'btn', type: 'button', onclick: async () => { for (const a of hero.abilities) if (picked(a)) await spellPick(a.ability, null); } }, 'Сбросить героя') : null),
      needTool,
      ...hero.abilities.map((a) => h('div', { class: 'abrow' },
        h('div', { class: 'abtitle' }, h('b', { text: a.name }), h('span', { class: 'count', text: a.ability })),
        h('div', { class: 'spellrow' }, a.variants.map((v) => {
          const on = (picked(a) || a.ability) === v.icon;
          return h('button', { class: 'spelltile' + (on ? ' on' : ''), type: 'button', title: v.label || 'Обычная иконка',
            onclick: () => spellPick(a.ability, v.icon === a.ability ? null : v.icon) },
            pic('spell', v.icon),
            on ? h('span', { class: 'spellmark' }, icon('check_circle')) : null,
            h('span', { class: 'spelllabel', text: v.label || 'Обычная' }));
        })))));
  }

  function openHeroes() {
    S.view = 'heroes'; S.hero = null; S.query = ''; $('search').value = '';
    renderRail(); renderContent(); // the grid asks for the heroes itself when it has none
  }

  async function loadHeroes() {
    S.heroLoading = true; renderContent();
    const r = await call(api.heroes);
    S.heroLoading = false;
    S.heroes = r ? r.heroes : [];
    renderContent();
  }

  async function openHero(id, name) {
    S.pickerOpen = false; S.hero = id; S.heroName = name || id; S.heroData = null; S.heroSlot = null; S.query = ''; $('search').value = ''; S.fx = new Set(); S.setsOpen = false;
    renderContent();
    await loadHero();
  }

  async function loadHero() {
    const r = await call(api.heroSlots, S.hero);
    if (!r) { S.hero = null; renderContent(); return; }
    S.heroData = r;
    if (!r.slots.some((x) => x.slot === S.heroSlot)) S.heroSlot = r.slots.length ? r.slots[0].slot : null;
    renderContent();
  }

  /** After a pick or a reset: the state, a failed pick said, and the hero read again (the grid with it, next time it opens). */
  async function heroDone(r, okText) {
    if (!r) return;
    applyState(r.state);
    S.heroes = null;
    if (r.failed && r.failed.length) toast('Не вошло в сборку: ' + r.failed[0], true); else toast(okText);
    renderRail();
    await loadHero();
  }

  /** A hero item with effects from its brush; false when it did not go in. */
  async function heroFx(slotId, itemId, fx) {
    if (picking) return false;
    picking = true;
    try {
      const r = await call(api.heroPick, slotId, itemId, fx);
      if (!r) return false;
      await heroDone(r, 'Выбрано. Нажми «Применить косметику».');
      return true;
    } finally { picking = false; }
  }

  async function heroPick(slotId, itemId, fx) {
    if (picking) return;
    picking = true;
    try { await heroDone(await call(api.heroPick, slotId, itemId, fx), itemId ? 'Выбрано. Нажми «Применить косметику».' : 'Сброшено. Нажми «Применить косметику».'); }
    finally { picking = false; }
  }

  async function heroGem(color) {
    if (picking) return;
    picking = true;
    try { await heroDone(await call(api.heroGem, color), color ? 'Цвет гема выбран. Нажми «Применить косметику».' : 'Гем сброшен. Нажми «Применить косметику».'); }
    finally { picking = false; }
  }

  // The gem's colour for Terrorblade's arcana, in the window of his hero-base slot. It lives in the
  // arcana's files (the mod has no gem to socket), so it is a colour, not a gem from the game's list.
  const GEM_DEFAULT = [255, 60, 40];
  const GEM_COLORS = [GEM_DEFAULT, [255, 140, 20], [255, 214, 40], [90, 220, 90], [30, 210, 220], [60, 110, 255], [170, 80, 255], [255, 90, 200], [235, 235, 235]];
  const toHex = (c) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
  const fromHex = (v) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  function gemRow() {
    const cur = S.gem;
    const same = (a, b) => !!a && !!b && a.every((n, i) => n === b[i]);
    const input = h('input', { type: 'color', value: toHex(cur || GEM_DEFAULT), class: 'gempick', title: 'Любой цвет' });
    input.addEventListener('change', (e) => heroGem(fromHex(e.target.value)));
    return h('div', { class: 'fxrow gemrow' }, h('span', { class: 'fxlabel', text: 'Гем' }),
      h('button', { class: 'pillbtn small' + (cur ? '' : ' active'), type: 'button', onclick: () => cur && heroGem(null), text: 'Без гема' }),
      ...GEM_COLORS.map((c) => h('button', {
        class: 'gemsw' + (same(cur, c) ? ' active' : ''), type: 'button', title: toHex(c), 'aria-label': toHex(c),
        style: `background:${toHex(c)}`, onclick: () => heroGem(c),
      })),
      input,
      h('span', { class: 'gemhint', text: 'Цвет применяется, пока надета Fractal Horns of Inner Abysm.' }));
  }

  function renderHeroes(c) {
    if (S.hero) { renderHero(c); return; }
    if (S.heroLoading || !S.heroes) { c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Читаю таблицу предметов…' }))); if (!S.heroes && !S.heroLoading) loadHeroes(); return; }
    const q = S.query.trim().toLowerCase();
    const list = S.heroes.filter((x) => !q || x.name.toLowerCase().includes(q));
    c.replaceChildren(
      h('div', { class: 'head' }, h('h1', { text: 'Предметы' }), h('span', { class: 'count', text: `${list.length} из ${S.heroes.length}` }), h('div', { class: 'line' })),
      list.length ? h('div', { class: 'grid heroes' }, list.map((x) => {
        const card = h('button', { class: 'card hero' + (x.picked ? ' picked' : ''), type: 'button', onclick: () => openHero(x.id, x.name) },
          pic('hero', x.id),
          h('div', { class: 'name', text: x.name }),
          h('div', { class: 'sub', text: x.picked ? `Изменено ${x.picked} из ${x.slots}` : plural(x.sets, 'набор', 'набора', 'наборов') }));
        card.style.setProperty('--tint', tint(x.name));
        return card;
      })) : h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: 'Ничего не найдено' })));
  }

  /** Small tags saying which effects and style are on a worn item. */
  function fxTags(rec, effects, opt) {
    if (!rec) return null;
    const { fx, style } = parsePick(rec);
    const names = fx.map((id) => (effects.find((e) => e.id === id) || { name: id }).name);
    if (style > 0 && opt && opt.styles && opt.styles.length > 1) names.push(`Стиль ${style + 1}`);
    if (!names.length) return null;
    return h('div', { class: 'fxtags', title: 'Добавлено: ' + names.join(', ') }, icon('auto_awesome'), names.map((n) => h('span', { text: n })));
  }

  // The hero screen: a main window with one big tile per slot (what is worn now), and a picker
  // window for the slot that was clicked. Effects and styles live in the picker, next to the items.
  function renderHero(c) {
    const name = S.heroName || S.hero;
    const back = h('button', { class: 'btn', type: 'button', onclick: () => { S.hero = null; S.pickerOpen = false; S.query = ''; $('search').value = ''; renderContent(); if (!S.heroes) loadHeroes(); } }, icon('arrow_back'), 'Герои');
    const d = S.heroData;
    if (!d) { c.replaceChildren(h('div', { class: 'head' }, back, h('h1', { text: name })), h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Читаю предметы героя…' }))); renderPicker(); return; }
    const any = d.slots.some((x) => x.picked);
    const head = h('div', { class: 'head' }, back, h('h1', { text: name }), h('span', { class: 'count', text: plural(d.slots.length, 'слот', 'слота', 'слотов') }), h('div', { class: 'line' }),
      d.sets.length ? h('button', { class: 'btn', type: 'button', onclick: () => { S.setsOpen = !S.setsOpen; renderContent(); } }, icon('inventory_2'), `Наборы · ${d.sets.length}`) : null,
      any ? h('button', { class: 'btn', type: 'button', onclick: async () => { if (picking) return; picking = true; try { await heroDone(await call(api.heroReset, S.hero), 'Герой сброшен. Нажми «Применить косметику».'); } finally { picking = false; } } }, 'Сбросить героя') : null);

    const parts = [head];
    if (S.setsOpen && d.sets.length) {
      parts.push(h('div', { class: 'grid sets' }, d.sets.map((set) => {
        const card = h('button', { class: 'card', type: 'button', title: set.pieces.map((p) => p.name + (p.fits ? '' : ` (${p.reason})`)).join('\n'),
          onclick: async () => { if (picking) return; picking = true; try { await heroDone(await call(api.heroSet, set.id), 'Набор выбран. Нажми «Применить косметику».'); } finally { picking = false; } } },
          h('div', { class: 'name', text: set.name }), h('div', { class: 'sub', text: `${set.fit} из ${set.pieces.length} предметов` }));
        card.style.setProperty('--tint', tint(set.name));
        return card;
      })));
    }

    if (!d.slots.length) parts.push(h('div', { class: 'empty' }, icon('category'), h('h2', { text: 'У героя нет слотов для замены' })));
    else parts.push(h('div', { class: 'grid slots' }, d.slots.map((sl) => {
      const worn = sl.picked ? sl.options.find((o) => o.id === sl.picked.itemId) : null;
      const card = h('button', { class: 'card slot' + (worn ? ' picked' : ''), type: 'button', title: sl.slotLabel,
        onclick: () => { S.heroSlot = sl.slot; S.pq = ''; S.pickerOpen = true; renderContent(); } },
        worn ? pic('item', worn.id) : null,
        worn ? null : h('span', { class: 'slotbig' }, icon(sl.icon)),
        h('span', { class: 'slotchip' }, icon(sl.icon), sl.slotLabel),
        worn ? h('span', { class: 'badge' }, icon('check_circle'), 'Надето') : null,
        fxTags(sl.picked, d.effects, worn),
        h('div', { class: 'name', text: worn ? worn.name : 'Стандартный' }),
        h('div', { class: 'sub', text: worn ? 'Нажми, чтобы сменить' : 'Нажми, чтобы выбрать · ' + plural(sl.options.length, 'предмет', 'предмета', 'предметов') }));
      card.style.setProperty('--tint', tint(sl.slotLabel + (worn ? worn.name : '')));
      return card;
    })));
    const top = c.scrollTop;
    c.replaceChildren(...parts);
    c.scrollTop = top;
    renderPicker();
  }

  const closePicker = () => { S.pickerOpen = false; renderPicker(); };

  /** The window for one slot: effects, styles, search and the items to choose from. */
  function renderPicker() {
    const host = $('pickerHost');
    const d = S.heroData;
    const slot = d && S.pickerOpen ? d.slots.find((x) => x.slot === S.heroSlot) : null;
    if (!slot) { host.hidden = true; host.replaceChildren(); return; }
    const { fx, style } = slot.picked ? parsePick(slot.picked) : { fx: [...S.fx], style: 0 };
    const picked = slot.picked ? slot.picked.itemId : null;
    const pickedOpt = slot.options.find((o) => o.id === picked);
    const prevSearch = host.querySelector('input');
    const keep = prevSearch && document.activeElement === prevSearch;

    const grid = h('div', { class: 'grid' });
    const paintGrid = () => {
      const q = (S.pq || '').trim().toLowerCase();
      const opts = slot.options.filter((o) => !q || o.name.toLowerCase().includes(q));
      grid.replaceChildren(...(opts.length ? opts.map((o) => {
        const on = picked === o.id;
        const card = h('button', { class: 'card' + (on ? ' picked' : ''), type: 'button', title: o.note ? `${o.name}\n${o.note.text}` : o.name,
          onclick: async () => {
            closePicker(); // choosing is the end of the errand; effects can be changed from the worn tile
            await heroPick(slot.slot, on ? null : o.id, buildFx([], 0));
          } },
          pic('item', o.id),
          on ? h('span', { class: 'badge' }, icon('check_circle'), 'Надето') : null,
          o.note ? h('span', { class: 'warnmark ' + o.note.status, title: o.note.text }, icon(o.note.status === 'broken' ? 'error' : 'warning')) : null,
          on ? fxTags(slot.picked, d.effects, o) : null,
          h('div', { class: 'name', text: o.name }), h('div', { class: 'sub', text: slot.slotLabel }));
        card.style.setProperty('--tint', tint(o.name));
        return withBrush(card, { on: on && fx.length > 0, ids: on ? fx : [], title: o.name, apply: (next) => heroFx(slot.slot, o.id, buildFx(next, on ? style : 0)) });
      }) : [h('div', { class: 'empty' }, icon('search_off'), h('h2', { text: 'Ничего не найдено' }))]));
      fillPics([grid]);
    };

    const input = h('input', { type: 'search', placeholder: 'Поиск предмета…', value: S.pq || '', autocomplete: 'off' });
    input.addEventListener('input', (e) => { S.pq = e.target.value; paintGrid(); });
    const rows = [];
    if (pickedOpt && pickedOpt.styles && pickedOpt.styles.length > 1) {
      rows.push(h('div', { class: 'fxrow' }, h('span', { class: 'fxlabel', text: 'Стиль' }),
        ...pickedOpt.styles.map((_, i) => h('button', {
          class: 'pillbtn small' + (style === i ? ' active' : ''), type: 'button',
          onclick: () => heroPick(slot.slot, picked, buildFx(fx, i)),
        }, `Стиль ${i + 1}`))));
    }
    if (S.hero === 'terrorblade' && slot.equipSlot === 'hero_base') rows.push(gemRow());
    // The ⚠ on a card says little by itself: spell it out here, in the window, once per slot.
    const noted = slot.options.filter((o) => o.note);
    const texts = [...new Set(noted.map((o) => o.note.text))];
    const worst = noted.some((o) => o.note.status === 'broken') ? 'broken' : 'issues';
    const notice = noted.length ? h('div', { class: 'notice ' + worst },
      icon(worst === 'broken' ? 'error' : 'warning'),
      h('div', {},
        h('b', { text: `Значок ⚠ на предмете: ${noted.length} из ${slot.options.length} в этом слоте` }),
        h('p', { text: texts.length === 1 ? texts[0] : 'Такие предметы работают с оговорками: наведи курсор на значок, чтобы увидеть, что именно не так с конкретным предметом.' }),
        h('p', { class: 'dim', text: 'Предмет всё равно можно надеть. Если он выглядит не так, как нужно, его можно снять кнопкой «Снять».' }))) : null;
    const win = h('div', { class: 'picker', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'picker-head' },
        icon(slot.icon), h('h2', { text: `${S.heroName || S.hero}: ${slot.slotLabel}` }),
        h('span', { class: 'count', text: plural(slot.options.length, 'предмет', 'предмета', 'предметов') }),
        h('div', { class: 'grow' }),
        h('label', { class: 'search' }, icon('search'), input),
        picked ? h('button', { class: 'btn', type: 'button', onclick: () => { closePicker(); heroPick(slot.slot, null, []); } }, 'Снять') : null,
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Закрыть', onclick: closePicker }, icon('close'))),
      h('div', { class: 'picker-fx' }, notice, rows),
      h('div', { class: 'picker-body' }, grid));
    host.replaceChildren(win);
    host.hidden = false;
    host.onclick = (e) => { if (e.target === host) closePicker(); };
    paintGrid();
    if (keep) { const i = host.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  let picking = false;
  async function pick(slot, itemId) {
    if (picking) return;
    picking = true;
    try {
      const r = await call(api.pick, slot, itemId);
      if (!r) return;
      applyState(r.state);
      toast(itemId ? 'Выбрано. Нажми «Применить косметику».' : 'Сброшено. Нажми «Применить косметику».');
      renderRail(); renderContent();
    } finally { picking = false; }
  }

  /** A courier (or the default, null) with its effects, in one go. Answers false when it did not go in. */
  async function pickFx(slot, itemId, ids) {
    if (picking) return false;
    picking = true;
    try {
      const r = await call(api.pickFx, slot, itemId, ids);
      if (!r) return false;
      applyState(r.state);
      S.eq = null;
      if (r.failed && r.failed.length) toast('Не вошло в сборку: ' + r.failed[0], true); else toast('Выбрано. Нажми «Применить косметику».');
      renderRail(); renderContent();
      return true;
    } finally { picking = false; }
  }

  async function loadSlots() {
    S.loading = true; renderRail(); renderContent();
    const r = await call(api.slots);
    S.loading = false;
    S.effects = r ? (r.effects || []) : [];
    S.slots = r ? r.slots.sort((a, b) => meta(a.slot).order - meta(b.slot).order || a.slot.localeCompare(b.slot)) : [];
    if (!S.slots.some((s) => s.slot === S.current)) S.current = S.slots.length ? S.slots[0].slot : null;
    renderRail(); renderContent();
    loadEmblems();
  }

  async function chooseGame() {
    const r = await call(api.chooseGame);
    if (!r || !r.changed) return;
    await start();
  }

  async function start() {
    const r = await call(api.init);
    if (!r) return;
    S.connected = r.connected; S.slots = null; S.emblems = null; S.current = null; S.heroes = null; S.hero = null; S.view = 'slot';
    S.tool = vrfOf(r.tools);
    applyState(r.state, r.gameRunning);
    renderRail(); renderContent();
    S.eq = null; S.spells = null; S.spellHero = null;
    if (S.connected) await loadSlots();
    if (S.connected && !r.toolsPromptSeen && !S.promptShown) { S.promptShown = true; await offerTool(r.tools); }
  }


  // ---------- «Надето»: everything worn now, in one window ----------
  // The tab sits before «Настройки». It is built here (index.html has no markup for it).
  const wornCount = () => Object.keys(S.picks).length + Object.keys(S.items).length + Object.keys(S.icons).length;
  function ensureEqTab() {
    if ($('tabEq')) return;
    const set = $('tabSet');
    const tab = h('button', { class: 'tab', id: 'tabEq', type: 'button' });
    set.parentNode.insertBefore(tab, set);
  }
  function renderEqTab() {
    const n = wornCount();
    $('tabEq').textContent = n ? `Надето · ${n}` : 'Надето';
  }

  async function loadEquipped(quiet) {
    if (!S.connected) { S.eq = null; renderContent(); return; }
    if (!quiet) { S.eqLoading = true; renderContent(); }
    const r = await call(api.equipped);
    S.eqLoading = false;
    S.eq = r ? { free: r.free, heroItems: r.heroItems, abilityPicks: r.abilityPicks || [], effects: r.effects || [] } : { free: [], heroItems: [], abilityPicks: [], effects: [] };
    if (S.tab === 'eq') renderContent();
  }

  /** Take one worn item off, from this window. */
  async function unequip(kind, slot) {
    if (picking) return;
    picking = true;
    try {
      const r = kind === 'free' ? await call(api.pick, slot, null) : kind === 'icon' ? await call(api.spellPick, slot, null) : await call(api.heroPick, slot, null, []);
      if (!r) return;
      applyState(r.state);
      S.heroes = null; S.hero = null; S.heroData = null; // the hero grid is read again when it is opened
      toast('Снято. Нажми «Применить косметику».');
      renderRail();
      await loadEquipped(true);
    } finally { picking = false; }
  }

  /** «Снять все»: the first click asks again on the button itself, the second one does it. */
  let clearArmed = null;
  async function clearAll(btn) {
    if (picking) return;
    if (!clearArmed) {
      btn.lastChild.textContent = 'Точно снять всё?';
      btn.classList.add('danger');
      clearArmed = setTimeout(() => { clearArmed = null; if (btn.isConnected) { btn.lastChild.textContent = 'Снять все'; btn.classList.remove('danger'); } }, 4000);
      return;
    }
    clearTimeout(clearArmed); clearArmed = null;
    picking = true;
    try {
      const r = await call(api.clearAll);
      if (!r) return;
      applyState(r.state);
      S.heroes = null; S.hero = null; S.heroData = null;
      toast('Всё снято. Нажми «Применить косметику».');
      renderRail();
      await loadEquipped(true);
    } finally { picking = false; }
  }

  function iconTile(o) {
    const card = h('div', { class: 'card worn spell' },
      pic('spell', o.icon),
      h('span', { class: 'slotchip' }, icon('stars'), 'Иконка'),
      h('span', { class: 'badge' }, icon('check_circle'), 'Надето'),
      h('div', { class: 'name', text: o.name }),
      h('div', { class: 'sub', text: o.label || o.ability }),
      h('button', { class: 'btn sm unequip', type: 'button', onclick: () => unequip('icon', o.ability) }, icon('close'), 'Снять'));
    card.style.setProperty('--tint', tint(o.ability));
    return card;
  }

  function wornTile(kind, o, subtitle, label) {
    const tags = kind === 'hero' ? fxTags({ effects: o.effects }, S.eq.effects, o.styled ? { styles: [0, 1] } : null) : null;
    const card = h('div', { class: 'card worn' },
      pic('item', o.itemId),
      h('span', { class: 'slotchip' }, icon(label.icon), label.text),
      h('span', { class: 'badge' }, icon('check_circle'), 'Надето'),
      tags,
      o.gem ? h('div', { class: 'gemline' }, h('i', { class: 'gemdot', style: `background:${toHex(o.gem)}` }), `Гем ${toHex(o.gem)}`) : null,
      h('div', { class: 'name', text: o.name || `Предмет ${o.itemId}` }),
      h('div', { class: 'sub', text: subtitle }),
      h('button', { class: 'btn sm unequip', type: 'button', onclick: () => unequip(kind === 'hero' ? 'hero' : 'free', o.slot) }, icon('close'), 'Снять'));
    card.style.setProperty('--tint', tint((o.name || o.itemId) + label.text));
    return card;
  }
  function renderEquipped(c) {
    c.scrollTop = 0;
    if (!S.connected) {
      c.replaceChildren(h('div', { class: 'empty' }, icon('folder_off'), h('h2', { text: 'Dota 2 не найдена' }),
        h('p', { text: 'Укажи папку игры в «Настройках» или здесь.' }),
        h('button', { class: 'btn primary', type: 'button', onclick: chooseGame, text: 'Выбрать папку' })));
      return;
    }
    if (S.eqLoading || !S.eq) {
      c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Собираю список надетого…' })));
      if (!S.eq && !S.eqLoading) loadEquipped();
      return;
    }
    const { free, heroItems, abilityPicks } = S.eq;
    const total = free.length + heroItems.length + abilityPicks.length;
    const kids = [h('div', { class: 'head' }, h('h1', { text: 'Надето' }), h('span', { class: 'count', text: total ? plural(total, 'предмет', 'предмета', 'предметов') : '' }), h('div', { class: 'line' }),
      total ? h('button', { class: 'btn', type: 'button', onclick: (e) => clearAll(e.currentTarget) }, icon('layers_clear'), h('span', { text: 'Снять все' })) : null)];
    if (!total) {
      kids.push(h('div', { class: 'empty' }, icon('checkroom'), h('h2', { text: 'Пока ничего не надето' }),
        h('p', { text: 'Выбери предмет в разделе «Косметика» или у героя: он появится здесь, и его можно будет снять одной кнопкой.' }),
        h('button', { class: 'btn primary', type: 'button', onclick: () => setTab('cos'), text: 'К косметике' })));
      c.replaceChildren(...kids);
      return;
    }
    if (free.length) {
      kids.push(h('div', { class: 'eqgroup' }, h('h2', { text: 'Косметика' }), h('span', { class: 'count', text: String(free.length) })));
      kids.push(h('div', { class: 'grid slots' }, free.map((o) => {
        const m = meta(o.slot);
        return wornTile('free', o, 'Косметика', { icon: m.icon, text: m.label });
      })));
    }
    const byHero = new Map();
    for (const o of heroItems) { if (!byHero.has(o.hero)) byHero.set(o.hero, []); byHero.get(o.hero).push(o); }
    for (const [hero, list] of byHero) {
      const name = list[0].heroName;
      kids.push(h('div', { class: 'eqgroup' }, h('h2', { text: name }), h('span', { class: 'count', text: String(list.length) }), h('div', { class: 'line' }),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { S.view = 'heroes'; setTab('cos'); openHero(hero, name); } }, icon('open_in_new'), 'Открыть героя')));
      kids.push(h('div', { class: 'grid slots' }, list.map((o) => wornTile('hero', o, name, { icon: o.icon, text: o.slotLabel }))));
    }
    if (abilityPicks.length) {
      kids.push(h('div', { class: 'eqgroup' }, h('h2', { text: 'Иконки способностей' }), h('span', { class: 'count', text: String(abilityPicks.length) }), h('div', { class: 'line' })));
      kids.push(h('div', { class: 'grid slots' }, abilityPicks.map((o) => iconTile({ ...o, name: o.heroName ? `${o.heroName}: ${o.name}` : o.name }))));
    }
    c.replaceChildren(...kids);
    fillPics([c]);
  }

  // ---------- Settings ----------
  const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' МБ';
  const vrfOf = (tools) => (tools || []).find((x) => x.name === 'vrf') || null;

  const TABS = { cos: 'tabCos', eq: 'tabEq', set: 'tabSet' };
  function setTab(tab) {
    if (S.tab === tab) return;
    S.tab = tab; if (S.pickerOpen) closePicker();
    if (tab === 'eq') S.eq = null; // read again each time the window opens
    for (const [name, id] of Object.entries(TABS)) $(id).classList.toggle('active', tab === name);
    $('search').closest('label').style.visibility = tab === 'cos' ? '' : 'hidden';
    renderRail(); renderContent();
  }

  async function reloadSettings() {
    const r = await call(api.settings);
    if (r) { S.set = r; S.tool = vrfOf(r.tools); }
    if (S.tab === 'set') renderContent();
  }

  function block(title, ...kids) { return h('div', { class: 'sblock' }, h('h3', { text: title }), kids); }
  const row = (...kids) => h('div', { class: 'srow' }, kids);
  const link = (text, url) => h('a', { class: 'slink', onclick: () => call(api.openExternal, url), text });

  /* Updates. The main process keeps one state ({ mode, phase, latest, percent, … }) and pushes it on every change.
   * A copy put in by the installer downloads a newer release by itself and offers «Перезапустить и обновить»;
   * any other copy gets a link to the release page. The title bar button follows the state; the block in
   * Settings is repainted in place (not the whole page, so the colour sliders keep working while it downloads). */
  function showUpdate(u) {
    S.update = u || null;
    const b = $('updBtn');
    if (b) {
      const p = u && u.phase;
      const on = !!(u && u.available);
      b.hidden = !on;
      if (on) {
        $('updText').textContent = p === 'ready' ? 'Перезапустить и обновить' : p === 'downloading' ? `Скачиваю ${u.percent || 0}%` : `Обновление ${u.latest}`;
        b.disabled = p === 'downloading';
        b.title = p === 'ready' ? `Версия ${u.latest} скачана. Нажми, чтобы перезапустить приложение и обновиться`
          : p === 'downloading' ? `Скачиваю версию ${u.latest}…` : `Доступна версия ${u.latest} (у тебя ${u.current}). Открыть страницу загрузки`;
      }
    }
    const old = document.getElementById('updBlock');
    if (old) old.replaceWith(updateBlock(S.appVersion));
  }
  async function checkUpdate(quiet) {
    try {
      const r = await api.checkUpdate();
      if (!r || !r.ok) { if (!quiet) toast((r && r.error) || 'Не удалось проверить обновления', true); return null; }
      showUpdate(r.update);
      return r.update;
    } catch { return null; }
  }
  async function installUpdate() {
    const r = await call(api.installUpdate);
    if (r && !r.started) toast('Обновление ещё не скачано', true);
  }
  api.onUpdate(showUpdate);
  $('updBtn').addEventListener('click', () => {
    const u = S.update;
    if (!u) return;
    if (u.phase === 'ready') installUpdate(); else if (u.mode === 'manual') call(api.openExternal, u.url);
  });

  function updateBlock(version) {
    const u = S.update || {};
    const busy = u.phase === 'checking' || u.phase === 'downloading';
    const text = {
      checking: 'Проверяю…',
      downloading: `Скачиваю версию ${u.latest}: ${u.percent || 0}%`,
      ready: `Версия ${u.latest} скачана`,
      available: `Доступна версия ${u.latest}`,
      none: u.latest ? 'У тебя последняя версия' : 'Релизов пока нет',
      error: 'Не удалось проверить обновления',
    }[u.phase] || 'Ещё не проверял';
    const kids = [
      row(h('span', { class: 'label', text: 'Версия' }), h('span', { class: 'mono', text: version || '—' }),
        h('span', { class: 'label grow', text, style: u.phase === 'error' ? 'color: var(--bad)' : '' }),
        h('button', { class: 'btn sm', type: 'button', disabled: busy || u.phase === 'ready', onclick: () => checkUpdate(false) }, icon('refresh'), 'Проверить'),
        u.phase === 'ready' ? h('button', { class: 'btn sm primary', type: 'button', onclick: installUpdate }, icon('restart_alt'), 'Перезапустить и обновить') : null,
        u.phase === 'available' && u.mode === 'manual' ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => call(api.openExternal, u.url) }, icon('open_in_new'), 'Скачать') : null),
      u.phase === 'downloading' ? h('div', { class: 'bar' }, h('i', { style: `width: ${u.percent || 0}%` })) : null,
      u.phase === 'error' && u.error ? h('p', { class: 'shint', text: u.error }) : null,
      u.available && u.notes ? h('div', { class: 'upd-notes', text: u.notes }) : null,
      u.mode === 'manual' ? h('p', { class: 'shint', text: 'Эта копия сама не обновляется: автообновление работает у версии, установленной установщиком (Setup). Здесь приложение только сообщит о новой версии со ссылкой на загрузку.' })
        : u.mode === 'auto' ? h('p', { class: 'shint', text: 'Новая версия скачивается сама. Если не нажимать «Перезапустить и обновить», она поставится, когда ты закроешь приложение.' }) : null,
    ];
    const el = block('Обновления', ...kids);
    el.id = 'updBlock';
    return el;
  }

  /* Colours of the interface: ready palettes plus three sliders. Dragging a slider repaints the app live and
   * must not redraw this block (that would drop the slider), so the sliders and swatches are updated by hand. */
  function themeBlock() {
    const T = window.Theme;
    const swatches = [], sliders = {};
    const markActive = () => { const p = T.preset(T.get()); swatches.forEach(([el, id]) => el.classList.toggle('active', !!p && p.id === id)); };
    const track = () => {
      const t = T.get();
      const g = (a, b, c) => `linear-gradient(90deg, ${[a, b, c].join(',')})`;
      const hues = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 70% 55%)`);
      sliders.hue.style.setProperty('--track', g(...hues));
      sliders.accent.style.setProperty('--track', g(...hues));
      sliders.sat.style.setProperty('--track', g(`hsl(${t.hue} 4% 20%)`, `hsl(${t.hue} 60% 28%)`, `hsl(${t.hue} 90% 36%)`));
    };
    const slide = (key, label, min, max, fmt) => {
      const num = h('span', { class: 'num' });
      const input = h('input', { type: 'range', min, max, step: 1, value: T.get()[key], 'aria-label': label });
      sliders[key] = input;
      const sync = () => { num.textContent = fmt(+input.value); };
      input.addEventListener('input', () => { T.set({ [key]: +input.value }); sync(); markActive(); track(); });
      sync();
      return h('div', { class: 'slide' }, h('span', { class: 'label', text: label }), input, num);
    };
    const presets = h('div', { class: 'themes' }, ...T.PRESETS.map((p) => {
      const sw = T.swatch(p);
      const dot = h('span', { class: 'sw' }, h('i'));
      dot.style.background = sw.bg; dot.firstChild.style.background = sw.accent;
      const b = h('button', { class: 'theme', type: 'button', title: p.name,
        onclick: () => {
          T.set(p);
          for (const k of ['hue', 'sat', 'accent']) { sliders[k].value = p[k]; sliders[k].dispatchEvent(new Event('input')); }
        } }, dot, h('span', { text: p.name }));
      swatches.push([b, p.id]);
      return b;
    }));
    const box = block('Оформление',
      presets,
      slide('hue', 'Цвет фона', 0, 360, (v) => v + '°'),
      slide('sat', 'Насыщенность фона', 0, 90, (v) => v + '%'),
      slide('accent', 'Цвет акцента', 0, 360, (v) => v + '°'),
      row(h('button', { class: 'btn sm', type: 'button', onclick: () => {
        T.reset(); const d = T.get();
        for (const k of ['hue', 'sat', 'accent']) sliders[k].value = d[k];
        for (const k of ['hue', 'sat', 'accent']) sliders[k].dispatchEvent(new Event('input'));
        T.reset(); markActive();
      } }, icon('restart_alt'), 'Сбросить цвета')));
    markActive(); track();
    return box;
  }

  async function renderSettings(c) {
    if (!S.set) { c.replaceChildren(h('div', { class: 'empty' }, icon('hourglass_top'), h('h2', { text: 'Загружаю настройки…' }))); await reloadSettings(); return; }
    const m = S.set, vrf = S.tool;
    const kids = [h('div', { class: 'head' }, h('h1', { text: 'Настройки' }), h('div', { class: 'line' }))];

    kids.push(themeBlock());
    S.appVersion = m.version;
    kids.push(updateBlock(m.version));

    kids.push(block('Путь к Dota 2',
      row(h('span', { class: 'mono grow', text: m.gamePath || 'не найден' }), h('i', { class: 'dot ' + (m.gameValid ? 'ok' : 'bad') })),
      row(h('span', { class: 'label', text: 'Папка модов' }), h('span', { class: 'mono grow', text: m.modFolder ? m.gamePath.replace(/[\\/]+$/, '') + '\\' + m.modFolder : '—' })),
      row(h('button', { class: 'btn sm', type: 'button', text: 'Найти автоматически', onclick: async () => {
        const r = await call(api.detectGame);
        if (r) { if (r.found) { toast('Dota 2 найдена'); await start(); } else toast('Не нашёл автоматически: укажи вручную', true); }
        await reloadSettings();
      } }), h('button', { class: 'btn sm', type: 'button', text: 'Указать вручную', onclick: async () => { await chooseGame(); await reloadSettings(); } }))));

    if (vrf && vrf.available) {
      const ready = vrf.ready;
      const prog = h('div', { class: 'bar', id: 'toolBar', hidden: !S.toolBusy }, h('i'));
      kids.push(block('Дополнительный контент: картинки предметов',
        row(h('span', { class: 'label grow', text: ready ? 'Установлен' : 'Не скачан' }),
          h('span', { class: 'num', text: mb(ready ? vrf.installedBytes : vrf.downloadBytes) }),
          ready ? h('button', { class: 'btn sm', type: 'button', text: 'Удалить', onclick: removeTool })
            : h('button', { class: 'btn sm primary', type: 'button', disabled: S.toolBusy, onclick: installTool }, icon('download'), 'Скачать')),
        prog,
        h('p', { class: 'shint', text: 'Большинство иконок предметов приложение читает из самой игры без скачивания. Эта программа (Source 2 Viewer, MIT) нужна для тех, что Valve хранит сжатыми, и для портретов героев. Удалить можно в любой момент.' })));
    }

    kids.push(block('Кэш',
      row(h('span', { class: 'label grow', text: 'Картинки из игры' }), h('span', { class: 'num', text: mb(m.iconCacheBytes) }),
        h('button', { class: 'btn sm', type: 'button', text: 'Очистить', onclick: async () => {
          const r = await call(api.clearCache); if (!r) return;
          S.pics.clear(); S.why.clear(); toast('Кэш очищен'); await reloadSettings();
        } })),
      row(h('span', { class: 'label', text: 'Прокси для загрузки' }),
        h('input', { class: 'sinput', id: 'proxyIn', placeholder: 'http://127.0.0.1:8080 (пусто = напрямую)', value: m.proxy, spellcheck: 'false' }),
        h('button', { class: 'btn sm', type: 'button', text: 'Сохранить', onclick: async () => {
          const r = await call(api.setSetting, 'downloadProxy', $('proxyIn').value);
          if (r) { toast($('proxyIn').value.trim() ? 'Прокси сохранён' : 'Прокси отключён'); await reloadSettings(); }
        } })),
      row(h('button', { class: 'btn sm', type: 'button', onclick: () => call(api.openDataFolder) }, icon('folder_open'), 'Папка данных приложения'))));

    const top = c.scrollTop;
    c.replaceChildren(h('div', { class: 'settings' }, kids));
    c.scrollTop = top;
  }

  function paintToolProgress(evt) {
    const bar = document.getElementById('toolBar');
    const fill = bar && bar.firstChild;
    const st = $('statusText');
    if (evt.type === 'download') {
      const pct = evt.total ? Math.min(100, Math.round(evt.loaded / evt.total * 100)) : 0;
      if (bar) { bar.hidden = false; fill.style.width = pct + '%'; }
      st.textContent = `Скачиваю доп. контент: ${mb(evt.loaded)} / ${mb(evt.total)}`;
    } else if (evt.type === 'stage') {
      st.textContent = evt.stage === 'unpack' ? 'Распаковываю доп. контент…' : 'Скачиваю доп. контент…';
    } else { renderBar(); }
  }
  api.onToolProgress(paintToolProgress);

  async function installTool() {
    if (S.toolBusy) return;
    S.toolBusy = true;
    if (S.tab === 'set') renderContent();
    const r = await call(api.toolInstall);
    S.toolBusy = false;
    renderBar();
    if (r) {
      S.tool = vrfOf(r.tools); S.pics.clear(); S.why.clear();
      toast('Готово: картинки теперь берутся из игры');
    }
    await reloadSettings();
    if (S.tab === 'cos') renderContent();
  }

  async function removeTool() {
    const r = await call(api.toolRemove);
    if (!r) return;
    S.pics.clear(); S.why.clear(); toast('Инструмент удалён');
    await reloadSettings();
  }

  /** The one question about the extra content, asked once on first launch (Settings has the same button). */
  function askTool() {
    return new Promise((resolve) => {
      const dlg = $('toolDlg');
      const done = (v) => { dlg.hidden = true; window.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      window.addEventListener('keydown', onKey);
      $('toolYes').onclick = () => done(true);
      $('toolNo').onclick = () => done(false);
      dlg.onclick = (e) => { if (e.target === dlg) done(false); };
      dlg.hidden = false;
      $('toolYes').focus();
    });
  }

  async function offerTool(tools) {
    const vrf = vrfOf(tools);
    S.tool = vrf;
    if (!vrf || !vrf.available || vrf.ready) return;
    const yes = await askTool();
    await call(api.setSetting, 'toolsPromptSeen', true);
    if (yes) await installTool();
  }

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.pickerOpen) closePicker(); });
  $('folderBtn').addEventListener('click', () => call(api.openModsFolder));
  $('applyBtn').addEventListener('click', async () => {
    if (S.applying || !S.pending) return;
    S.applying = true; renderBar();
    try {
      const r = await call(api.apply);
      if (!r) return;
      applyState(r.state, r.gameRunning);
      if (r.failed && r.failed.length) toast('Не вошло в сборку: ' + r.failed[0], true);
      else toast(r.deployed ? 'Косметика применена. Можно играть!' : 'Всё снято: игра вернулась к стандартным файлам.');
    } finally { S.applying = false; renderBar(); }
  });
  $('playBtn').addEventListener('click', async () => {
    if (S.pending) toast('Есть неприменённые изменения: запускаю без них. Нажми «Применить косметику».', true);
    const r = await call(api.play);
    if (r && !S.pending) toast('Запускаю Dota 2 через Steam…');
  });
  $('search').addEventListener('input', (e) => { S.query = e.target.value; if (S.tab === 'cos' && S.connected) renderContent(); });
  $('wmin').addEventListener('click', () => api.win.min());
  $('wmax').addEventListener('click', () => api.win.max());
  $('wclose').addEventListener('click', () => api.win.close());
  window.addEventListener('focus', async () => { if (!S.connected) return; const r = await api.state(); if (r && r.ok) applyState(r.state, r.gameRunning); });

  ensureEqTab();
  for (const id of ['safeBtn', 'confirmDlg', 'aboutBtn', 'about']) { const el = $(id); if (el) el.remove(); } // old markup, if index.html still has it
  $('tabCos').addEventListener('click', () => setTab('cos'));
  $('tabEq').addEventListener('click', () => setTab('eq'));
  $('tabSet').addEventListener('click', () => setTab('set'));

  start();
  checkUpdate(true); // once, quietly: the title bar shows a button only when a newer release exists
})();
