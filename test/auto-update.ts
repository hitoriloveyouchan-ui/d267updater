/* The updater's state machine, with a stand-in for electron-updater. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, plainNotes, type UpdateEngine, type UpdateState } from '../src/auto-update.ts';
import { canAutoUpdate, UPDATE_REPO } from '../src/updates.ts';

// ---- canAutoUpdate: only an installed (NSIS) copy updates itself
const base = { platform: 'win32', isPackaged: true, env: {}, execDir: 'C:\\app', listDir: () => ['DotaModLauncher.exe', 'Uninstall Менеджер модов.exe'] };
assert.equal(canAutoUpdate(base), true);
assert.equal(canAutoUpdate({ ...base, listDir: () => ['DotaModLauncher.exe', 'resources.pak'] }), false); // unpacked folder
assert.equal(canAutoUpdate({ ...base, env: { PORTABLE_EXECUTABLE_DIR: 'D:\\' } }), false); // portable
assert.equal(canAutoUpdate({ ...base, isPackaged: false }), false); // npm start
assert.equal(canAutoUpdate({ ...base, platform: 'linux' }), false);
assert.equal(canAutoUpdate({ ...base, listDir: () => { throw new Error('no access'); } }), false);

// ---- plainNotes
assert.equal(plainNotes('<p>Новое окно</p><ul><li>эффекты</li><li>цвета &amp; темы</li></ul>'), 'Новое окно\nэффекты\nцвета & темы');
assert.equal(plainNotes([{ version: '1', note: 'раз' }, { version: '2', note: 'два' }]), 'раз\nдва');
assert.equal(plainNotes(null), '');

// ---- auto mode, with an engine that does what electron-updater does
class FakeEngine extends EventEmitter implements UpdateEngine {
  autoDownload = false; autoInstallOnAppQuit = false; installed: unknown[] | null = null;
  next: 'newer' | 'same' | 'fail' = 'newer';
  async checkForUpdates() {
    this.emit('checking-for-update');
    if (this.next === 'fail') { const e = new Error('Cannot find latest.yml'); this.emit('error', e); throw e; }
    if (this.next === 'same') { this.emit('update-not-available', { version: '0.3.9' }); return; }
    this.emit('update-available', { version: '0.4.0', releaseNotes: '<p>Окно эффектов</p>' });
    this.emit('download-progress', { percent: 41.6 });
    this.emit('download-progress', { percent: 100 });
    this.emit('update-downloaded', { version: '0.4.0' });
  }
  quitAndInstall(...args: unknown[]) { this.installed = args; }
}
const sent: UpdateState[] = [];
const eng = new FakeEngine();
const noNet = async () => { throw new Error('auto mode must not use the GitHub lookup'); };
const u = createUpdater({ version: '0.3.9', engine: eng, send: (s) => sent.push(s), fetch: noNet as any });
assert.equal(eng.autoDownload, true);
assert.equal(eng.autoInstallOnAppQuit, true);
assert.equal(u.state().mode, 'auto');
assert.equal(u.install(), false); // nothing downloaded yet
let s = await u.check();
assert.equal(s.phase, 'ready');
assert.equal(s.available, true);
assert.equal(s.latest, '0.4.0');
assert.equal(s.notes, 'Окно эффектов');
assert.equal(s.url, `https://github.com/${UPDATE_REPO}/releases/tag/v0.4.0`);
assert.deepEqual(sent.map((x) => x.phase), ['checking', 'downloading', 'downloading', 'downloading', 'ready']);
assert.equal(sent[2].percent, 42);
assert.equal(u.install(), true);
assert.deepEqual(eng.installed, [true, true]);
// a ready update is not looked up again
eng.next = 'same'; s = await u.check();
assert.equal(s.phase, 'ready');

// ---- nothing newer
const eng2 = new FakeEngine(); eng2.next = 'same';
const u2 = createUpdater({ version: '0.3.9', engine: eng2, send() {}, fetch: noNet as any });
s = await u2.check();
assert.equal(s.phase, 'none'); assert.equal(s.available, false);

// ---- an engine error (no release yet, no network) becomes a state, not a throw
const eng3 = new FakeEngine(); eng3.next = 'fail';
const u3 = createUpdater({ version: '0.3.9', engine: eng3, send() {}, fetch: noNet as any });
s = await u3.check();
assert.equal(s.phase, 'error'); assert.equal(s.available, false); assert.match(s.error, /latest\.yml/);

// ---- manual mode: only the GitHub lookup, and no install
const page = `https://github.com/${UPDATE_REPO}/releases/tag/v0.4.0`;
const gh = async () => new Response(JSON.stringify({ tag_name: 'v0.4.0', html_url: page, body: 'Новое' }), { status: 200 });
const u4 = createUpdater({ version: '0.3.9', engine: null, send() {}, fetch: gh as any });
assert.equal(u4.state().mode, 'manual');
s = await u4.check();
assert.equal(s.phase, 'available'); assert.equal(s.available, true); assert.equal(s.url, page);
assert.equal(u4.install(), false);
console.log('auto-update: ok');
