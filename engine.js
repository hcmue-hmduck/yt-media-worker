import { Innertube, Platform, Log, Constants, YTNodes } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, Logger } from 'googlevideo/utils';
import { runInNewContext } from 'node:vm';
import { getWebPoMinter } from './vendor/webpo-helper.js';
import { argumentsForEngine, metadata, validateMetadata, saveStream, merge, fail } from './media-utils.js';

Log.setLevel(Log.Level.NONE);
Logger.getInstance().setLogLevels();
// youtubei.js 18.2 emits a Function body with a top-level return.
Platform.shim.eval = async data => runInNewContext(`(function () { ${data.output}\n})()`, {}, { timeout: 10000 });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => originalFetch(input, { ...init,
  signal: AbortSignal.any([AbortSignal.timeout(45000), ...(init.signal ? [init.signal] : [])]) });
let stream;
try {
  const request = argumentsForEngine();
  const yt = await Innertube.create();
  const playerRequest = reload => new YTNodes.NavigationEndpoint({ watchEndpoint: { videoId: request.videoId } }).call(yt.actions, {
    client: 'WEB', parse: true, contentCheckOk: true, racyCheckOk: true,
    playbackContext: { contentPlaybackContext: { vis: 0, splay: false, signatureTimestamp: yt.session.player?.signature_timestamp },
      ...(reload ? { reloadPlaybackContext: reload } : {}) }
  });
  const response = await playerRequest();
  if (response.playability_status?.status !== 'OK') throw new Error('YouTube refused playback: ' + response.playability_status?.status);
  const details = { title: response.video_details?.title, duration: response.video_details?.duration,
    is_live: !!response.video_details?.is_live, was_live: !!response.video_details?.is_post_live_dvr };
  validateMetadata(details);
  if (request.mode === 'metadata') console.log(JSON.stringify(details));
  else {
    const minter = await getWebPoMinter();
    const playback = async data => ({
      serverAbrStreamingUrl: await yt.session.player.decipher(data.streaming_data?.server_abr_streaming_url),
      videoPlaybackUstreamerConfig: data.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
    });
    const config = await playback(response);
    if (!config.videoPlaybackUstreamerConfig) throw new Error('Missing SABR playback configuration');
    stream = new SabrStream({ videoId: request.videoId,
      formats: response.streaming_data.adaptive_formats.map(buildSabrFormat), ...config,
      clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS[yt.session.context.client.clientName]), clientVersion: yt.session.context.client.clientVersion },
      callbacks: { onMintPoToken: () => minter.mint(request.videoId),
        onReloadPlayerResponse: async reload => playback(await playerRequest(reload)) }
    });
    const result = stream.start({
      videoPreferences: { container: 'mp4', quality: '1080p', preferredVideoCodec: 'h264' },
      audioPreferences: { container: 'mp4', preferredAudioCodec: 'aac', dynamicRangeCompression: false, voiceBoost: false },
      maxRetries: 2, stallDetectionMs: 30000, isPostLiveDvr: false
    });
    if (result.selectedFormats.videoFormat?.height !== 1080) throw new Error('1080p is not available');
    // SABR tracks arrive concurrently; the server keeps the progress estimate monotonic.
    await Promise.all([
      saveStream(result.videoStream, `${request.directory}/video-only.mp4`, result.selectedFormats.videoFormat.contentLength, 0, 90),
      saveStream(result.audioStream, `${request.directory}/audio.m4a`, result.selectedFormats.audioFormat.contentLength, 0, 90)
    ]);
    await merge(request.directory, request.height);
  }
} catch (error) { fail(error); }
finally { if (stream) await stream.abort(); process.exit(process.exitCode || 0); }
