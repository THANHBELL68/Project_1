# Báo cáo kết quả dự án "EduTM - Cổng thời gian tri thức" (Web gặp lại người ở thời lịch sử)

Chúng tôi đã triển khai hoàn chỉnh toàn bộ mã nguồn của dự án dựa trên kế hoạch đã đề ra. Dưới đây là thông tin tổng kết về các cấu phần, tính năng đã xây dựng và kết quả kiểm thử.

---

## 🛠️ Các cấu phần đã hoàn thành

1. **Backend & Database**:
   - [app.py](file:///c:/Project/app.py): Điều hướng các API Endpoints, quản lý session đăng nhập, phân quyền, kết nối Gemini API phục vụ trò chuyện nhập vai và xử lý CRUD của Admin.
   - [database.py](file:///c:/Project/database.py): Cấu hình cơ sở dữ liệu SQLite, thiết lập schema cho người dùng, nhân vật, bài giảng và lịch sử chat. Tự động khởi tạo dữ liệu mẫu cho hai vĩ nhân: **Albert Einstein** và **Trần Hưng Đạo**.
   - [requirements.txt](file:///c:/Project/requirements.txt) & [.env](file:///c:/Project/.env): Danh sách thư viện Python cần thiết và tệp mẫu biến môi trường.

2. **Frontend UI/UX**:
   - [style.css](file:///c:/Project/static/css/style.css): Toàn bộ phong cách thiết kế Glassmorphism & Dark Mode hiện đại, các hiệu ứng nhấp nháy phát sáng khi nói chuyện và sóng âm trực quan sinh động.
   - [app.js](file:///c:/Project/static/js/app.js): Xử lý micro thu âm chuyển thành chữ (Speech-to-Text), đọc bài giảng (Text-to-Speech), hiệu ứng chữ chạy word-by-word và hiển thị các câu hỏi gợi ý thông minh (Suggested Chips).
   - [admin.js](file:///c:/Project/static/js/admin.js): Quản lý các popup modal tạo/sửa đổi nhân vật lịch sử và các dòng kiến thức mới.
   - [base.html](file:///c:/Project/templates/base.html), [login.html](file:///c:/Project/templates/login.html), [register.html](file:///c:/Project/templates/register.html), [index.html](file:///c:/Project/templates/index.html), [chat.html](file:///c:/Project/templates/chat.html), [admin.html](file:///c:/Project/templates/admin.html): Các template HTML được biên dịch động bằng Jinja2.

3. **Thiết kế hình ảnh (Avatars)**:
   - Đã tạo ra các ảnh chân dung chất lượng cao cho Albert Einstein, Trần Hưng Đạo và ảnh đại diện cổng thời gian mặc định.

---

## 🎥 Kết quả kiểm thử & Trải nghiệm thực tế

Máy chủ Flask đã hoạt động ổn định cục bộ. Chúng tôi đã tiến hành kiểm thử toàn bộ hành trình của người dùng cuối cũng như quản trị viên.

### Video ghi lại toàn bộ quy trình trải nghiệm:
![Quy trình đăng ký, trò chuyện với Einstein và quản lý admin](C:\Users\thanh\.gemini\antigravity-ide\brain\2d9bce2c-8538-4c96-a090-9dbcc19fe4b7\app_workflow_demo_1784019970625.webp)

---

### Ảnh chụp màn hình các giao diện chính:

````carousel
![Giao diện phòng trò chuyện tương tác với Einstein](C:\Users\thanh\.gemini\antigravity-ide\brain\2d9bce2c-8538-4c96-a090-9dbcc19fe4b7\chat_screen_1784020135045.png)
<!-- slide -->
![Bảng điều khiển quản trị CRUD nhân vật lịch sử](C:\Users\thanh\.gemini\antigravity-ide\brain\2d9bce2c-8538-4c96-a090-9dbcc19fe4b7\admin_panel_1784020183504.png)
````

---

## 💡 Hướng dẫn cấu hình và chạy dự án

1. **Khởi động Server**:
   Chạy lệnh sau trong thư mục `c:\Project`:
   ```bash
   python app.py
   ```
   Ứng dụng sẽ hoạt động tại địa chỉ: `http://127.0.0.1:5000`

2. **Tài khoản kiểm thử**:
   - **Tài khoản học sinh (Student)**: 
     - Username: `student`
     - Mật khẩu: `student123`
     *(Hoặc bạn có thể tự đăng ký tài khoản mới trực tiếp)*
   - **Tài khoản quản trị viên (Admin)**:
     - Username: `admin`
     - Mật khẩu: `admin123`

3. **Cấu hình Gemini API**:
   Vui lòng mở tệp [.env](file:///c:/Project/.env) và dán API Key của bạn vào dòng `GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE` để kích hoạt hoàn toàn trí não AI cho các vĩ nhân.
