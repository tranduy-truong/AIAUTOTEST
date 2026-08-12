# Profile: PROCESS_SANDBOX

- Cô lập hoàn toàn filesystem, child_process, worker, environment, clock và random đã được Dependency Resolver đánh dấu.
- Cấm ghi file thật, chạy process thật hoặc gọi `process.exit` thật.
- Dùng mock/stub đã xác minh để kiểm tra arguments và kết quả public contract.
