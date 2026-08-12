# Profile: UNIT_MOCKED

- Tạo đúng một top-level mock cho từng module có `strategy=mock`.
- Mỗi test cấu hình behavior của mock theo plan rồi reset giữa các test.
- Network/global fetch phải được stub; tuyệt đối không gọi dịch vụ thật.
