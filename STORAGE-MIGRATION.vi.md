# Lưu metadata ảnh riêng và R2 tùy chọn

Bản sửa này giữ nguyên ảnh, UUID, thumbnail, thứ tự/index, tham số sinh ảnh và
các trường metadata chưa biết. Chỉ `jiuguanStorage` được chuyển khỏi settings;
IndexedDB, preset, Vibe và cấu hình nhà cung cấp vẫn dùng cơ chế hiện tại.

## Cài trên VPS của bạn

Đóng tất cả tab SillyTavern trên mọi thiết bị trước khi cập nhật. Dừng tiến trình
SillyTavern bằng trình quản lý bạn đang dùng, rồi sao lưu khi server đã dừng:

```bash
cd /root/SillyTavern
backup_dir="/root/chatu8-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
cp -a data/sui/settings.json "$backup_dir/"
cp -a data/sui/extensions/st-chatu8 "$backup_dir/extension"
cp -a data/sui/user/images "$backup_dir/images"
cp -a config.yaml "$backup_dir/"
# Nếu đã có kho riêng từ lần cài trước, sao lưu cả data/sui/chatu8-storage.
if [ -d data/sui/chatu8-storage ]; then
    cp -a data/sui/chatu8-storage "$backup_dir/"
fi
```

Cập nhật checkout extension tới commit/nhánh chứa bản sửa này. Nếu có file đã
chỉnh riêng, xem `git status` và xử lý trước; không dùng reset hoặc clean để ép:

```bash
cd /root/SillyTavern/data/sui/extensions/st-chatu8
git status --short
git fetch origin
git switch --track origin/feat/per-user-image-storage
mkdir -p /root/SillyTavern/plugins/chatu8-storage
cp -a plugins/chatu8-storage/. /root/SillyTavern/plugins/chatu8-storage/
cp -a LICENSE /root/SillyTavern/plugins/chatu8-storage/LICENSE
```

Nếu nhánh đã tồn tại ở máy, dùng `git switch feat/per-user-image-storage` rồi
`git pull --ff-only`. Sau khi bản sửa được merge, có thể cập nhật nhánh main
thay thế. Phần server phải được chép lại khi cập nhật phần này của extension.

Trong `/root/SillyTavern/config.yaml`, bật `enableServerPlugins: true` nếu chưa
bật; giữ nguyên các cài đặt khác. Khởi động lại SillyTavern, rồi mở **một tab**
và tải lại hoàn toàn trang. Server plugin dùng cơ chế plugin của SillyTavern:
[hướng dẫn chính thức](https://docs.sillytavern.app/for-contributors/server-plugins/).

Nginx tại `sui-st.com` tiếp tục chuyển tiếp `/api/plugins/chatu8-storage/` tới
cùng SillyTavern như các API khác. Không tạo location công khai trỏ tới
`data/sui/chatu8-storage`. Nếu cấu hình Nginx của bạn có giới hạn body quá nhỏ
và gặp 413 khi chuyển metadata, tăng `client_max_body_size` trong server block
hiện có tới mức phù hợp, ví dụ `80m`, kiểm tra `nginx -t` rồi reload Nginx.
Không cần sửa Nginx nếu API đang nhận được dữ liệu. Plugin giới hạn metadata
64 MiB; giới hạn nhỏ hơn của SillyTavern/Nginx vẫn có hiệu lực.

## Di chuyển và xác nhận

Lần đầu mở bản mới, extension thực hiện:

1. Đọc `jiuguanStorage` cũ. Nếu nó rỗng, đọc bản metadata ảnh ẩn cũ.
   Lỗi đọc/giải mã bản này dừng di chuyển; HTTP 404 được coi là chưa có bản cũ.
2. Server ghi bản sao chính xác vào `backups/legacy-*.json`, sau đó ghi
   `metadata.json` bằng file tạm, đồng bộ xuống đĩa rồi đổi tên.
3. Trình duyệt đọc lại bản đã lưu và so sánh. Chỉ sau khi xác nhận mới bỏ
   `jiuguanStorage` khỏi settings trong bộ nhớ và yêu cầu SillyTavern lưu settings.
4. Settings giữ dấu `imageMetadataStorage: "server-v1"`. Không còn sao chép kho
   ảnh vào settings mỗi lần đổi index. Bản ảnh ẩn cũ được giữ nguyên, không tiếp
   tục cập nhật hoặc tự khôi phục đè lên kho mới.

Vị trí dữ liệu cho tài khoản `sui`:

```text
/root/SillyTavern/data/sui/chatu8-storage/
  metadata.json           # {version, revision, data, r2Enabled, migrationBackup}
  backups/                # legacy vĩnh viễn + 10 snapshot revision gần nhất
  r2-config.json          # tùy chọn, tạo riêng trên server; chứa khóa bí mật
  r2-manifest.json        # ánh xạ bản sao R2; không chứa khóa
```

Đường dẫn người dùng lấy từ phiên đăng nhập của SillyTavern, không nhận user
hoặc đường dẫn thư mục từ trình duyệt. Mỗi tài khoản có kho và toggle riêng.
Chỉ chạy một tiến trình SillyTavern ghi vào cùng thư mục dữ liệu; hàng đợi khóa
trong plugin không hỗ trợ nhiều worker/container cùng ghi một volume.

Trong Core settings, mục **Image metadata and optional R2 copies** phải báo
`Server metadata active. R2 OFF.`. Kiểm tra gallery, Character Photo, thumbnail,
ảnh đang chọn, chuyển index rồi tải lại để xác nhận. So sánh số mục trong
`metadata.json.data` với `backups/legacy-*.json` nếu cần. Không in toàn bộ
settings hoặc r2-config ra chat/log.

Nếu plugin chưa cài và chưa có dấu di chuyển, extension giữ chế độ cũ và báo
Legacy mode; không xóa dữ liệu. Sau khi đã di chuyển, nếu server/file bị lỗi,
extension dừng khởi động thay vì tự thay bằng dữ liệu rỗng hoặc ảnh ẩn cũ.
Lỗi khi lưu giữ các thay đổi trong bộ nhớ; dùng **Export image metadata /
pending changes** trước khi tải lại. Tab có thay đổi chưa lưu sẽ cảnh báo khi
đóng. Mất điện/đóng cưỡng bức trước khi server xác nhận vẫn có thể mất thay đổi
chưa lưu; nút **Save metadata now** chờ lưu xong.

Nhiều tab dùng revision để ngăn tab cũ ghi đè tab mới. Khi gặp 409, xuất thay
đổi đang chờ trước khi reload. Plugin không tự gộp xung đột. Trình duyệt phiên
bản extension cũ vẫn có thể ghi settings theo cách cũ: đóng chúng khi cập nhật.
Bản settings cũ còn sót khác kho server được lưu thành `legacy-residual-*`;
kho server đang hoạt động giữ quyền ưu tiên.

## Cloudflare R2: mặc định OFF

R2 ở bản này là **bản sao bổ sung**: ảnh gốc và thumbnail vẫn ở VPS, mọi liên
kết cũ giữ nguyên. Bản sửa không tự xóa file VPS, không đổi ảnh chat sang URL
công khai, và chưa giảm dung lượng thư mục ảnh VPS. Không có thao tác DELETE
đến R2; tắt toggle không xóa các bản đã tải lên.

Không có upload R2 trong quá trình di chuyển metadata. Cấu hình khóa cũng
không tự bật R2. Có hai hành động riêng:

- **Enable Cloudflare R2 for new image copies**: chỉ sau khi bật thành công,
  các đường dẫn ảnh/thumbnail mới được thêm vào metadata mới được sao chép.
- **Upload existing images to R2**: cần R2 đang ON và xác nhận riêng; sao chép
  thư viện hiện có tuần tự. Dừng ở lỗi đầu tiên; có thể chạy lại, bản đã xác
  nhận cùng nội dung/bucket được bỏ qua. Video có tham chiếu cũng được sao chép
  nếu không quá 64 MiB/file. Ảnh chỉ ở IndexedDB không nằm trong đợt này.

Khi OFF, plugin từ chối yêu cầu upload dù đã có khóa. Khi chuyển OFF, bản
upload đang thực hiện có thể hoàn thành trước khi server nhận toggle; các bản
kế tiếp bị chặn. Tắt toggle vẫn dùng được khi file cấu hình R2 bị mất.

Tạo riêng trên server file
`/root/SillyTavern/data/sui/chatu8-storage/r2-config.json` bằng trình soạn thảo
an toàn, quyền `600`, không đưa vào Git hoặc settings. Cấu trúc minh họa sau
chỉ chứa placeholder, phải thay bằng thông tin của bạn:

```json
{
  "accountId": "YOUR_32_HEX_ACCOUNT_ID",
  "bucket": "your-private-bucket",
  "accessKeyId": "YOUR_R2_ACCESS_KEY_ID",
  "secretAccessKey": "YOUR_R2_SECRET_ACCESS_KEY"
}
```

Khóa cần quyền ghi object trong đúng bucket. Plugin chỉ gửi PUT có chữ ký
SigV4 tới endpoint HTTPS R2 chuẩn của account, không chuyển hướng và không
gửi khóa qua trình duyệt. Không cần public bucket hoặc CORS vì upload chạy
phía server. Cách dùng endpoint S3 của R2:
[tài liệu Cloudflare](https://developers.cloudflare.com/r2/examples/aws/aws-cli/).

Không có endpoint trả về khóa. Bản cấu hình runtime được `.gitignore` loại
trừ nếu vô tình tạo trong checkout, nhưng nơi đúng để đặt nó là thư mục riêng
ở trên. Muốn xác nhận R2 thật: cấu hình, bật toggle, tạo một ảnh thử, xem object
trong bucket và `r2-manifest.json`, rồi kiểm tra cả ảnh/thumbnail cục bộ vẫn mở
được. Chưa thực hiện phép thử này bằng tài khoản R2 thật trong đợt phát triển.

## Hoàn tác

Đóng toàn bộ tab và **dừng SillyTavern trước**. Giữ nguyên thư mục kho riêng và
các backup. Để quay lại extension cũ mà giữ cả thay đổi metadata mới nhất:

```bash
node /root/SillyTavern/plugins/chatu8-storage/rollback.mjs \
  /root/SillyTavern/data/sui --server-stopped
```

Công cụ sao lưu toàn bộ settings hiện tại vào `backups/settings-before-rollback-*`,
đưa `metadata.json.data` trở lại `extension_settings["st-chatu8"].jiuguanStorage`,
bỏ dấu di chuyển rồi lưu nguyên tử. Nó chuyển kho hiện tại thành
`metadata-before-rollback-*.json` để lần chuyển lại sau này dùng settings mới
nhất. Không sửa cấu hình khác hoặc file ảnh. Sau đó phục hồi folder extension
từ backup ban đầu hoặc checkout commit trước bản sửa, rồi khởi động lại.
Không dùng chỉ `git switch` về bản cũ khi chưa phục hồi metadata vào settings.

Nếu metadata.json hỏng/mất, khi server đang dừng, sao lưu file hỏng trước;
khôi phục snapshot revision gần nhất hợp lệ vào metadata.json. Snapshot
`revision-*` là envelope đầy đủ, còn `legacy-*` là data thô: muốn phục hồi từ
legacy phải bọc lại với `version: 1`, `revision: 1`, `data: <legacy>`,
`r2Enabled: false`. Hoặc dùng backup settings + extension trước di chuyển để
khôi phục cả bộ, chấp nhận mất thay đổi sau thời điểm backup. Không xóa ảnh ẩn
cũ trước khi đã xác nhận phương án phục hồi.

## Kiểm thử và giới hạn

Chạy `node --test tests/*.test.mjs`. Các bài thử dùng thư mục tạm và R2 giả lập,
không gọi Cloudflare/PixAI thật. Bao gồm di chuyển/backup, lỗi đĩa, dữ liệu
hỏng, CAS/nhiều tab, thay đổi trong lúc đang lưu, tách user, chặn R2 OFF,
R2 ON chỉ sao chép đường dẫn mới, đường dẫn bất hợp lệ và hoàn tác offline.
Kiểm tra tích hợp các hàm stego trong bundle nhằm ngăn khôi phục đè dữ liệu.
Đã kiểm tra cú pháp; chưa chạy trực tiếp trên VPS hoặc phiên SillyTavern của bạn.
