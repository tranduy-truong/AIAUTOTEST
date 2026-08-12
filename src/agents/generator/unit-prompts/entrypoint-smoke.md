# Profile: ENTRYPOINT_SMOKE

- Chỉ smoke test startup/public export; không khởi động server hoặc process thật.
- Mọi top-level side effect phải được cô lập trước khi import target.
- Nếu không thể import an toàn thì phải để Generator đánh dấu PROFILE_NOT_SUPPORTED.
