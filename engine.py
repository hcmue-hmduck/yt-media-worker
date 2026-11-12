import json
import os
import re
import ssl
import subprocess
import sys
from pathlib import Path
import certifi
from pytubefix import YouTube

ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())
MAX_BYTES = 500 * 1024 * 1024
def main():
    mode = sys.argv[1]
    url = sys.argv[-1]
    yt = YouTube(url, client='VISION_OS')
    duration = yt.length
    if yt.vid_info.get('videoDetails', {}).get('isLiveContent') or not duration or duration > int(os.environ.get('MAX_DURATION_SECONDS', '1800')):
        raise ValueError('Only non-live videos within MAX_DURATION_SECONDS are supported')
    if mode == 'metadata':
        print(json.dumps({'title': yt.title, 'duration': duration, 'is_live': False, 'was_live': False}))
        return
    directory = Path(sys.argv[2])
    height = int(sys.argv[3])
    if mode != 'download' or height != 1080:
        raise ValueError('Invalid engine invocation')
    video = yt.streams.filter(res='1080p', file_extension='mp4', only_video=True).first()
    audio = yt.streams.filter(only_audio=True, file_extension='mp4').order_by('abr').desc().first()
    if not video or not audio:
        raise ValueError('1080p MP4 video and AAC audio are required')
    for stream, name, pct in [(video, 'video-only.mp4', 55), (audio, 'audio.m4a', 90)]:
        if stream.filesize > MAX_BYTES:
            raise ValueError('Stream exceeds 500 MiB')
        stream.download(output_path=str(directory), filename=name, timeout=30, max_retries=1)
        if (directory / name).stat().st_size != stream.filesize:
            raise ValueError('Incomplete stream')
        print(f'download:{pct}%', flush=True)
    ffmpeg = os.environ.get('FFMPEG_BIN', 'ffmpeg')
    out = directory / 'video.mp4'
    def run(arguments):
        result = subprocess.run([ffmpeg, *arguments], capture_output=True, text=True)
        if result.returncode:
            raise ValueError(result.stderr[-1500:])
        return result.stderr
    run(['-v', 'error', '-nostdin', '-y', '-i', str(directory/'video-only.mp4'), '-i', str(directory/'audio.m4a'),
         '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', str(out)])
    if not 0 < out.stat().st_size <= MAX_BYTES:
        raise ValueError('Output exceeds 500 MiB')
    details = run(['-hide_banner', '-nostdin', '-i', str(out), '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'null', '-'])
    match = re.search(r'Video:.*?(\d{3,5})x(\d{3,5})', details)
    if not match or int(match[2]) < height or 'Audio:' not in details:
        raise ValueError('Output must contain 1080p video and audio')
    (directory/'video-only.mp4').unlink()
    (directory/'audio.m4a').unlink()

try:
    main()
except Exception as error:
    print(re.sub(r'https?://\S+', '[URL]', str(error))[-2000:], file=sys.stderr)
    sys.exit(1)
