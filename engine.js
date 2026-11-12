import { Innertube, Platform, Log } from 'youtubei.js';
import { runInNewContext } from 'node:vm';
import { argumentsForEngine, metadata, validateMetadata, saveStream, merge, fail } from './media-utils.js';

Log.setLevel(Log.Level.NONE);
Platform.shim.eval = async data => runInNewContext(data.output, {}, { timeout: 10000 });
try {
  const request = argumentsForEngine();
  const yt = await Innertube.create({ fetch: (input, init = {}) => fetch(input, {
    ...init, signal: AbortSignal.any([AbortSignal.timeout(45000), ...(init.signal ? [init.signal] : [])])
  }) });
  const info = await yt.getBasicInfo(request.videoId, { client: 'VISIONOS' });
  if (info.playability_status?.status !== 'OK') throw new Error('YouTube refused playback: ' + (info.playability_status?.reason || info.playability_status?.status));
  const details = metadata(info);
  validateMetadata(details);
  if (request.mode === 'metadata') console.log(JSON.stringify(details));
  else {
    const videoOptions = { type: 'video', quality: '1080p', format: 'mp4', codec: 'avc1' };
    const audioOptions = { type: 'audio', quality: 'best', format: 'mp4', language: 'original' };
    const video = info.chooseFormat(videoOptions), audio = info.chooseFormat(audioOptions);
    if (video.height !== 1080) throw new Error('1080p H.264 is not available');
    await saveStream(await info.download(videoOptions), `${request.directory}/video-only.mp4`, video.content_length, 0, 55);
    await saveStream(await info.download(audioOptions), `${request.directory}/audio.m4a`, audio.content_length, 55, 90);
    await merge(request.directory, request.height);
  }
} catch (error) { fail(error); }
