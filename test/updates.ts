/* The update check: version comparison and what it makes of GitHub's answers. */
import assert from 'node:assert/strict';
import { checkForUpdate, isNewer, parseVersion, UPDATE_REPO } from '../src/updates.ts';

assert.deepEqual(parseVersion('v0.4.0'), [0, 4, 0]);
assert.deepEqual(parseVersion('1.2'), [1, 2, 0]);
assert.equal(parseVersion('latest'), null);
assert.equal(isNewer('0.4.0', '0.3.9'), true);
assert.equal(isNewer('0.3.10', '0.3.9'), true); // numbers, not text: 10 > 9
assert.equal(isNewer('1.0.0', '0.99.99'), true);
assert.equal(isNewer('0.3.9', '0.3.9'), false);
assert.equal(isNewer('0.3.8', '0.3.9'), false);
assert.equal(isNewer('garbage', '0.3.9'), false);

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
const page = `https://github.com/${UPDATE_REPO}/releases/tag/v0.4.0`;

let r = await checkForUpdate('0.3.9', reply(200, { tag_name: 'v0.4.0', html_url: page, body: 'Новое\r\nокно эффектов' }));
assert.equal(r.available, true);
assert.equal(r.latest, '0.4.0');
assert.equal(r.url, page);
assert.equal(r.notes, 'Новое\nокно эффектов');

r = await checkForUpdate('0.4.0', reply(200, { tag_name: 'v0.4.0', html_url: page }));
assert.equal(r.available, false); // already on it

r = await checkForUpdate('0.3.9', reply(404, { message: 'Not Found' }));
assert.equal(r.available, false); // repository has no release yet
assert.equal(r.latest, '');

// A link that does not point into the repository is not passed on.
r = await checkForUpdate('0.3.9', reply(200, { tag_name: 'v0.5.0', html_url: 'https://evil.example/x' }));
assert.equal(r.available, true);
assert.equal(r.url, `https://github.com/${UPDATE_REPO}/releases`);

await assert.rejects(checkForUpdate('0.3.9', reply(500, {})), /500/);
console.log('updates: ok');
