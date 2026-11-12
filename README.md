# YouTube Media Worker

Service nhận URL YouTube, tải hình/tiếng bằng yt-dlp, ghép MP4 bằng FFmpeg và trả link tải tạm thời. Bạn tự tạo và quản lý tài nguyên Azure; source này không gọi API quản trị Azure.

## Nội dung

- `index.js`: HTTP API, hàng đợi một tác vụ mỗi lần, tải/ghép MP4 và dọn file.
- `Dockerfile`: Node 24, Python, yt-dlp với EJS, FFmpeg; chạy bằng user không phải root.
- `package.json`: không cần thư viện npm bên ngoài.
- `test/worker.test.js`: kiểm thử API với yt-dlp giả lập, không gọi YouTube.

## Cấu hình container

- Lệnh chạy: mặc định Dockerfile, `node index.js`.
- Cổng HTTP/target port: `8080`; dùng HTTPS ở ingress của nền tảng.
- `WORKER_SECRET`: bắt buộc, chuỗi bí mật ngẫu nhiên ít nhất 32 ký tự. Đặt dưới dạng secret trên Azure và trong backend chính. Không đưa vào frontend.
- `PORT`: mặc định `8080`.
- `ALLOWED_ORIGIN`: tùy chọn, một origin chính xác nếu cần CORS. Luồng khuyên dùng là backend gọi API, trình duyệt chỉ mở link tải.
- `TMP_DIR`: mặc định `/tmp/media-worker`; chỉ dùng thư mục riêng dành cho service vì khi khởi động service dọn các thư mục `job-` tại đây.

Cấu hình thử nghiệm: 1 vCPU, 2 GiB RAM, min replicas = max replicas = 1, chế độ single revision. Giữ một replica để không scale-to-zero trong lúc chạy tác vụ nền. Đây là cấu hình dùng tài nguyên cả khi rảnh, có thể tiêu thụ credit. Job và file nằm trong RAM/ổ tạm: mất khi restart/deploy/stop. Không tăng replicas cho phiên bản này. Khi phục vụ nhiều người cần hàng đợi, trạng thái và kho file bền vững bên ngoài.

Để triển khai thủ công, build Dockerfile thành image, push lên registry của bạn, rồi chọn image đó khi tạo Container App trong Azure Portal. Nền tảng cần build Dockerfile hoặc nhận container image; chỉ upload file ZIP không tự chạy được ứng dụng.

## Chạy bằng Docker trên máy

Cần Docker đã cài và đang chạy. Thay khóa mẫu bằng khóa ngẫu nhiên riêng, ít nhất 32 ký tự:

```sh
docker build -t media-worker .
docker run --rm -p 8080:8080 -e WORKER_SECRET='THAY_BANG_KHOA_NGAU_NHIEN_IT_NHAT_32_KY_TU' media-worker
```

## API

Các lệnh sau dùng URL local để minh họa; thay bằng URL HTTPS của service khi deploy. Thay khóa trong header bằng khóa bạn đã cấu hình.

### Kiểm tra hoạt động

```sh
curl http://localhost:8080/health
```

Trả về `{"ok":true}`. Endpoint này kiểm tra HTTP server, không xác minh khả năng truy cập YouTube.

### Tạo job (gọi từ backend)

```sh
curl http://localhost:8080/api/jobs \
  -H 'Authorization: Bearer THAY_BANG_KHOA_CUA_BAN' \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://www.youtube.com/watch?v=VIDEO_ID","height":720}'
```

Thay VIDEO_ID bằng ID video thực (11 ký tự). Trả HTTP 202 và `{"jobId":"..."}`. `height` có thể là 360, 480, 720 hoặc 1080; mặc định 720. Đây là mức trần chất lượng.

### Hỏi trạng thái (gọi từ backend, mỗi 2–3 giây)

```sh
curl http://localhost:8080/api/jobs/JOB_ID \
  -H 'Authorization: Bearer THAY_BANG_KHOA_CUA_BAN'
```

Trạng thái: `queued`, `processing`, `completed`, `failed`.

```json
{
  "jobId": "...",
  "status": "completed",
  "progress": 100,
  "expiresAt": 1800000000000,
  "downloadPath": "/api/jobs/.../download?token=..."
}
```

`expiresAt` là Unix timestamp mili giây. Khi lỗi, có trường `error`. Phần trăm là của từng luồng tải; có thể giảm khi chuyển từ hình sang tiếng.

### Tải file (trình duyệt)

Backend ghép URL gốc của worker và `downloadPath`, gửi link cho frontend. Mở link này để tải MP4; không cần khóa worker. Ai có link đều có quyền tải cho đến khi hết hạn, nên tránh ghi link vào log hoặc chia sẻ công khai. File được giữ để có thể thử tải lại, không xóa ngay sau một lượt tải. Không hỗ trợ HTTP Range/resume.

Backend chính phải xác thực người dùng, áp quota, lưu ánh xạ userId → jobId và kiểm tra quyền sở hữu khi hỏi trạng thái. Worker dùng một khóa chung dành cho backend tin cậy, chưa có tài khoản/quota riêng cho từng người dùng.

## Giới hạn và xử lý lỗi

- Một tác vụ chạy đồng thời, tối đa 30 job đang lưu (kể cả job đã xong).
- Chỉ nhận link HTTPS của một video YouTube; không nhận playlist hoặc URL máy chủ tùy ý.
- Video tối đa 20 phút; không hỗ trợ livestream, video từng livestream hay video cần đăng nhập.
- Ưu tiên H.264 MP4 + AAC; có thể thất bại nếu nguồn không có định dạng phù hợp.
- Mỗi stream tải tối đa 500 MiB; file kết quả tối đa 500 MiB. Ghép cần thêm dung lượng tạm.
- Bước đọc thông tin timeout 2 phút; bước tải/ghép timeout 15 phút.
- File hết hạn 15 phút sau hoàn thành; dọn định kỳ 30 giây, chờ lượt tải đang mở kết thúc.
- YouTube có thể chặn IP cloud; không bảo đảm mọi video đều tải được. Chưa hỗ trợ cookies.
- Không có phục hồi job/retry bền vững khi tiến trình chết. Chưa có tính năng hủy job.

## Kiểm thử

Node >=22:

```sh
npm test
```

Test dùng chương trình tải giả lập để kiểm tra xác thực, chặn URL sai, hoàn tất job và tải bằng token. Chưa xác minh Docker build, tải YouTube thật hoặc vận hành Azure. Dockerfile cài yt-dlp tại thời điểm build, nên cần kiểm chứng tải thực tế sau mỗi lần build/cập nhật.
