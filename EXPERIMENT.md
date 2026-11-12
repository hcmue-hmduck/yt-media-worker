# Local experiment: yt-dlp

Test ngày 12/11/2026 trên Mac, video https://www.youtube.com/watch?v=3lH2oqKK-3U.
Nguồn dài khoảng 21m12s, H.264 1920×1080; tải riêng hình/tiếng, ghép FFmpeg không encode lại.
Phương án yt-dlp đã có file hoàn chỉnh có tiếng; kiểm tra toàn bộ bằng FFmpeg -xerror đạt exit code 0.
Không dùng cookies tài khoản hoặc proxy. SABR dùng token khách tạo tự động theo helper của googlevideo.
Kết quả gốc là bài thử local; API adapter trong nhánh này đã chạy kiểm thử tích hợp local: POST tạo job trả 202, job completed, GET file trả 200; file 1920×1080 có tiếng được giải mã toàn bộ với exit code 0. Chi tiết tại validation/local-api.json.
Chưa xác nhận tải được từ IP Render/Azure. Không có video, cookies hoặc credentials được commit.
