# playwright-ai-testkit — Đặc tả ý tưởng đầy đủ & chi tiết (mở rộng Unit/Integration + Whitebox/Greybox/Blackbox)

> Tài liệu thiết kế (design spec) cho một bộ công cụ kiểm thử tự động dùng AI Agent, bao quát **toàn bộ kim tự tháp kiểm thử** (Unit → Integration → E2E), tự lập kế hoạch test, tự viết test, tự sửa test khi hỏng, tích hợp CI/CD qua GitHub Actions.

**Phiên bản tài liệu:** 2.0 · **Ngày viết:** 04/08/2026 · Bản trước chỉ bao phủ E2E (Playwright) — bản này mở rộng thêm Unit test, Integration test, và 3 kỹ thuật thiết kế test case Blackbox/Greybox/Whitebox cho toàn bộ dự án.

---

## 0. Tóm tắt nhanh (Elevator pitch)

`playwright-ai-testkit` giờ không chỉ là công cụ E2E — mà là bộ khung kiểm thử phủ **3 tầng của kim tự tháp kiểm thử**, dùng lại đúng 4 agent đã thiết kế ở bản v1 (Planner, Generator, Healer, Executor), chỉ khác là mỗi agent giờ nhận thêm 1 tham số `--level` (`unit` | `integration` | `e2e`) quyết định: agent được xem gì (context), agent sinh test bằng framework nào, và quan trọng nhất — **agent được phép tự động vá test đến mức nào**.

> **Tên gọi:** công cụ vẫn giữ tên `playwright-ai-testkit` (đúng tên dự án bạn đã đặt), dù giờ đây phạm vi vượt ra ngoài Playwright/E2E để bao phủ cả Unit và Integration. Coi "Playwright" trong tên như thương hiệu gốc, không còn là giới hạn phạm vi.

| Tầng | Framework đề xuất | Kỹ thuật thiết kế chủ đạo | Ai/cái gì là "trọng tài" |
|---|---|---|---|
| **Unit** | Vitest + React Testing Library | **Whitebox** (biết code, nhắm vào từng nhánh/điều kiện) | Coverage report (v8) |
| **Integration** | Vitest (gọi thẳng Route Handler) + DB thật (test DB) | **Greybox** (biết contract/schema, không cần biết từng dòng code) | Kết quả gọi API thật + DB thật |
| **E2E** | Playwright | **Blackbox** (chỉ biết yêu cầu/giao diện, không đọc code) | Trình duyệt thật chạy đúng như người dùng |

> **Giả định làm rõ cho yêu cầu mở rộng này:** "cho cả dự án" được hiểu là áp dụng kiến trúc 4-agent + harness engineering đã có (không xây agent mới từ đầu) cho 2 tầng còn thiếu (Unit, Integration), đồng thời gắn 3 kỹ thuật Blackbox/Greybox/Whitebox vào đúng tầng tương ứng làm phương pháp thiết kế test case mặc định. Đây là cách tổ chức thực dụng phổ biến trong ngành QA (không phải quy luật cứng — vẫn có thể whitebox test ở tầng E2E hay blackbox test ở tầng unit nếu cần, xem Mục 2.3). Ví dụ minh hoạ xuyên suốt tài liệu vẫn dùng ngữ cảnh `shopee-clone`.

---

## Mục lục

1. Tổng quan & mục tiêu dự án
2. Kim tự tháp kiểm thử & 3 kỹ thuật thiết kế test case (Whitebox/Greybox/Blackbox)
3. Kiến trúc tổng thể — Hybrid Two-Loop, đa tầng
4. Chi tiết 4 agent chuyên biệt (mở rộng theo tầng)
5. Model Adapter Layer — hỗ trợ đa nền tảng AI
6. Harness Engineering & quản lý context (kèm vòng lặp coverage-guided cho Unit)
7. CLI `testkit` — bảng lệnh đầy đủ
8. Cấu trúc thư mục dự án
9. Cài đặt — `setup.sh` / `setup.bat` (mở rộng cho Vitest)
10. Quy ước Test Case ID & mẫu báo cáo Markdown (3 tầng + Test Pyramid Summary)
11. Chạy test theo từng tầng: `--headed`, `--ui`, headless & regression
12. CI/CD — 3 workflow GitHub Actions (đã lồng thứ tự kim tự tháp)
13. Bảo mật & quản lý secret
14. Luồng end-to-end minh họa (ví dụ thật trên `shopee-clone`, cả 3 tầng)
15. Rủi ro, hạn chế & lưu ý khi triển khai
16. Lộ trình mở rộng (roadmap)
17. Tài liệu tham khảo

---

## 1. Tổng quan & mục tiêu dự án

### 1.1 Vấn đề cần giải quyết

Viết và bảo trì test E2E (end-to-end) bằng Playwright thường tốn công ở 3 điểm:

- **Lên kế hoạch test** đầy đủ, có ID chuẩn, dễ trace theo tính năng — thường bị bỏ qua hoặc làm sơ sài.
- **Viết code test** tốn thời gian, đặc biệt với những luồng dài (checkout, thanh toán...).
- **Bảo trì test** khi UI đổi (đổi selector, đổi text, đổi layout) — test bắt đầu "flaky" hoặc fail hàng loạt, và thường không ai chịu sửa ngay.

Chúng ta có thể giải quyết bài toán viết/bảo trì test E2E bằng Playwright. Nhưng E2E chỉ là 1 tầng của kim tự tháp kiểm thử — chậm, tốn tài nguyên (cần trình duyệt thật), và không phù hợp để "khoá" logic nội bộ (business logic) ở mức hàm/module. Nếu chỉ có E2E:

- Một lỗi tính toán đơn giản (ví dụ hàm `applyDiscount()` tính sai khi giỏ hàng = 0đ) phải đợi cả pipeline E2E chạy xong (vài phút) mới phát hiện được, thay vì vài mili-giây ở unit test.
- Test E2E không "chỉ tay" được chính xác dòng code nào sai — chỉ biết "trang giỏ hàng bị lỗi".
- Không có gì đảm bảo phần tích hợp giữa các module nội bộ (API route + DB + middleware) đúng, ngoài việc chạy toàn bộ UI thật.

### 1.2 Mục tiêu 

- Biến 3 bước trên thành 3 **AI Agent** độc lập, có thể chạy riêng lẻ hoặc nối thành pipeline.
- Không khoá cứng vào 1 nhà cung cấp AI — cho phép chọn ChatGPT (qua Codex CLI), Claude (qua Claude Code), Gemini (qua Antigravity CLI), GitHub Copilot CLI, hoặc model chạy local qua Ollama (không tốn phí API, phù hợp máy yếu hoặc cần giữ code offline).
- Tách bạch rõ **phần có AI** (không tất định, có thể sai) khỏi **phần tất định** (chạy test, tính pass/fail, dựng report) — đây là ý tưởng "Hybrid Two-Loop": vòng AI chỉ được phép *đề xuất*, vòng CI/CD tất định luôn là người *xác nhận cuối cùng*.
- Mỗi lần gọi AI là 1 tiến trình biệt lập, ngữ cảnh được "harness" (đóng gói tối thiểu cần thiết) để không tràn context và không lãng phí token.
- Sinh báo cáo Markdown dễ đọc cho cả người không chuyên kỹ thuật (PM, QA lead) lẫn máy (CI parse để comment lên PR).
- Tích hợp CI/CD để test chạy tự động mỗi khi có PR / push code, và khi fail thì có cơ chế AI tự đề xuất fix (nhưng luôn cần người review trước khi merge).


- Phủ đủ 3 tầng kiểm thử: **Unit → Integration → E2E**, chạy theo đúng thứ tự kim tự tháp trong CI (rẻ/nhanh trước, đắt/chậm sau — fail sớm để tiết kiệm thời gian & chi phí AI).
- Gắn đúng kỹ thuật thiết kế test case cho từng tầng: **Whitebox** cho Unit, **Greybox** cho Integration, **Blackbox** cho E2E — không trộn lẫn ngữ cảnh giữa các tầng (đúng tinh thần harness engineering đã có).
- **Chính sách auto-heal khác nhau theo tầng** — đây là điểm quan trọng nhất của bản mở rộng này: test E2E fail thường do UI đổi (an toàn để AI tự vá), nhưng test Unit/Integration fail thường là **dấu hiệu của bug thật** — AI tự vá test ở tầng này rất rủi ro vì có thể che giấu regression. Xem Mục 4.3.

### 1.3 Nguyên tắc thiết kế cốt lõi

Nguyên tắc | Ý nghĩa |
|---|---|
| **Tất định thắng AI** | Executor (chạy test thật) luôn là nguồn sự thật cuối cùng. AI không bao giờ tự quyết định "test pass" — nó chỉ đề xuất code, Executor chạy lại để xác nhận. |
| **Agent độc lập, có thể resume** | Mỗi agent đọc/ghi 1 file "hợp đồng" (contract) dạng JSON. Nếu file đó đã tồn tại (do agent trước đã chạy, hoặc do người tự viết tay), agent sau vẫn dùng được — không bắt buộc phải chạy lại từ đầu. |
| **Context tối thiểu** | Không bao giờ nhét cả repo vào 1 prompt. Mỗi agent chỉ nhận đúng phần dữ liệu cần cho việc của nó. |
| **Tiến trình biệt lập** | Mỗi lần gọi AI = 1 child process riêng, có timeout, có log riêng, không chia sẻ state ngầm với lần gọi khác. |
| **Không khoá nhà cung cấp** | Đổi backend AI chỉ cần đổi 1 dòng cấu hình, không đổi code agent. |
| **Con người luôn review bản vá của AI** | Healer không bao giờ tự merge code — chỉ mở Pull Request để người duyệt. |
| **Fail nhanh, fail rẻ** | Chạy Unit trước (giây), Integration sau (chục giây), E2E cuối (phút) — dừng ngay nếu tầng trước fail, không lãng phí thời gian/tiền gọi AI cho tầng sau. |
| **Không xem code khi làm blackbox** | Planner/Generator ở tầng E2E **không được** đưa source code thật vào context — chỉ đưa yêu cầu/giao diện, để mô phỏng đúng góc nhìn người dùng thật, tránh AI "đoán" theo cách implementation thay vì theo đúng spec. |
| **Auto-heal tỉ lệ nghịch với mức độ "biết code"** | Càng gần code (Unit) → AI càng dễ vô tình sửa test để che bug thật → càng cần con người can thiệp trước khi merge bản vá. |

---

## 2. Kim tự tháp kiểm thử & 3 kỹ thuật thiết kế test case

### 2.1 Ba tầng: Unit / Integration / E2E

```
              ▲
             /E2E\            ít nhất, chậm nhất, đắt nhất, gần người dùng nhất
            /------\          → Playwright, chạy trình duyệt thật
           /Integration\      vừa phải — test module thật + module thật ghép lại
          /--------------\    → Vitest gọi thẳng Route Handler + DB test thật
         /      Unit       \  nhiều nhất, nhanh nhất, rẻ nhất, gần code nhất
        /--------------------\ → Vitest + Testing Library, chạy hàm/component đơn lẻ
```

| | Unit | Integration | E2E |
|---|---|---|---|
| **Kiểm tra gì** | 1 hàm / 1 hook / 1 component đơn lẻ, cô lập hoàn toàn (mock mọi phụ thuộc) | 2+ module nội bộ ghép lại thật (VD: Route Handler + DB thật), chỉ mock cái thật sự bên ngoài (cổng thanh toán, email) | Toàn bộ hệ thống qua giao diện thật, trình duyệt thật |
| **Tốc độ** | Mili-giây → giây | Giây → chục giây | Chục giây → phút |
| **Framework đề xuất** | Vitest + `@testing-library/react` | Vitest (gọi trực tiếp Route Handler) hoặc Vitest + DB test (SQLite/Postgres tạm) | Playwright  |
| **"Trọng tài"** | Coverage report (v8 provider) | Response/DB state thật | Trình duyệt render đúng như thật |

### 2.2 Ba kỹ thuật/góc nhìn thiết kế test case

Đây là 3 **kỹ thuật thiết kế test case**, khác với 3 tầng ở trên — về mặt lý thuyết chúng độc lập với tầng (vẫn có thể whitebox-test ở E2E hoặc blackbox-test ở unit), nhưng trong thực hành, chúng khớp tự nhiên với 3 tầng vì lượng thông tin agent "được phép biết" tăng dần khi càng gần code.

**Whitebox (hộp trắng)** — biết toàn bộ code nội bộ, thiết kế test dựa trên cấu trúc code:
- Kỹ thuật: Statement coverage, Branch/Decision coverage, Condition coverage, Path coverage, Loop testing.
- Ví dụ: hàm `applyDiscount(cartTotal, code)` có nhánh `if (code.expired)`, `if (cartTotal <= 0)`, `if (discount > cartTotal)` → whitebox test phải cover đủ **từng nhánh**, không chỉ 1-2 trường hợp "trông có vẻ đủ".

**Blackbox (hộp đen)** — hoàn toàn không biết code, chỉ dựa vào yêu cầu/spec/hành vi quan sát được từ bên ngoài:
- Kỹ thuật: Equivalence Partitioning (chia lớp tương đương), Boundary Value Analysis (giá trị biên), Decision Table, State Transition Testing.
- Ví dụ: với ô nhập "mã giảm giá", blackbox tester không cần biết code xử lý ra sao, chỉ cần biết yêu cầu "mã hợp lệ → giảm giá, mã hết hạn → báo lỗi, mã không tồn tại → báo lỗi khác" rồi test đúng các lớp tương đương đó từ giao diện.

**Greybox (hộp xám)** — biết một phần: kiến trúc, contract API, schema DB — nhưng không cần đọc từng dòng logic implementation:
- Kỹ thuật: kết hợp Blackbox + tận dụng hiểu biết về contract để thiết kế case "hiểm" hơn.
- Ví dụ: biết `POST /api/cart/apply-discount` nhận `{code}` trả về `{success, newTotal, error?}`, và biết trong DB có cột `validUntil` — greybox tester chủ động tạo 1 dòng discount test có `validUntil` trong quá khứ để test case hết hạn, dù không biết chính xác hàm nào trong code đọc cột đó.

### 2.3 Bản đồ ánh xạ thực dụng

```
Unit         ⇄  Whitebox     (Planner/Generator ĐƯỢC đọc source code thật)
Integration  ⇄  Greybox      (Planner/Generator được đọc API contract/DB schema, KHÔNG đọc implementation chi tiết)
E2E          ⇄  Blackbox     (Planner/Generator CHỈ được đọc yêu cầu/giao diện, KHÔNG đọc source code)
```

> Đây là cách tổ chức mặc định của `testkit`, áp dụng trực tiếp vào context mà Planner Agent được cấp ở Mục 4.1. Muốn lệch khỏi ánh xạ này (ví dụ: whitebox-test 1 luồng E2E phức tạp) vẫn được — chỉ cần truyền cờ `--technique` khác mặc định của tầng đó khi gọi `testkit plan`.

### 2.4 Ví dụ cụ thể trên `shopee-clone` — cùng 1 tính năng, 3 góc nhìn

Tính năng: **"Áp dụng mã giảm giá ở giỏ hàng"** (dùng lại từ walkthrough Mục 14).

| Tầng | Test case ví dụ | Vì sao |
|---|---|---|
| **Unit (Whitebox)** — hàm `applyDiscount()` | `UT_DISCOUNT_004`: `cartTotal = 0` → phải trả lỗi `INVALID_CART`, không cho áp mã | Đọc code thấy có `if (cartTotal <= 0) throw ...` → whitebox bắt buộc phải test nhánh này dù blackbox có thể bỏ sót vì "0đ" không phải kịch bản người dùng hay nghĩ tới |
| **Integration (Greybox)** — `POST /api/cart/apply-discount` + DB thật | `IT_CART_API_002`: gọi API với mã có `validUntil` là hôm qua → response phải `400 { error: "DISCOUNT_EXPIRED" }` | Biết schema DB có cột `validUntil` (greybox) nhưng không cần biết hàm nào đọc nó |
| **E2E (Blackbox)** — giao diện thật | `TC_CART_020`: gõ mã giảm giá vào ô, bấm "Áp dụng", thấy tổng tiền giảm đúng | Không quan tâm code viết sao — chỉ quan tâm người dùng thấy đúng kết quả trên màn hình |

---

## 3. Kiến trúc tổng thể — Hybrid Two-Loop, đa tầng

Kiến trúc **không đổi** so với v1 (vẫn 2 vòng: AI Loop đề xuất, CI/CD Loop tất định xác nhận) — chỉ khác là giờ **Executor Agent chạy 1 trong 3 runner tuỳ `--level`**, và **Planner/Generator/Healer nhận context khác nhau tuỳ `--level`**.

```
                    ┌─────────────────────────────────────────────────────┐
                    │                   VÒNG AI (AI Loop)                   │
                    │                                                        │
   --level unit ────┤   Planner ──▶ Generator ──▶ (nếu fail) Healer         │
   --level integr. ─┤   (context = source code / API contract / spec        │
   --level e2e ─────┤    tuỳ --level — xem Mục 4.1)                         │
                    └───────────────────────┬────────────────────────────┘
                                             │
                          test-plan.json · *.test.ts / *.spec.ts · healing-report.json
                                             │
                    ┌───────────────────────▼────────────────────────────┐
                    │              Executor Agent (tất định)                │
                    │  --level unit         → vitest run --coverage        │
                    │  --level integration  → vitest run tests/integration │
                    │  --level e2e          → playwright test [--headed|--ui]│
                    └───────────────────────┬────────────────────────────┘
                                             │
                             test-results.json (mỗi tầng riêng)
                                             │
                              report.md (per-level) + Test Pyramid Summary
                    ┌───────────────────────────────────────────────────┐
                    │        VÒNG CI/CD — chạy tuần tự Unit→Integration→E2E │
                    └───────────────────────────────────────────────────┘
```

Điểm mấu chốt: **Executor vẫn là "trọng tài" duy nhất**, dù ở tầng nào — không tầng nào để AI tự quyết định "pass".

---

## 4. Chi tiết 4 agent chuyên biệt (mở rộng theo tầng)

### 4.1 Planner Agent (AI) — context khác nhau theo `--level`

| `--level` | Input (context được cấp) | Input **CẤM** đưa vào | Output |
|---|---|---|---|
| `unit` | Source code thật của hàm/component/hook cần test + test cũ liên quan (nếu có) + (tuỳ chọn) coverage gap từ lần chạy trước — xem Mục 6.5 | Không cấm gì — whitebox được phép biết hết | `test-plan.json` (mục `level: "unit"`), mỗi case gắn ID `UT_...` |
| `integration` | API contract (OpenAPI/Zod schema), DB schema liên quan, kiến trúc tổng quan module | **Không** đưa chi tiết implementation từng hàm nội bộ | `test-plan.json` (`level: "integration"`), ID `IT_...` |
| `e2e` | Mô tả tính năng / user story / DOM snapshot đã crawl / screenshot | **Không** đưa source code (component code, API handler code...) | `test-plan.json` (`level: "e2e"`), ID `TC_...`   |

```bash
testkit plan --level unit --target src/lib/discount.ts
testkit plan --level integration --contract openapi/cart.yaml --module CART
testkit plan --level e2e --feature "Áp dụng mã giảm giá ở giỏ hàng" --module CART
```

### 4.2 Generator Agent (AI) — chọn template theo `--level`

| `--level` | Framework sinh ra | Vị trí file | Ghi chú kỹ thuật quan trọng |
|---|---|---|---|
| `unit` | Vitest + `@testing-library/react` (component), hoặc Vitest thuần (hàm/hook) | `tests/unit/**/*.test.ts(x)` | **Vitest hiện KHÔNG render được Server Component bất đồng bộ** (component có `await fetch()` bên trong) — đây là giới hạn đã được ghi nhận chính thức trong docs Next.js/Vitest, không phải lỗi cấu hình. Generator phải: (a) chỉ sinh unit test cho phần logic đã được tách ra hàm thuần/hook/Client Component đồng bộ, và (b) nếu target là 1 Server Component bất đồng bộ, **từ chối sinh unit test** và gợi ý đẩy xuống tầng Integration hoặc E2E thay thế. |
| `integration` | Vitest, import thẳng Route Handler (`export async function POST(req: Request)`), gọi bằng `Request`/`Response` chuẩn Web API | `tests/integration/**/*.test.ts` | Không mock DB nội bộ — dùng DB test thật (SQLite tạm hoặc Postgres service trong CI). Chỉ mock dịch vụ **thật sự bên ngoài** (cổng thanh toán, email) bằng MSW. |
| `e2e` | Playwright | `tests/e2e/**/*.spec.ts`  | Chỉ nhận đúng các test case cần sinh + 1–2 file Page Object mẫu liên quan (không load toàn bộ `tests/` folder) |

### 4.3 Healer Agent (AI) — **chính sách khác nhau theo tầng (điểm quan trọng nhất của bản mở rộng)**

Test E2E fail thường do **UI trôi dạt** (đổi selector, đổi text) — vá lại thường an toàn. Nhưng test Unit/Integration fail thường là **dấu hiệu bug thật** trong logic — nếu để AI tự "sửa test cho qua", rất dễ **che giấu regression** thay vì phát hiện nó. Vì vậy:

| `--level` | Hành vi mặc định của Healer | Vì sao |
|---|---|---|
| `e2e` | **Tự động vá** — sửa selector/logic điều hướng, Executor chạy lại xác nhận, mở PR | UI đổi là nguyên nhân phổ biến nhất, rủi ro thấp |
| `integration` | **Chỉ chẩn đoán, không tự vá** — phân tích xem lỗi do (a) contract đổi có chủ đích (an toàn để cập nhật test), hay (b) bug thật (KHÔNG được sửa test) → mở **GitHub Issue** mô tả rõ, không mở PR sửa code test | Lỗi tích hợp thường liên quan đến hợp đồng dữ liệu — sửa nhầm hướng dễ che bug |
| `unit` | **Chỉ chẩn đoán, không tự vá** (mặc định `unitFailurePolicy: "diagnose-only"`) — trừ khi lỗi thuộc nhóm rủi ro thấp đã được cấu hình rõ (VD: snapshot lệch do đổi text có chủ đích, mock lỗi thời sau khi nâng cấp thư viện) | Unit test là "lưới an toàn" gần code nhất — auto-heal ở đây gần như luôn có nguy cơ che giấu bug |

Cấu hình trong `testkit.config.json`:

```json
{
  "healer": {
    "autoFixLevels": ["e2e"],
    "diagnoseOnlyLevels": ["integration", "unit"],
    "lowRiskAutoFixCategories": ["outdated-mock-signature", "intentional-snapshot-update"]
  }
}
```

Team có thể tự nới `autoFixLevels` để bao gồm `"integration"`/`"unit"` — nhưng đây là quyết định có ý thức, không phải mặc định.

```bash
testkit heal --level e2e            # tự vá + mở PR
testkit heal --level unit           # chỉ chẩn đoán → mở GitHub Issue, không sửa code test
testkit heal --level integration    # tương tự — chẩn đoán trước
```

### 4.4 Executor Agent (tất định) — chọn runner theo tầng

| `--level` | Lệnh chạy thật bên dưới |
|---|---|
| `unit` | `vitest run --coverage` |
| `integration` | `vitest run --dir tests/integration` (kèm biến môi trường DB test) |
| `e2e` | `playwright test [--headed \| --ui]` *(như v1)* |

Executor luôn dựng `test-results.json` theo đúng 1 schema chung (chỉ thêm field `level`), để Mục 10 có thể gộp cả 3 tầng vào 1 báo cáo "Test Pyramid Summary" duy nhất.

---

## 5. Model Adapter Layer — hỗ trợ đa nền tảng AI

### 5.1 Interface chung (TypeScript, minh hoạ)

```ts
export interface RunOptions {
  promptDir: string;        // thư mục "harness bundle" đã đóng gói cho lần gọi này
  workDir: string;          // working directory biệt lập cho tiến trình con
  timeoutMs: number;
  maxTurns?: number;        // giới hạn số bước agent được tự ý lặp (nếu backend hỗ trợ)
  allowedTools?: string[];  // whitelist tool/permission agent được dùng
}

export interface AgentResult {
  ok: boolean;
  rawOutput: string;
  structuredOutput?: unknown;  // parse được nếu backend hỗ trợ output JSON
  costUsd?: number;
  durationMs: number;
}

export interface ModelAdapter {
  id: "claude-code" | "copilot-cli" | "codex-cli" | "antigravity-cli" | "ollama";
  displayName: string;
  isAvailable(): Promise<boolean>;  // kiểm tra CLI đã cài + đã đăng nhập/API key hợp lệ
  run(opts: RunOptions): Promise<AgentResult>;
}
```

Mỗi agent (Planner/Generator/Healer) chỉ gọi qua interface này — không quan tâm backend cụ thể là gì. Đổi backend = đổi 1 dòng trong `testkit.config.json`, không đổi code agent.

### 5.2 Bảng tổng hợp cách gọi headless từng backend

> Các CLI AI-agent bên thứ 3 cập nhật cờ (flag) rất nhanh. Bảng dưới là snapshot chính xác tại thời điểm viết tài liệu — nên đối chiếu lại docs chính thức (Mục 16) trước khi code thật, đặc biệt với Antigravity CLI vì đây là sản phẩm còn rất mới.

| Backend | Lệnh headless mẫu | Output có cấu trúc | Cơ chế giới hạn phạm vi | Biến môi trường auth trong CI |
|---|---|---|---|---|
| **Claude Code** (Anthropic) | `claude -p "$(cat task.md)" --output-format json --max-turns 6 --allowedTools "Read,Edit"` | `--output-format json / stream-json` | `--max-turns`, `--allowedTools`, `--permission-mode` | `ANTHROPIC_API_KEY` |
| **GitHub Copilot CLI** | `copilot -p "$(cat task.md)" --agent test-generator` | text (chưa có json schema chặt như Claude Code, cần tự parse) | `--allow-tool` / `--deny-tool`, chạy trong sandbox | `GH_TOKEN` hoặc `GITHUB_TOKEN` |
| **OpenAI Codex CLI** (chạy dưới tên "ChatGPT" trong yêu cầu gốc) | `codex exec --json --output-last-message result.txt "$(cat task.md)"` | NDJSON qua `--json`, kèm `--output-last-message` cho bản tóm tắt text | `--sandbox workspace-write` (thay cho `--full-auto` đã deprecated) | `OPENAI_API_KEY` hoặc đăng nhập ChatGPT plan |
| **Antigravity CLI** (chạy Gemini — kế thừa Gemini CLI đã bị Google khai tử giữa 06/2026) | dạng `agy run --prompt-file task.md` (**tên lệnh/cờ chính xác cần xác nhận lại theo docs mới nhất** vì sản phẩm mới ra mắt) | tuỳ phiên bản, xem docs Antigravity CLI | cấu hình qua Agent/skills của Antigravity | Google AI API key / Gemini Enterprise credential |
| **Ollama** (model local, ví dụ các model hướng code như `qwen2.5-coder`, `deepseek-coder-v2`, hoặc bản mới hơn có tại thời điểm dùng) | `ollama run <model> < task.md` hoặc gọi REST `POST http://localhost:11434/api/generate` | JSON qua REST API | tự quản lý qua `num_ctx` khi tạo Modelfile | không cần (chạy hoàn toàn local, phù hợp khi không muốn gửi code ra ngoài) |

> **Lưu ý về Antigravity:** Gemini CLI (dòng lệnh terminal cũ của Google cho Gemini) đã được Google gộp vào **Antigravity CLI** — Google dừng phục vụ Gemini CLI/Gemini Code Assist cho gói cá nhân từ 18/06/2026, chuyển hướng người dùng sang Antigravity CLI (dùng chung "harness" với Antigravity 2.0/IDE). Vì vậy khi yêu cầu gốc nói "Gemini từ Antigravity", đây chính xác là hướng đi hiện tại của Google — không phải Gemini CLI độc lập nữa.

### 5.3 Chọn backend nào cho tình huống nào?

- **Không muốn tốn phí API, ưu tiên riêng tư code** → Ollama (chạy local, chậm hơn nhưng miễn phí, không gửi code ra ngoài).
- **Cần output JSON structured ổn định nhất để parse tự động trong pipeline** → Claude Code (`--output-format json` có schema rõ ràng, có official GitHub Action đi kèm).
- **Đã có sẵn subscription Copilot / ChatGPT / Gemini Enterprise qua công ty** → dùng đúng cái đang trả phí, tránh trả tiền 2 lần.
- **Cần headless CI ổn định, ít thay đổi API** → nên có cơ chế "pin version" CLI trong `package.json`/Docker image vì các tool này (đặc biệt Copilot CLI, Antigravity CLI) đang cập nhật rất nhanh trong năm 2026.

---

## 6. Harness Engineering & quản lý context (mở rộng)

Đây là phần trả lời trực tiếp yêu cầu *"tạo cho agent chạy ở một tiến trình riêng, đảm bảo không bị tràn context và áp dụng harness engineering"*.

### 6.1 Cô lập tiến trình (process isolation)

Mỗi lần 1 agent AI được gọi:

```ts
// src/harness/spawnAgent.ts (minh hoạ)
import { spawn } from "node:child_process";

export function runIsolated(bin: string, args: string[], opts: RunOptions) {
  return new Promise<AgentResult>((resolve, reject) => {
    const start = Date.now();
    const child = spawn(bin, args, {
      cwd: opts.workDir,                 // thư mục làm việc riêng cho lần chạy này
      env: buildScrubbedEnv(opts),       // chỉ truyền đúng API key cần thiết, không leak secret khác
      timeout: opts.timeoutMs,
    });

    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      appendLog(opts, { code, stdout, stderr, durationMs: Date.now() - start });
      resolve({ ok: code === 0, rawOutput: stdout, durationMs: Date.now() - start });
    });

    child.on("error", reject);
  });
}
```

Nguyên tắc:

- Mỗi tiến trình có **working directory riêng** (ví dụ `.testkit/runs/<runId>/`) — agent không vô tình đọc/ghi nhầm file của lần chạy khác.
- **`env` bị "scrub"** — chỉ truyền đúng 1 API key tương ứng backend đang chọn, không để lộ các secret khác của CI vào tiến trình con AI.
- **Timeout cứng** (SIGKILL nếu quá giờ) — tránh treo pipeline CI khi AI "suy nghĩ" quá lâu hoặc treo cổ do lỗi mạng.
- **Log riêng theo run** — `.testkit/logs/<agent>/<runId>.log` để debug sau này mà không lẫn lộn giữa các lần chạy.

### 6.2 Kiểm soát kích thước context (tránh tràn context)

Mỗi agent có 1 "harness bundle" — một thư mục tạm gồm:

```
.testkit/runs/<runId>/
├── system.md     # vai trò + quy tắc cố định của agent (Planner/Generator/Healer)
├── context/      # chỉ chứa slice dữ liệu tối thiểu cần cho lần gọi này
└── task.md       # yêu cầu cụ thể của lần gọi này
```

Thuật toán đóng gói (`buildPrompt.ts`, minh hoạ ý tưởng):

1. Ước lượng số token cần thiết (heuristic đơn giản: `characters / 4`).
2. So với ngân sách token cho từng agent (ví dụ: Planner ≈ 40K token, Generator ≈ 20K token/chunk, Healer ≈ 8K token — Healer cần hẹp nhất vì chỉ xử lý **đúng 1 test case FAILED** mỗi lần).
3. Nếu vượt ngân sách → **tự chia nhỏ** (chunk) thay vì nhét hết vào 1 lần gọi:
   - Planner: chia theo module/feature.
   - Generator: chia theo nhóm 5–10 test case/lần.
   - Healer: **luôn luôn 1 test case FAILED / 1 lần gọi** — không bao giờ gộp nhiều lỗi vào 1 prompt, để tránh AI "nhầm lẫn" giữa các lỗi không liên quan.
4. Với DOM snapshot/trace lớn (Healer cần) → chỉ trích phần liên quan tới selector bị lỗi (ví dụ vùng cha gần nhất của locator không tìm thấy), không nhét toàn bộ HTML trang.

### 6.3 Hợp đồng dữ liệu giữa các agent (cho phép "resume")

Đây là cách giải quyết yêu cầu *"cho phép sử dụng 1 trong các agent, phòng trường hợp agent ở workflow trước đã làm phần việc của mình"*:

- Mỗi agent **kiểm tra artifact input trước khi chạy**. Nếu thiếu → báo lỗi rõ ràng, gợi ý lệnh cần chạy trước; nếu người dùng đã có sẵn (tự viết tay, hoặc lấy từ nguồn khác) → agent dùng luôn, không bắt buộc phải qua agent trước.
- Mỗi agent **kiểm tra artifact output đã tồn tại chưa**. Nếu có rồi → mặc định **skip** (log rõ "đã tồn tại, bỏ qua"), trừ khi truyền `--force`.

```bash
testkit generate --plan artifacts/test-plan.json
# Nếu artifacts/test-plan.json do người dùng tự viết tay (không qua Planner) → vẫn chạy bình thường

testkit generate --plan artifacts/test-plan.json --force
# Ép sinh lại toàn bộ dù test đã tồn tại
```

### 6.4 Giới hạn thời gian, retry, logging

| Agent | Timeout gợi ý | Retry khi lỗi mạng/API | Ghi chú |
|---|---|---|---|
| Planner | 3 phút/module | 1 lần | Lỗi thường do rate-limit API |
| Generator | 3 phút/chunk (5–10 test case) | 1 lần | Nếu vẫn lỗi → giảm chunk size xuống còn 3 test case rồi thử lại |
| Healer | 2 phút/test case | 1 lần, không retry vô hạn | Nếu vẫn fail sau 1 lần vá → đánh dấu `needs-human`, không cố lặp lại tránh lãng phí token |
| Executor | Theo cấu hình Playwright (`timeout` trong `playwright.config.ts`) | Dùng cơ chế retry sẵn có của Playwright (`retries`) | Không liên quan AI

### 6.5 Vòng lặp sinh test dẫn dắt bởi coverage (coverage-guided, chỉ áp dụng tầng Unit)

Thay vì để Generator "đoán" cần sinh bao nhiêu test case cho 1 file, `testkit` dùng chính báo cáo coverage làm context:

1. Chạy `testkit test --level unit --coverage` → sinh `coverage/coverage-final.json` (định dạng v8/Istanbul).
2. Với mỗi file dưới ngưỡng cấu hình (VD: branches < 70%) → trích ra **chính xác các dòng/nhánh chưa được coverage** (không phải cả file).
3. Gọi lại Planner+Generator **chỉ với đúng đoạn code chưa coverage đó** làm context — đúng tinh thần "context tối thiểu" đã đặt ra từ bản v1, giờ áp dụng ở mức chi tiết hơn: không phải "1 file" mà là "1 nhánh code".

```bash
testkit generate --level unit --coverage-gap-only
# chỉ sinh thêm test cho phần chưa coverage, không sinh lại toàn bộ file
```

Cấu hình ngưỡng coverage (Vitest, provider v8):

```ts
// vitest.config.ts
coverage: {
  provider: "v8",
  reporter: ["text", "html", "lcov", "json"],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
}
```

---

## 7. CLI `testkit` — bảng lệnh đầy đủ (mở rộng `--level`)

| Lệnh | Mô tả | Agent | Tầng áp dụng |
|---|---|---|---|
| `testkit setup` | Wizard chọn AI backend/model (không đổi) | – | Cả 3 |
| `testkit plan --level <unit\|integration\|e2e> ...` | Sinh/bổ sung `test-plan.json` đúng context theo tầng | Planner | Cả 3 |
| `testkit generate --level <...> [--only <id,...>] [--coverage-gap-only]` | Sinh code test đúng framework theo tầng | Generator | Cả 3 |
| `testkit test --level <...> [--headed\|--ui] [--regression] [--coverage]` | Chạy test thật + xuất report | Executor | Cả 3 |
| `testkit heal --level <...> [--only <id,...>]` | Vá (e2e) hoặc chẩn đoán (unit/integration) | Healer | Cả 3 |
| `testkit report [--level <...>] [--in <file>]` | Render lại report.md, gộp cả 3 tầng nếu không truyền `--level` | – | Cả 3 |
| `testkit run [--level <...>] [--headed\|--ui] [--regression]` | Chạy full pipeline cho 1 tầng, hoặc cả 3 tầng theo thứ tự kim tự tháp nếu không truyền `--level` | Cả 4 | Cả 3 |

```bash
# Chạy đúng thứ tự kim tự tháp, dừng ngay nếu 1 tầng fail — dùng local trước khi push
testkit run

# Chỉ tầng unit, có coverage
testkit test --level unit --coverage

# Chỉ tầng integration
testkit test --level integration

# E2E, có UI Mode
testkit test --level e2e --ui
```

---

## 8. Cấu trúc thư mục dự án (cập nhật)

```
playwright-ai-testkit/
├── setup.sh
├── setup.bat
├── package.json
├── testkit.config.json              # sinh ra sau khi chạy setup (backend, model đã chọn...)
├── vitest.config.ts                 # MỚI — cấu hình Unit + Integration
├── vitest.setup.ts                  # MỚI — jest-dom, cleanup...
├── playwright.config.ts
├── scripts/
│   ├── init-agents.js               # scaffold 3 agent AI + 1 executor
│   └── select-backend.js            # wizard chọn AI backend (dùng chung cho .sh & .bat)
├── src/
│   ├── cli/
│   │   └── index.ts                 # entrypoint `testkit` (dùng commander/yargs)
│   ├── agents/
│   │   ├── planner/{prompt-unit.md, prompt-integration.md, prompt-e2e.md, run.ts}
│   │   ├── generator/{template-vitest.ts, template-integration.ts, template-playwright.ts, run.ts}
│   │   ├── healer/{prompt-e2e.md, diagnose-only.ts, run.ts}
│   │   └── executor/run.ts
│   ├── adapters/                    # Model Adapter Layer (Mục 5)
│   │   ├── claudeCode.ts
│   │   ├── copilotCli.ts
│   │   ├── codexCli.ts
│   │   ├── antigravityCli.ts
│   │   └── ollama.ts
│   ├── harness/
│   │   ├── buildPrompt.ts           # đóng gói + chia nhỏ context theo ngân sách token
│   │   ├── spawnAgent.ts            # cô lập tiến trình, timeout, log
│   │   └── contracts.ts             # định nghĩa JSON schema giữa các agent
│   │   └── coverageGap.ts           # Mục 6.5
│   └── report/
│       └── renderMarkdown.ts        # cập nhật: gộp 3 tầng → Test Pyramid Summary
├── tests/
│   ├── unit/
│   │   ├── lib/discount.test.ts
│   │   └── hooks/useCart.test.ts
│   ├── integration/
│   │   └── api/cart/apply-discount.test.ts
│   └── e2e/
│       ├── auth/login.spec.ts
│       ├── cart/cart.spec.ts
│       └── checkout/checkout.spec.ts
├── coverage/                        # sinh ra sau khi chạy unit test (gitignore)
├── artifacts/
│   ├── test-plan.json               # có field "level" cho từng case
│   ├── test-results.json
│   ├── healing-report.json
│   └── reports/report-2026-08-04.md
└── .github/
    └── workflows/
        ├── pr-checks.yml            # ĐỔI TÊN từ pr-regression.yml — giờ có 3 job tuần tự
        ├── main-full-suite.yml
        └── auto-heal.yml
```

---

## 9. Cài đặt — `setup.sh` / `setup.bat` (mở rộng cho Vitest)

Phần Node.js check, `npm install`, `npx playwright install --with-deps`, wizard chọn backend AI — **giữ nguyên như bản v1**. Bổ sung: `package.json` cần thêm các devDependencies sau (đã được `npm install` ở bước đầu cài luôn cùng lúc):

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @vitest/coverage-v8
```

> Theo tài liệu Next.js/Vitest chính thức tính đến 2026, khuyến nghị dùng **Vitest** thay vì Jest cho dự án Next.js mới (khởi động nhanh hơn 10–20 lần, hỗ trợ ESM gốc, không cần cấu hình Babel/ts-jest). Nếu `shopee-clone` đang dùng Jest sẵn, việc chuyển sang Vitest thường chỉ là đổi import (`jest` → `vitest`) vì API gần như tương thích 1-1.

`vitest.config.ts` mẫu:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      exclude: ["**/*.config.*", "**/node_modules/**", "app/**/layout.tsx"],
    },
  },
});
```

`vitest.setup.ts` mẫu:

```ts
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

Thêm vào cuối `setup.sh`/`setup.bat` (sau bước `npx playwright install`):

```bash
# setup.sh
echo "🧪 Cài Vitest cho Unit/Integration test..."
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @vitest/coverage-v8
```

```bat
:: setup.bat
echo Cai Vitest cho Unit/Integration test...
call npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8
```

---

## 10. Quy ước Test Case ID & mẫu báo cáo Markdown (3 tầng)

### 10.1 Quy ước ID theo tầng

```
Unit:         UT_<MODULE>_<3 chữ số>     VD: UT_DISCOUNT_004
Integration:  IT_<MODULE>_<3 chữ số>     VD: IT_CART_API_002
E2E:          TC_<MODULE>_<3 chữ số>     VD: TC_CART_020   (không đổi so với v1)
```

### 10.2 Mẫu báo cáo — ví dụ 1 case mỗi tầng

```markdown
## UT_DISCOUNT_004 — cartTotal = 0 phải từ chối áp mã giảm giá

| Trường | Nội dung |
|---|---|
| **Precondition** | Hàm `applyDiscount()` được gọi trực tiếp, không qua UI |
| **Steps** | Gọi `applyDiscount(0, "SALE10")` |
| **Expected Result** | Ném lỗi `INVALID_CART`, không trả về discount |
| **Actual Result** | Đúng như kỳ vọng |
| **Status** | ✅ Passed |

## IT_CART_API_002 — API từ chối mã giảm giá đã hết hạn

| Trường | Nội dung |
|---|---|
| **Precondition** | DB test có sẵn discount code `EXPIRED10` với `validUntil` = hôm qua |
| **Steps** | `POST /api/cart/apply-discount { code: "EXPIRED10" }` |
| **Expected Result** | `400 { error: "DISCOUNT_EXPIRED" }` |
| **Actual Result** | Đúng như kỳ vọng |
| **Status** | ✅ Passed |

## TC_CART_020 — Áp dụng mã giảm giá thành công qua giao diện

| Trường | Nội dung |
|---|---|
| **Precondition** | Giỏ hàng có 2 sản phẩm, tổng 500.000đ |
| **Steps** | 1. Vào `/cart`<br>2. Nhập mã "SALE10"<br>3. Bấm "Áp dụng" |
| **Expected Result** | Tổng tiền giảm còn 450.000đ |
| **Actual Result** | Đúng như kỳ vọng |
| **Status** | ✅ Passed |
```

### 10.3 Test Pyramid Summary (thay thế/bổ sung cho Test Execution Summary của v1)

```markdown
## 📊 Test Pyramid Summary

| Tầng | Kỹ thuật | Tổng số | ✅ Passed | ❌ Failed | 🔧 Healed | Coverage | Thời gian |
|---|---|---|---|---|---|---|---|
| Unit | Whitebox | 120 | 118 | 2 | 0 (diagnose-only) | Lines 84% · Branches 76% | 12s |
| Integration | Greybox | 34 | 33 | 1 | 0 (diagnose-only) | – | 48s |
| E2E | Blackbox | 42 | 40 | 0 | 2 | – | 3m 42s |
| **Tổng** | | **196** | **191** | **3** | **2** | | **~5m** |

> 2 test Unit và 1 test Integration bị fail **không** được AI tự vá — xem `artifacts/healing-report.json` và các Issue tương ứng để con người xác nhận đây là bug thật hay thay đổi có chủ đích.
```

---

## 11. Chạy test theo từng tầng: `--headed`, `--ui`, headless & regression

Bảng ánh xạ cờ (không đổi tinh thần so với v1, áp dụng thêm `--level`):

| Lệnh | Ý nghĩa |
|---|---|
| `testkit test --level unit` | `vitest run` — luôn headless (không có khái niệm "mở trình duyệt" ở tầng unit) |
| `testkit test --level unit --coverage` | `vitest run --coverage` |
| `testkit test --level integration` | `vitest run --dir tests/integration` |
| `testkit test --level e2e` | `playwright test` — headless |
| `testkit test --level e2e --headed` | `playwright test --headed` |
| `testkit test --level e2e --ui` | `playwright test --ui` |
| `testkit test --level e2e --regression` | `playwright test --grep @regression` *(như v1)* |

> `--headed`/`--ui` chỉ có ý nghĩa với `--level e2e` — CLI sẽ báo lỗi rõ ràng nếu dùng nhầm với `unit`/`integration`.

---

## 12. CI/CD — 3 workflow GitHub Actions (đã lồng thứ tự kim tự tháp)

Vẫn giữ đúng **3 file workflow** như định hướng ban đầu — `pr-checks.yml` có **3 job chạy tuần tự bằng `needs:`**, đúng thứ tự kim tự tháp: fail ở Unit thì Integration/E2E không chạy, tiết kiệm thời gian CI và tiền gọi AI.

### 12.1 `.github/workflows/pr-checks.yml`

```yaml
name: PR Checks (Unit -> Integration -> E2E Regression)

on:
  pull_request:
    branches: [main]

jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Unit tests (Vitest) + coverage
        run: npx testkit test --level unit --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: unit-coverage-${{ github.run_id }}
          path: coverage/

  integration:
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: shopee_clone_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready" --health-interval=5s --health-timeout=5s --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Integration tests
        run: npx testkit test --level integration
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/shopee_clone_test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: integration-report-${{ github.run_id }}
          path: artifacts/reports/*.md

  e2e-regression:
    needs: integration
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: E2E regression (headless)
        run: npx testkit test --level e2e --regression
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-regression-report-${{ github.run_id }}
          path: |
            artifacts/reports/*.md
            playwright-report/
      - name: Bình luận Test Pyramid Summary lên PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const files = fs.readdirSync('artifacts/reports').filter(f => f.endsWith('.md'));
            if (files.length === 0) return;
            const latest = files.sort().at(-1);
            const body = fs.readFileSync(`artifacts/reports/${latest}`, 'utf8').slice(0, 60000);
            await github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number, body });
```

### 12.2 `.github/workflows/main-full-suite.yml`

Giữ cấu trúc như v1 (push vào `main`, cron đêm, `workflow_dispatch`), áp dụng cùng 3 job tuần tự `unit → integration → e2e-full` (khác `pr-checks.yml` ở chỗ job E2E chạy **toàn bộ** suite thay vì chỉ `--regression`). Không lặp lại toàn bộ YAML ở đây — cấu trúc giống hệt Mục 12.1, chỉ đổi job cuối thành:

```yaml
  e2e-full:
    needs: integration
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      # ... checkout, setup-node, npm ci, playwright install (giống 12.1)
      - name: Chạy toàn bộ E2E suite
        run: npx testkit test --level e2e
      - name: Tạo issue nếu có test fail
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              ...context.repo,
              title: `❌ Full suite thất bại — run #${context.runId}`,
              body: `Xem chi tiết: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ["test-failure", "needs-healing"],
            });
```

### 12.3 `.github/workflows/auto-heal.yml` — cập nhật theo tầng fail

```yaml
name: AI Self-Healing

on:
  workflow_run:
    workflows: ["Full Test Suite (main)", "PR Checks (Unit -> Integration -> E2E Regression)"]
    types: [completed]
  workflow_dispatch:
    inputs:
      level:
        description: "Tầng cần heal (unit | integration | e2e)"
        required: true
        default: "e2e"

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  heal:
    if: >
      github.event.workflow_run.conclusion == 'failure' ||
      github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch || github.ref }}
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps

      - name: Xác định tầng bị fail
        id: level
        run: echo "level=${{ github.event.inputs.level || 'e2e' }}" >> "$GITHUB_OUTPUT"

      - name: Chạy Healer Agent (tự vá nếu e2e, chỉ chẩn đoán nếu unit/integration)
        run: npx testkit heal --level ${{ steps.level.outputs.level }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Nhánh E2E: xác nhận bản vá rồi mở PR (như v1)
      - name: (E2E) Chạy lại để xác nhận bản vá
        if: steps.level.outputs.level == 'e2e'
        run: npx testkit test --level e2e --regression

      - name: (E2E) Mở Pull Request chứa bản vá
        if: steps.level.outputs.level == 'e2e' && success()
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "fix(tests): Healer Agent tự động vá E2E test bị fail"
          title: "🔧 [Auto-Heal] Đề xuất vá E2E test case bị fail"
          body: |
            PR này được AI tạo tự động. Xem `artifacts/healing-report.json` để biết chi tiết.
            ⚠️ Đây chỉ là đề xuất — vui lòng review kỹ trước khi merge.
          branch: auto-heal/${{ github.run_id }}
          labels: ai-generated, needs-review

      # Nhánh Unit/Integration: KHÔNG sửa code, chỉ mở Issue chẩn đoán
      - name: (Unit/Integration) Mở Issue chẩn đoán — không tự sửa test
        if: steps.level.outputs.level != 'e2e'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('artifacts/healing-report.json', 'utf8'));
            await github.rest.issues.create({
              ...context.repo,
              title: `🩺 [Cần xác nhận] Test ${{ steps.level.outputs.level }} fail — có thể là bug thật`,
              body: `Healer Agent đã chẩn đoán nhưng KHÔNG tự sửa test (chính sách \`diagnoseOnlyLevels\`).\n\n${JSON.stringify(report, null, 2)}`,
              labels: ["needs-human-review", "possible-regression"],
            });
```

---

## 13. Bảo mật & quản lý secret

- Không bao giờ** commit `.env` hay API key vào git — `setup.sh`/`setup.bat` tự thêm `.env` vào `.gitignore`.
- Trong GitHub Actions, luôn dùng **Settings → Secrets and variables → Actions** để lưu `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`... — không hard-code trong file yml.
- Mỗi tiến trình con agent chỉ nhận **đúng 1 biến API key** cần thiết (xem `buildScrubbedEnv` ở Mục 5.1) — hạn chế rủi ro nếu 1 backend bị lộ log thì các secret khác vẫn an toàn.
- Healer Agent **không có quyền merge/push trực tiếp vào `main`** — chỉ mở PR (`peter-evans/create-pull-request`), permission trong workflow chỉ cấp `contents: write` + `pull-requests: write`, không cấp quyền admin.
- Khi dùng GitHub Copilot CLI hoặc OpenAI Codex CLI trong CI, nên giới hạn tool được phép chạy (`--allow-tool`/`--deny-tool` với Copilot CLI, `--sandbox workspace-write` với Codex CLI) để agent không thể chạy lệnh hệ thống nguy hiểm ngoài phạm vi sửa test.

---

## 14. Luồng end-to-end minh họa (mở rộng cả 3 tầng, ví dụ `shopee-clone`)

1. Bạn viết hàm `applyDiscount(cartTotal, code)` trong `src/lib/discount.ts`.
2. `testkit plan --level unit --target src/lib/discount.ts` → Planner (whitebox, đọc code thật) sinh 5 case: `UT_DISCOUNT_001` → `005` (bao gồm cả case biên `cartTotal = 0` mà bạn có thể quên nghĩ tới).
3. `testkit generate --level unit --only UT_DISCOUNT_001,...,005` → Generator sinh `tests/unit/lib/discount.test.ts`.
4. `testkit test --level unit --coverage` → 118/120 pass toàn repo, riêng file này coverage branch 100%.
5. Bạn viết `app/api/cart/apply-discount/route.ts` gọi `applyDiscount()` + đọc DB.
6. `testkit plan --level integration --contract openapi/cart.yaml` → Planner (greybox, biết contract + schema DB, không đọc lại logic `applyDiscount`) sinh `IT_CART_API_001` → `003`.
7. `testkit generate --level integration` → sinh `tests/integration/api/cart/apply-discount.test.ts`, gọi thẳng `POST` export từ route handler + DB test thật.
8. `testkit test --level integration` → pass.
9. `testkit plan --level e2e --feature "Áp dụng mã giảm giá ở giỏ hàng"` → Planner (blackbox, chỉ thấy UI) sinh `TC_CART_020`.
10. `testkit generate --level e2e` → Generator sinh `tests/e2e/cart/discount-code.spec.ts`.
11. `testkit test --level e2e --ui` → bạn tự xem lại bằng UI Mode trước khi commit.
12. Push code, mở PR → `pr-checks.yml` chạy tuần tự: `unit` (12s, pass) → `integration` (48s, pass) → `e2e-regression` (chưa gồm `TC_CART_020` vì chưa gắn `@regression`).
13. Merge vào `main` → `main-full-suite.yml` chạy full 3 tầng, bao gồm `TC_CART_020`.
14. 3 tuần sau, đồng đội sửa `applyDiscount()` để đổi công thức làm tròn — vô tình gây `cartTotal` âm không bị chặn nữa. `UT_DISCOUNT_004` (case `cartTotal = 0`) fail.
15. `main-full-suite.yml` fail → `auto-heal.yml` chạy với `level=unit` → Healer **không tự sửa test** — mở Issue "🩺 [Cần xác nhận] Test unit fail — có thể là bug thật" kèm chẩn đoán: "assertion mong đợi lỗi `INVALID_CART` nhưng hàm trả về `NaN` — nghi ngờ do thay đổi công thức làm tròn ở dòng X, không phải do test lỗi thời".
16. Đồng đội đọc Issue, nhận ra đúng là bug thật (không phải test lỗi thời) → sửa lại `applyDiscount()`, không đụng vào test. **Đây chính là giá trị của việc không auto-heal ở tầng Unit — bug được giữ nguyên để lộ ra, không bị AI "dọn dẹp" mất.**

---

## 15. Rủi ro, hạn chế & lưu ý khi triển khai

- CLI của các AI backend thay đổi rất nhanh** (đặc biệt Copilot CLI và Antigravity CLI vừa ra mắt/thay đổi lớn trong nửa đầu 2026) — nên pin phiên bản cụ thể trong `package.json`/Docker image, và có test riêng cho lớp Adapter để phát hiện sớm khi 1 CLI đổi flag.
- **Chi phí API**: nếu dùng nhiều test case và gọi AI thường xuyên (đặc biệt Generator khi lần đầu tạo hàng trăm test), chi phí có thể tăng nhanh — nên theo dõi field `cost_usd`/token usage (Claude Code trả về field này trong `--output-format json`) và cân nhắc dùng Ollama cho các tác vụ ít quan trọng.
- **Healer có thể "vá sai hướng"**: AI có thể đoán sai nguyên nhân gốc (ví dụ sửa selector nhưng bug thật nằm ở logic nghiệp vụ) — đây là lý do bắt buộc con người review PR, không bao giờ auto-merge.
- **Flaky test không phải lúc nào cũng do AI sửa được**: nếu test flaky do timing/race-condition, Healer dễ "sửa nhầm" bằng cách thêm `waitForTimeout` tuỳ tiện — nên có quy tắc trong `prompt.md` của Healer cấm dùng timeout cứng, ưu tiên `expect(...).toPoll()` hoặc auto-waiting sẵn có của Playwright.
- **Bảo mật dữ liệu**: nếu dùng backend cloud (ChatGPT/Claude/Gemini/Copilot) mà repo có dữ liệu nhạy cảm, cân nhắc dùng Ollama local hoặc lọc bớt nội dung nhạy cảm trước khi đưa vào harness bundle.

- **Ranh giới Unit/Integration dễ bị lạm dụng**: nếu Planner ở tầng `unit` vô tình được cấp quá nhiều context (VD: cả DB thật), test "unit" thực chất biến thành "integration trá hình" — chạy chậm, không còn đúng vai trò lưới an toàn nhanh. Cần enforce cứng: tầng `unit` không được phép có network/DB access trong `vitest.config.ts` (dùng `test.pool: "forks"` cô lập, hoặc mock network toàn cục).
- **Giới hạn Vitest với Server Component bất đồng bộ** (Mục 4.2) là giới hạn kỹ thuật thật của hệ sinh thái hiện tại (không phải do thiết kế `testkit`) — cần Generator nhận diện đúng để không sinh ra unit test chắc chắn fail hoặc phải "giả lập" theo cách brittle.
- **`diagnose-only` có thể bị phớt lờ**: nếu team không có thói quen đọc GitHub Issue do Healer mở ra, lỗi Unit/Integration có thể bị treo vô thời hạn thay vì được xử lý — nên gắn thêm rule bảo vệ branch (branch protection) yêu cầu Issue dạng `possible-regression` phải được đóng trước khi merge PR liên quan.
- **Coverage cao không đồng nghĩa test tốt**: vòng lặp coverage-guided (Mục 6.5) đảm bảo *phủ* nhánh code, không đảm bảo *assertion* có ý nghĩa — vẫn cần review test do AI sinh, không chỉ nhìn % coverage.

---

## 16. Lộ trình mở rộng (Roadmap)

- Thêm agent thứ 5 tuỳ chọn: **Reviewer Agent** — review code test do Generator sinh ra trước khi commit (đúng convention code, không hardcode dữ liệu nhạy cảm...).
- Dashboard web nhỏ (đọc `test-results.json` lịch sử) để xem xu hướng pass rate theo thời gian, thay vì chỉ đọc từng file `.md` riêng lẻ.
- Hỗ trợ mobile app testing (Playwright + Appium hoặc Playwright cho mobile web) dùng chung kiến trúc 4 agent này.
- Cơ chế "confidence score" cho Healer — nếu AI tự đánh giá độ tin cậy bản vá thấp, tự động gắn nhãn PR mức độ ưu tiên review cao hơn.

- **Mutation testing** cho tầng Unit (VD: Stryker) — kiểm tra không chỉ coverage mà còn "test có thực sự bắt được lỗi không" bằng cách cố tình chèn lỗi (mutant) vào code rồi xem test có fail không.
- **Contract testing** chuyên biệt hơn cho tầng Integration (VD: Pact) nếu `shopee-clone` sau này tách thành nhiều service riêng thay vì Next.js monolith.
- Mở rộng bản đồ Mục 2.3 thành cấu hình per-project — cho phép team tự định nghĩa lại ánh xạ Whitebox/Greybox/Blackbox ↔ Unit/Integration/E2E nếu quy trình QA nội bộ khác đi.

---

## 17. Tài liệu tham khảo

- Playwright Test CLI: https://playwright.dev/docs/test-cli
- Playwright UI Mode: https://playwright.dev/docs/test-ui-mode
- Claude Code — Headless mode: https://code.claude.com/docs/en/headless
- GitHub Copilot CLI — tài liệu chính thức: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview
- GitHub Copilot CLI — mã nguồn: https://github.com/github/copilot-cli
- Google Antigravity CLI — thông báo chuyển đổi từ Gemini CLI: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- Google Antigravity CLI — giới thiệu sản phẩm: https://antigravity.google/blog/introducing-google-antigravity-cli
- Ollama: https://ollama.com
- Next.js — Testing với Vitest (giới hạn Server Component bất đồng bộ đã nêu ở Mục 4.2): tài liệu chính thức Next.js phần Testing/Vitest.
- Vitest — Coverage (v8 provider, cấu hình `thresholds`): tài liệu chính thức Vitest phần Coverage.
- `@testing-library/react` + `@testing-library/jest-dom`: tài liệu chính thức Testing Library.

---

*Hết tài liệu. Các đoạn code trong tài liệu là khung sườn minh hoạ (skeleton) để bắt tay triển khai, chưa phải code production hoàn chỉnh. Các con số CLI/flag của công cụ AI bên thứ 3 nên được đối chiếu lại docs chính thức tại thời điểm code thật vì các công cụ này cập nhật rất nhanh.*
