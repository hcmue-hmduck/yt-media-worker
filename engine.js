import { argumentsForEngine, validateMetadata, execute, verify, fail, maxBytes, ffmpeg } from './media-utils.js';
try {
  const request = argumentsForEngine();
  const binary = process.env.YTDLP_BIN || 'yt-dlp';
  const shared = ['--ignore-config', '--no-cache-dir', '--no-plugin-dirs', '--no-playlist', '--js-runtimes', 'node', '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1'];
  const result = await execute(binary, [...shared, '--dump-single-json', '--skip-download', '--', request.url]);
  const info = JSON.parse(result.stdout);
  validateMetadata(info);
  if (request.mode === 'metadata') console.log(JSON.stringify({ title: info.title, duration: info.duration, is_live: info.is_live, was_live: info.was_live }));
  else {
    await execute(binary, [...shared, '-f', 'bv[height=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]',
      '--ffmpeg-location', ffmpeg, '--merge-output-format', 'mp4', '--max-filesize', String(maxBytes),
      '--newline', '--progress-template', 'download:%(progress._percent_str)s',
      '-o', `${request.directory}/video.%(ext)s`, '--', request.url], data => process.stdout.write(data));
    await verify(`${request.directory}/video.mp4`, request.height);
  }
} catch (error) { fail(error); }
