// Single-replica prototype. Jobs and files are intentionally ephemeral.
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const secret = process.env.WORKER_SECRET;
if (!secret || secret.length < 32) throw new Error('WORKER_SECRET must contain at least 32 characters');
const root = process.env.TMP_DIR || '/tmp/media-worker';
await mkdir(root, { recursive: true });
const jobs = new Map();
const queue = [];
let busy = false;
const ttl = 15 * 60_000;
const maxBytes = 500 * 1024 * 1024;
const allowedOrigin = process.env.ALLOWED_ORIGIN;
const executable = process.env.YTDLP_BIN || 'yt-dlp';

function equal(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function canonicalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error();
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error();
  return `https://www.youtube.com/watch?v=${id}`;
}
function run(args, job, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--ignore-config', '--no-playlist', '--js-runtimes', 'node', ...args, '--', job.url], { detached: true });
    job.child = child;
    let output = '';
    let error = '';
    let failure;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { failure = new Error('Processing timed out'); kill(); }, timeout);
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-1_000_000);
      const progress = [...output.matchAll(/download:\s*([\d.]+)%/g)].at(-1);
      if (progress) job.progress = Math.min(99, Number(progress[1]));
    });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      job.child = undefined;
      if (failure || code !== 0) {
        console.error('job failed', job.id, error);
        reject(failure || new Error('Video download failed; check worker logs'));
      } else resolve(output);
    });
  });
}
async function work() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  job.status = 'processing';
  try {
    const metadata = JSON.parse(await run(['--dump-single-json', '--skip-download', '--socket-timeout', '20'], job, 120_000));
    if (metadata.is_live || metadata.was_live || !metadata.duration || metadata.duration > 1200) {
      throw new Error('Only non-live videos up to 20 minutes are supported');
    }
    job.dir = await mkdtemp(join(root, 'job-'));
    await run([
      '-f', `bv[ext=mp4][vcodec^=avc1][height<=${job.height}]+ba[ext=m4a]/b[ext=mp4][height<=${job.height}]`,
      '--merge-output-format', 'mp4', '--max-filesize', String(maxBytes),
      '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2',
      '--newline', '--progress-template', 'download:%(progress._percent_str)s',
      '-o', join(job.dir, 'video.%(ext)s'),
    ], job, 15 * 60_000);
    job.file = join(job.dir, 'video.mp4');
    const info = await stat(job.file);
    if (!info.size || info.size > maxBytes) throw new Error('Output exceeds the 500 MiB limit');
    job.size = info.size;
    job.status = 'completed';
    job.progress = 100;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    if (job.dir) await rm(job.dir, { recursive: true, force: true });
  } finally {
    job.expiresAt = Date.now() + ttl;
    busy = false;
    void work();
  }
}
// Remove files left behind by a previous process. Use a dedicated TMP_DIR.
for (const name of await readdir(root)) {
  if (name.startsWith('job-')) await rm(join(root, name), { recursive: true, force: true });
}
setInterval(async () => {
  for (const [id, job] of jobs) {
    if (job.expiresAt && Date.now() > job.expiresAt && !job.readers) {
      if (job.dir) await rm(job.dir, { recursive: true, force: true });
      jobs.delete(id);
    }
  }
}, 30_000).unref();

const server = http.createServer(async (req, res) => {
  try {
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    const match = /^\/api\/jobs\/([a-f0-9-]+)(\/download)?$/.exec(url.pathname);
    if (match?.[2] && req.method === 'GET') {
      const job = jobs.get(match[1]);
      if (!job || !equal(url.searchParams.get('token'), job.token)) return json(res, 404, { error: 'Not found' });
      if (job.status !== 'completed') return json(res, 409, { error: 'File is not ready' });
      if (Date.now() > job.expiresAt) return json(res, 410, { error: 'File expired' });
      job.readers = (job.readers || 0) + 1;
      try {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': job.size, 'Content-Disposition': 'attachment; filename="video.mp4"', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        await pipeline(createReadStream(job.file), res);
      } finally { job.readers--; }
      return;
    }
    if (!equal(req.headers.authorization, `Bearer ${secret}`)) return json(res, 401, { error: 'Unauthorized' });
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      if (jobs.size >= 30) return json(res, 429, { error: 'Queue is full; retry later' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) return json(res, 413, { error: 'Body too large' });
      }
      let data, videoUrl;
      try { data = JSON.parse(body); videoUrl = canonicalUrl(data.url); }
      catch { return json(res, 400, { error: 'A valid HTTPS YouTube video URL is required' }); }
      const height = data.height ?? 720;
      if (![360, 480, 720, 1080].includes(height)) return json(res, 400, { error: 'Invalid height' });
      const job = { id: randomUUID(), token: randomBytes(32).toString('hex'), url: videoUrl, height, status: 'queued', progress: 0 };
      jobs.set(job.id, job);
      queue.push(job);
      json(res, 202, { jobId: job.id });
      void work();
      return;
    }
    if (req.method === 'GET' && match && !match[2]) {
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { error: 'Not found' });
      return json(res, 200, {
        jobId: job.id, status: job.status, progress: job.progress, error: job.error,
        expiresAt: job.expiresAt,
        downloadPath: job.status === 'completed' ? `/api/jobs/${job.id}/download?token=${job.token}` : undefined,
      });
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    else res.destroy();
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
process.on('SIGTERM', () => {
  for (const job of jobs.values()) {
    if (job.child?.pid) { try { process.kill(-job.child.pid, 'SIGKILL'); } catch {} }
  }
  server.close();
  setTimeout(() => process.exit(0), 5000).unref();
});
