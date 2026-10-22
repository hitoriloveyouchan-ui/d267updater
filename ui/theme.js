/* UI colours. A theme is three numbers: the hue of the dark surfaces, how strong their colour is, and the
 * hue of the accent. Everything on screen is derived from them and written to CSS variables, so the
 * sliders in Settings repaint the whole interface live. The choice is kept in localStorage. */
(() => {
  const KEY = 'ui-theme';
  const PRESETS = [
    { id: 'blue',   name: 'Синий',      hue: 218, sat: 52, accent: 208 },
    { id: 'violet', name: 'Фиолетовый', hue: 262, sat: 46, accent: 270 },
    { id: 'emerald', name: 'Изумруд',   hue: 168, sat: 44, accent: 152 },
    { id: 'crimson', name: 'Багровый',  hue: 350, sat: 42, accent: 352 },
    { id: 'amber',  name: 'Янтарь',     hue: 30,  sat: 40, accent: 40 },
    { id: 'rose',   name: 'Розовый',    hue: 320, sat: 40, accent: 328 },
    { id: 'graphite', name: 'Графит',   hue: 220, sat: 8,  accent: 200 },
  ];
  const DEFAULT = PRESETS[0];
  const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${l}%)`;
  const hslRgb = (h, s, l) => { // → "r,g,b" for rgba(var(--x), a)
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return `${f(0)},${f(8)},${f(4)}`;
  };

  function vars({ hue, sat, accent }) {
    const clamp = (s, k) => Math.min(100, s * k);
    return {
      '--bg': hsl(hue, sat * 1.1, 9),
      '--bar': hsl(hue, sat * 1.05, 10),
      '--rail': hsl(hue, sat, 12),
      '--card': hsl(hue, sat * 0.95, 16),
      '--active': hsl(hue, sat * 0.95, 23),
      '--pop': hsl(hue, sat * 0.95, 21),
      '--sheet': hsl(hue, sat, 16),
      '--picker': hsl(hue, sat, 13),
      '--tile': hsl(hue, sat * 1.1, 15),
      '--text': hsl(hue, clamp(sat, 1.5), 95),
      '--sub': hsl(hue, clamp(sat, 0.9), 79),
      '--muted': hsl(hue, clamp(sat, 0.6), 66),
      '--faint': hsl(hue, clamp(sat, 0.45), 47),
      '--ui-rgb': hslRgb(hue, 100, 75),
      '--peach': hsl(accent, 100, 71),
      '--accent-rgb': hslRgb(accent, 100, 71),
      '--on-accent': hsl(accent, 90, 9),
      '--play': hsl(accent, 78, 46),
      '--play-hi': hsl(accent, 82, 54),
      '--play-line': hsl(accent, 100, 68),
    };
  }

  let cur = { ...DEFAULT };
  function apply(t, save) {
    cur = { hue: +t.hue, sat: +t.sat, accent: +t.accent };
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(vars(cur))) root.setProperty(k, v);
    if (save) { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch {} }
  }
  function load() {
    try {
      const t = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (t && [t.hue, t.sat, t.accent].every((n) => Number.isFinite(+n))) return t;
    } catch {}
    return null;
  }

  const saved = load();
  if (saved) apply(saved, false); // before the first paint (this script sits in <head>)

  window.Theme = {
    PRESETS, DEFAULT,
    get: () => ({ ...cur }),
    set: (t) => apply({ ...cur, ...t }, true),
    reset: () => { apply(DEFAULT, false); try { localStorage.removeItem(KEY); } catch {} },
    /** A preset's own colours, for its swatch. */
    swatch: (p) => ({ bg: hsl(p.hue, p.sat * 1.1, 14), accent: hsl(p.accent, 100, 71) }),
    preset: (t) => PRESETS.find((p) => p.hue === t.hue && p.sat === t.sat && p.accent === t.accent) || null,
  };
})();
