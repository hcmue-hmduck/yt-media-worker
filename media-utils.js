import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const maxBytes = 500 * 1024 * 1024;
export const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
export function metadata(info) {
  return { title: info.basic_info.title, duration: info.basic_info.duration,
    is_live: !!info.basic_info.is_live, was_live: !!info.basic_info.is_post_live_dvr };
}
export function validateMetadata(info) {
  const duration = info.duration;
  if (info.is_live || info.was_live || !Number.isFinite(duration) || duration <= 0 || duration > Number(process.env.MAX_DURATION_SECONDS || 1800)) {
    throw new Error('Only non-live videos within MAX_DURATION_SECONDS are supported');
  }
}
export function progress(value) { console.log(`download:${Math.max(0, Math.min(99, Math.floor(value)))}%`); }
export async function saveStream(input, path, expectedBytes, start, end) {
  if (expectedBytes > maxBytes) throw new Error('Stream exceeds 500 MiB');
  let bytes = 0, last = -1;
  const limit = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (expectedBytes) {
      const pct = Math.floor(start + (end - start) * bytes / expectedBytes);
      if (pct > last) { progress(pct); last = pct; }
    }
    callback(bytes > maxBytes ? new Error('Stream exceeds 500 MiB') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(input), limit, createWriteStream(path));
  if (!bytes || (expectedBytes && bytes !== expectedBytes)) throw new Error('Incomplete media stream');
}
export function execute(binary, args, onStdout) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-1000000); onStdout?.(data); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(
      stderr.replace(/https?:\/\/\S+/g, '[URL]').slice(-1500) || `${binary} exited with code ${code}`)));
  });
}
export async function verify(path, height) {
  const info = await stat(path);
  if (!info.size || info.size > maxBytes) throw new Error('Output must be between 1 byte and 500 MiB');
  const { stderr } = await execute(ffmpeg, ['-hide_banner', '-nostdin', '-i', path,
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'null', '-']);
  const dimensions = /Video:.*?(\d{3,5})x(\d{3,5})/.exec(stderr);
  if (!dimensions || Number(dimensions[2]) < height || !stderr.includes('Audio:')) {
    throw new Error('Output does not contain the required 1080p video and audio');
  }
}
export async function merge(directory, height) {
  const video = `${directory}/video-only.mp4`, audio = `${directory}/audio.m4a`, output = `${directory}/video.mp4`;
  progress(92);
  await execute(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', output]);
  await verify(output, height);
  await Promise.all([unlink(video), unlink(audio)]);
}
export function argumentsForEngine() {
  const [mode, ...args] = process.argv.slice(2);
  const url = args.at(-1);
  const directory = mode === 'download' ? args[0] : undefined;
  const height = mode === 'download' ? Number(args[1]) : 1080;
  if (!['metadata', 'download'].includes(mode) || !url || height !== 1080) throw new Error('Invalid engine invocation');
  return { mode, url, directory, height, videoId: new URL(url).searchParams.get('v') };
}
export function fail(error) {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(-2000));
  process.exitCode = 1;
}
