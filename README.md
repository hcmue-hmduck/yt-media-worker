# yt-media-worker — pytubefix VISION_OS

Nhánh `experiment/pytubefix` thử nghiệm riêng **pytubefix VISION_OS**. Cùng API với các nhánh khác.
Đã tải 1080p thành công trên Mac với video `3lH2oqKK-3U`; khả năng tải từ IP Render/Azure cần kiểm chứng riêng.

## Deploy thủ công trên Render

New Web Service → repo `hcmue-hmduck/yt-media-worker` → branch `experiment/pytubefix` → runtime Docker.
Dockerfile: `./Dockerfile`, build context thư mục gốc. Để trống Command override.
Đặt `WORKER_SECRET` là secret ngẫu nhiên ≥32 ký tự. Render cấp biến PORT tự động; Azure dùng target port 8080.
Một instance/replica, không autoscale nhiều bản sao; job và file lưu tạm, mất khi restart/ngủ/deploy.
Chưa xác minh Docker image trên máy local nếu Docker không có; GitHub Actions sẽ kiểm thử và build image.
Workflow nhánh thử nghiệm chỉ build để kiểm chứng, không push image `latest` hoặc tự deploy Azure.

## API

- `GET /health`: trạng thái HTTP server, tên engine và minimumHeight; không chứng minh tải YouTube được.
- `POST /api/jobs`, header `Authorization: Bearer WORKER_SECRET`, body `{"url":"https://www.youtube.com/watch?v=VIDEO_ID","height":1080}` → HTTP 202, `{"jobId":"..."}`.
- `GET /api/jobs/JOB_ID`, cùng header → queued/processing/completed/failed, progress, error, expiresAt và downloadPath khi xong.
- Frontend tải trực tiếp từ URL worker + downloadPath (link token hết hạn), không cần khóa worker.

Mặc định **1080p**, chỉ nhận height 1080; yêu cầu nguồn H.264 MP4 và AAC. Không upscale, không tự hạ chất lượng.
Ghép FFmpeg bằng `-c copy`, kiểm tra file chứa video ≥1080p và audio trước khi hoàn thành.
Video tối đa 30 phút mặc định (`MAX_DURATION_SECONDS=1800`), một job chạy đồng thời, file cuối tối đa 500 MiB.
File hết hạn sau 15 phút, dọn định kỳ 30 giây. Worker từ chối nhận xử lý khi không còn đủ ổ tạm.
Progress là ước lượng; một số engine chỉ cập nhật sau từng stream. Không hỗ trợ resume/HTTP Range.
Không hỗ trợ live, playlist, cookies đăng nhập. Video gốc không có 1080p hoặc bị YouTube chặn sẽ báo lỗi.

Backend chính giữ khóa, xác thực người dùng, áp quota và lưu userId → jobId. Không đưa khóa vào frontend.
Worker loại WORKER_SECRET khỏi môi trường của tiến trình engine. Hàng đợi chưa bền vững, chưa phù hợp chạy nhiều replica.

## Chạy local

Node 24, FFmpeg phải có trên PATH (hoặc đặt FFMPEG_BIN trỏ tới executable).
`npm ci`, rồi thiết lập WORKER_SECRET và `npm start`. Node không tự nạp file .env; có thể dùng `node --env-file=.env index.js`.
Python 3.10+ và `python3 -m pip install -r requirements.txt` trong virtualenv riêng. Dockerfile đã cài đủ.

## Validation

`npm test` dùng engine giả lập để kiểm tra API, xác thực, token tải, giới hạn 1080p và việc không truyền secret vào engine.
API adapter đã hoàn thành bài thử tải thật 1080p local. Chi tiết bằng chứng nằm trong EXPERIMENT.md và validation/local-api.json. Test giả lập không chứng minh truy cập YouTube từ cloud.
