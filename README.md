# Panelo

**Thư viện đi theo bạn. Lưu ở đâu, đọc ở đó.**

Panelo là ứng dụng đọc webtoon/manga chạy thẳng trong trình duyệt, đọc ảnh
trực tiếp từ máy tính hoặc Google Drive của bạn — **không upload, không máy
chủ trung gian, không cần tài khoản.**

---

## ✨ Tính năng chính

- 📂 **Đọc từ máy tính** (Chrome/Edge đọc + ghi đầy đủ) hoặc **☁️ Google Drive**
  (dùng API key, không cần đăng nhập)
- ⚙️ **Tuỳ chỉnh cấu trúc thư mục** — không bắt buộc theo đúng 1 khuôn mẫu
- 📖 2 chế độ đọc: **cuộn dọc** (webtoon) hoặc **lật trang** (manga, xem được
  1–3 trang cùng lúc, chọn hướng đọc trái↔phải)
- ⭐ Yêu thích, sắp xếp thư viện, đánh dấu đã đọc từng chapter
- 🎨 Đổi màu giao diện + ảnh nền riêng
- 💾 Xuất/nhập backup toàn bộ cấu hình ra 1 file
- 📱 Giao diện tối ưu riêng cho mobile (tự nhận diện hoặc chọn tay)

## 🚀 Bắt đầu dùng

Không cần cài đặt, không cần build:

1. Tải toàn bộ repo về máy
2. Mở file `index.html` bằng **Chrome hoặc Edge** (khuyến nghị, hỗ trợ đầy đủ)
3. Bấm **✨ Khởi tạo thư viện** để tạo thư mục mẫu, hoặc **☁️** để kết nối
   Google Drive có sẵn

> Firefox/Safari/mobile vẫn dùng được, nhưng ở chế độ chỉ đọc (do giới hạn
> của trình duyệt, không phải lỗi của app).

## 📁 Cấu trúc thư mục mặc định

```
DATA/
└── Project/
    └── Tên truyện/
        ├── About/
        │   ├── info.json        # tiêu đề, tác giả, thể loại, mô tả...
        │   └── thumbnail.jpg    # ảnh bìa
        └── Chapter/
            ├── Chapter 001/
            │   ├── 001.jpg
            │   └── 002.jpg
            └── Chapter 002/
                └── ...
```

Không đúng cấu trúc này cũng không sao — vào ⚙️ **Cấu trúc thư mục** trong
app để tự đặt lại tên các cấp cho khớp thư viện của bạn.


## 🔒 Quyền riêng tư

Panelo không gửi dữ liệu đi đâu cả. Mọi thứ (thư mục đã chọn, tiến độ đọc,
yêu thích, cấu hình...) chỉ lưu trên trình duyệt của chính bạn.

---

Made with 💜 by **Maditor**
