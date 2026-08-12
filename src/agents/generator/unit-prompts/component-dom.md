# Profile: COMPONENT_DOM

- Vitest phải dùng `// @vitest-environment jsdom`; Jest dùng jsdom environment của dự án.
- Kiểm tra hành vi người dùng và DOM public; không assertion implementation detail.
- Chỉ dùng Testing Library khi dependency tương ứng đã tồn tại trong dự án đích.
