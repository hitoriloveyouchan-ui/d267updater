/* The updater the window talks to. One state object (what is happening and what the window should show)
 * is kept here and sent out whenever it changes.
 *
 * Two modes. "auto": a copy put in place by the installer: the engine (electron-updater) finds the newer
 * release on GitHub, downloads it in the background and installs it when asked. "manual": any other copy:
 * the release is only looked up (src/updates.ts) and the window shows a link to its page.
 *
 * The engine is handed in, so this file has no dependency of its own and can be tested with a stand-in.
 *
 * Copyright (C) 2026 h6rd, TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { checkForUpdate, UPDATE_REPO } from './updates.ts';

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

export type UpdateState = {
  mode: 'auto' | 'manual';
  phase: UpdatePhase;
  /** A newer release exists (found, downloading or ready to install). */
  available: boolean;
  current: string;
  latest: string;
  /** The release page, for the link. */
  url: string;
  notes: string;
  /** Download progress, 0 to 100. */
  percent: number;
  error: string;
};

/** The part of electron-updater's `autoUpdater` that is used. */
export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, cb: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/** electron-updater gives the notes as HTML text or as a list per version; the window shows plain text. */
export function plainNotes(raw: unknown): string {
  const text = Array.isArray(raw)
    ? raw.map((x) => String((x as { note?: unknown })?.note ?? '')).join('\n')
    : String(raw ?? '');
  return text.replace(/<\s*br\s*\/?>|<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().split('\n').slice(0, 12).join('\n').slice(0, 1200);
}

export function createUpdater(o: {
  version: string;
  /** The engine when this copy can update itself; null for a copy that cannot. */
  engine: UpdateEngine | null;
  send: (state: UpdateState) => void;
  fetch: (url: string, init?: any) => Promise<Response>;
}) {
  const releases = `https://github.com/${UPDATE_REPO}/releases`;
  let state: UpdateState = {
    mode: o.engine ? 'auto' : 'manual', phase: 'idle', available: false,
    current: o.version, latest: '', url: releases, notes: '', percent: 0, error: '',
  };
  const set = (p: Partial<UpdateState>) => {
    state = { ...state, ...p };
    state.available = state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
    o.send(state);
  };
  const fail = (e: unknown) => set({ phase: 'error', error: String((e as Error)?.message || e) });

  const au = o.engine;
  if (au) {
    au.autoDownload = true;           // found → starts downloading right away
    au.autoInstallOnAppQuit = true;   // downloaded but not restarted: it goes in when the program is closed
    au.on('checking-for-update', () => set({ phase: 'checking', error: '' }));
    au.on('update-available', (i: any) => set({
      phase: 'downloading', percent: 0, latest: String(i?.version || ''), notes: plainNotes(i?.releaseNotes),
      url: i?.version ? `${releases}/tag/v${i.version}` : releases,
    }));
    au.on('update-not-available', (i: any) => set({ phase: 'none', available: false, latest: String(i?.version || state.latest) }));
    au.on('download-progress', (p: any) => set({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0))) }));
    au.on('update-downloaded', (i: any) => set({ phase: 'ready', percent: 100, latest: String(i?.version || state.latest) }));
    au.on('error', fail);
  }

  async function check(): Promise<UpdateState> {
    // A download or a ready update is not interrupted by another look.
    if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'checking') return state;
    if (au) {
      try { await au.checkForUpdates(); } catch (e) { fail(e); }
      return state;
    }
    set({ phase: 'checking', error: '' });
    try {
      const u = await checkForUpdate(o.version, o.fetch as any);
      set({ phase: u.available ? 'available' : 'none', latest: u.latest, url: u.url, notes: u.notes });
    } catch (e) { fail(e); }
    return state;
  }

  /** Close the program, put the downloaded version in place and start it again. */
  function install(): boolean {
    if (!au || state.phase !== 'ready') return false;
    au.quitAndInstall(true, true);
    return true;
  }

  return { check, install, state: () => state };
}
