import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

test('authentication, URL validation, job completion and protected file download', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'media-test-'));
  const fake = join(dir, 'yt-dlp');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--dump-single-json')) console.log(JSON.stringify({duration:60}));
else { fs.writeFileSync(args[args.indexOf('-o')+1].replace('%(ext)s','mp4'), 'test-video'); console.log('download:100%'); }
`, { mode: 0o755 });
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const secret = 'test-secret-with-more-than-32-characters';
  const child = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, WORKER_SECRET: secret, PORT: String(port), YTDLP_BIN: fake, TMP_DIR: join(dir, 'files') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(ready, logs);
  assert.equal((await fetch(base + '/api/jobs', { method: 'POST' })).status, 401);
  for (const url of ['http://youtube.com/watch?v=abcdefghijk', 'https://localhost/video', 'https://youtube.com.evil.test/watch?v=abcdefghijk']) {
    assert.equal((await fetch(base + '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ url }) })).status, 400);
  }
  const response = await fetch(base + '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ url: 'https://youtu.be/abcdefghijk', height: 720 }) });
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  let job;
  for (let i = 0; i < 100; i++) {
    job = await (await fetch(base + '/api/jobs/' + jobId, { headers })).json();
    if (['completed', 'failed'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'completed', JSON.stringify(job) + logs);
  assert.equal((await fetch(base + '/api/jobs/' + jobId + '/download?token=wrong')).status, 404);
  const file = await fetch(base + job.downloadPath);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /attachment/);
  assert.equal(await file.text(), 'test-video');
});
