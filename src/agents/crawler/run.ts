import { chromium } from "playwright";
import fs from "fs";
import path from "path";

export interface CrawledPageData {
  url: string;
  title: string;
  headings: { level: string; text: string }[];
  forms: {
    id: string;
    action: string;
    fields: {
      tag: string;
      type: string;
      id: string;
      name: string;
      placeholder: string;
      label: string;
      selector: string;
    }[];
    buttons: {
      text: string;
      type: string;
      id: string;
      selector: string;
    }[];
  }[];
  navLinks: { text: string; href: string }[];
  buttons: { text: string; id: string; selector: string }[];
  genericIcons?: { semantic: string; selector: string; location: string }[];
  alerts: string[];
  errorMessages: string[];
  validationProbe: {
    triggerAction: string;
    errorElements: { selector: string; text: string; tagName: string; className: string }[];
  }[];
}

export async function runCrawler(url: string): Promise<string> {
  console.log(`\[Crawler Agent] Đang phân tích trang: ${url}`);
  console.log(`   → Thu thập DOM ...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    } catch {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    
    await page.waitForTimeout(2500);

    const finalUrl = page.url();

    const data: CrawledPageData = await page.evaluate((effectiveUrl) => {
      // ── Tiêu đề ──────────────────────────────────────────────────
      const title = document.title;

      // ── Headings ─────────────────────────────────────────────────
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, .oxd-text--h5, .oxd-text--h6")
      ).slice(0, 15).map((h) => ({
        level: h.tagName.toLowerCase(),
        text: h.textContent?.trim() || "",
      }));

      // ── Forms ────────────────────────────────────────────────────
      const forms = Array.from(document.querySelectorAll("form, .oxd-form")).map(
        (form, fi) => {
          const formEl = form as HTMLElement;

          const fields = Array.from(
            form.querySelectorAll("input, select, textarea, .oxd-input")
          )
            .filter((el) => {
              const input = el as HTMLInputElement;
              return !["hidden", "submit", "button"].includes(input.type);
            })
            .map((el) => {
              const input = el as HTMLInputElement;
              // Tìm label liên kết
              let labelText = "";
              if (input.id) {
                const labelEl = document.querySelector(
                  `label[for="${input.id}"]`
                );
                labelText = labelEl?.textContent?.trim() || "";
              }
              if (!labelText) {
                const parentGroup = input.closest(".oxd-input-group, .form-group, label");
                if (parentGroup) {
                  const labelEl = parentGroup.querySelector("label, .oxd-label");
                  labelText = labelEl?.textContent?.trim() || "";
                }
              }

              // Tạo selector ưu tiên: placeholder > label > name > id > class
              let selector = "";
              const classStr = typeof input.className === 'string' ? input.className : (input.className && (input.className as any).baseVal) || '';
              if (input.placeholder) selector = `getByPlaceholder('${input.placeholder}')`;
              else if (labelText) selector = `getByLabel('${labelText}')`;
              else if (input.name) selector = `locator('[name="${input.name}"]')`;
              else if (input.id) selector = `locator('#${input.id}')`;
              else selector = `locator('${input.tagName.toLowerCase()}${classStr ? '.' + classStr.split(' ').filter(Boolean).join('.') : ''}')`;

              return {
                tag: input.tagName.toLowerCase(),
                type: (input as HTMLInputElement).type || "text",
                id: input.id || "",
                name: input.name || "",
                placeholder: (input as HTMLInputElement).placeholder || "",
                label: labelText,
                selector,
              };
            });

          const buttons = Array.from(
            form.querySelectorAll("button, input[type='submit'], .oxd-button")
          ).map((el) => {
            const btn = el as HTMLElement;
            const text = btn.textContent?.trim() || (btn as HTMLInputElement).value || "";
            const selector = btn.id
              ? `#${btn.id}`
              : `getByRole('button', { name: '${text}' })`;
            return {
              text,
              type: (btn as HTMLButtonElement).type || "submit",
              id: btn.id || "",
              selector,
            };
          });

          // ── Password Toggle Icons (icon con mắt ẩn/hiện mật khẩu) ──
          const passwordToggles: { selector: string; ariaLabel: string; nearInput: string }[] = [];
          const passwordInputs = form.querySelectorAll('input[type="password"]');
          passwordInputs.forEach((pwInput) => {
            const parent = pwInput.parentElement;
            if (parent) {
              // Tìm button/icon nằm cùng container với ô password
              const toggleBtns = parent.querySelectorAll('button[type="button"], [role="button"], svg, i');
              toggleBtns.forEach((toggle) => {
                const el = toggle as HTMLElement;
                const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || '';
                const className = typeof el.className === 'string' ? el.className : (el.className as any)?.baseVal || '';
                let selector = '';
                if (el.getAttribute('aria-label')) {
                  selector = `getByLabel('${ariaLabel}')`;
                } else if (el.id) {
                  selector = `#${el.id}`;
                } else if (className) {
                  const safeClass = className.split(' ').filter(Boolean).join('.');
                  selector = `locator('${el.tagName.toLowerCase()}${safeClass ? '.' + safeClass : ''}')`;
                } else {
                  selector = `locator('input[type="password"]').locator('..').locator('button')`;
                }
                passwordToggles.push({
                  selector,
                  ariaLabel,
                  nearInput: (pwInput as HTMLInputElement).placeholder || (pwInput as HTMLInputElement).name || 'password',
                });
              });
            }
          });

          return {
            id: formEl.id || `form-${fi}`,
            action: (formEl as HTMLFormElement).action || "",
            fields,
            buttons,
            passwordToggles,
          };
        }
      );

      // ── Navigation Links ─────────────────────────────────────────
      const navLinks = Array.from(
        document.querySelectorAll("nav a, header a, .navbar a")
      )
        .slice(0, 30)
        .map((a) => ({
          text: a.textContent?.trim() || "",
          href: (a as HTMLAnchorElement).href || "",
        }))
        .filter((l) => l.text && l.href);

      // ── Standalone Buttons ────────────────────────────────────────
      const buttons = Array.from(
        document.querySelectorAll("button:not(form button)")
      )
        .slice(0, 20)
        .map((btn) => {
          const b = btn as HTMLButtonElement;
          const text = b.textContent?.trim() || "";
          return {
            text,
            id: b.id || "",
            selector: b.id
              ? `#${b.id}`
              : `getByRole('button', { name: '${text}' })`,
          };
        })
        .filter((b) => b.text);

      // ── Generic Icon Detection Engine (Tự động nhận diện Icon không có text trên MỌI trang web) ──
      const genericIcons: { semantic: string; selector: string; location: string }[] = [];
      const iconCandidates = Array.from(document.querySelectorAll('button, a, svg, i, [role="button"]'));
      
      iconCandidates.forEach((el) => {
        const text = el.textContent?.trim() || "";
        // Chỉ xử lý các element không có text (hoặc text quá ngắn <= 2 ký tự)
        if (text.length <= 2) {
          const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
          const rawClass = typeof el.className === 'string' ? el.className : (el.className as any)?.baseVal || '';
          const fullIdent = `${ariaLabel} ${rawClass} ${el.id} ${el.tagName}`.toLowerCase();

          let semantic = '';
          if (/eye|view|show|see|preview|xem|detail/i.test(fullIdent)) semantic = 'view_eye (Xem/Con mắt)';
          else if (/edit|pencil|pen|modify|sua|sửa|write/i.test(fullIdent)) semantic = 'edit_pencil (Sửa/Cây bút)';
          else if (/trash|delete|remove|bin|xoa|xóa/i.test(fullIdent)) semantic = 'delete_trash (Xóa/Thùng rác)';
          else if (/plus|add|create|them|thêm/i.test(fullIdent)) semantic = 'add_plus (Thêm)';
          else if (/search|find|lookup|tim|tìm/i.test(fullIdent)) semantic = 'search_magnifier (Tìm kiếm)';
          else if (/setting|cog|gear|config|cai-dat/i.test(fullIdent)) semantic = 'settings_gear (Cài đặt)';
          else if (/close|times|cancel|dong|đóng/i.test(fullIdent)) semantic = 'close_x (Đóng)';
          else if (/filter|funnel|loc|lọc/i.test(fullIdent)) semantic = 'filter_funnel (Bộ lọc)';

          if (semantic) {
            let selector = '';
            if (ariaLabel) selector = `getByLabel('${ariaLabel}')`;
            else if (el.id) selector = `#${el.id}`;
            else if (rawClass) {
              const safeClass = rawClass.split(' ').filter(Boolean).join('.');
              selector = `locator('${el.tagName.toLowerCase()}.${safeClass}')`;
            } else {
              selector = `locator('${el.tagName.toLowerCase()}')`;
            }

            const inTable = !!el.closest('table, [role="table"], [class*="table"], [class*="grid"]');
            const location = inTable ? 'data_table_row' : 'page_body';

            genericIcons.push({ semantic, selector, location });
          }
        }
      });

      // ── Alert / Error Messages ────────────────────────────────────
      const alerts = Array.from(
        document.querySelectorAll(".alert, .alert-danger, .alert-success, .error-message")
      ).map((el) => el.textContent?.trim() || "");

      const errorMessages = Array.from(
        document.querySelectorAll(".has-error .help-block, .invalid-feedback, [class*='error']")
      )
        .slice(0, 10)
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean);

      return {
        url: effectiveUrl,
        title,
        headings,
        forms,
        navLinks,
        buttons,
        genericIcons: genericIcons.slice(0, 30),
        alerts,
        errorMessages,
      };
    }, finalUrl);

    // Interaction Probe da bi loai bo vi nguy co tac dong ngoai y muon
    // (tu dong submit form co the tao du lieu rac trong DB)
    data.validationProbe = [];

    await browser.close();

    // Format output dạng markdown có cấu trúc cho AI đọc
    const report = formatCrawledData(data);

    console.log(`[Crawler] Đã thu thập xong! Tìm thấy:`);
    console.log(`   - ${data.forms.length} form(s)`);
    console.log(`   - ${data.navLinks.length} navigation link(s)`);
    console.log(`   - ${data.buttons.length} standalone button(s)`);
    console.log(`   - ${validationProbe.reduce((n, p) => n + p.errorElements.length, 0)} validation/error element(s)`);

    return report;
  } catch (error: any) {
    await browser.close();
    console.error(`[Crawler] Lỗi khi crawl trang: ${error.message}`);
    return `URL: ${url}\n\n[CRAWLER ERROR]: ${error.message}\nAI sẽ sinh test case dựa trên URL, kết quả có thể kém chính xác.`;
  }
}

function formatCrawledData(data: CrawledPageData): string {
  const lines: string[] = [];

  lines.push(`# DOM Report - ${data.title}`);
  lines.push(`**URL**: ${data.url}`);
  lines.push(`**Page Title**: ${data.title}`);
  lines.push("");

  // Headings
  if (data.headings.length > 0) {
    lines.push("## Page Headings");
    data.headings.forEach((h) => lines.push(`- [${h.level.toUpperCase()}] ${h.text}`));
    lines.push("");
  }

  // Forms
  if (data.forms.length > 0) {
    lines.push("## Forms (Locators chính xác từ DOM)");
    data.forms.forEach((form, i) => {
      lines.push(`### Form ${i + 1}: id="${form.id}", action="${form.action}"`);

      if (form.fields.length > 0) {
        lines.push("**Input Fields:**");
        form.fields.forEach((f) => {
          lines.push(
            `- type="${f.type}" | label="${f.label}" | placeholder="${f.placeholder}" | id="${f.id}" | name="${f.name}"`
          );
          lines.push(`  → Playwright locator: \`page.${f.selector}\``);
        });
      }

      if (form.buttons.length > 0) {
        lines.push("**Buttons:**");
        form.buttons.forEach((b) => {
          lines.push(`- text="${b.text}" | type="${b.type}" | id="${b.id}"`);
          lines.push(`  → Playwright locator: \`page.${b.selector}\``);
        });
      }
      lines.push("");
    });
  }

  // Validation Probe Results — QUAN TRỌNG cho Generator
  if (data.validationProbe && data.validationProbe.length > 0) {
    lines.push("## Validation & Error Elements (Phát hiện qua Interaction Probe)");
    lines.push("> **QUAN TRỌNG**: Đây là các phần tử lỗi/validation THẬT SỰ xuất hiện trên trang.");
    lines.push("> Generator PHẢI sử dụng chính xác các selector và text này, KHÔNG ĐƯỢC đoán mò.");
    lines.push("");

    data.validationProbe.forEach((probe) => {
      lines.push(`### Trigger: "${probe.triggerAction}"`);
      probe.errorElements.forEach((el) => {
        lines.push(`- **selector**: \`${el.selector}\` | **text**: "${el.text}" | tag: ${el.tagName} | class: "${el.className}"`);
        lines.push(`  → Playwright assertion: \`await expect(page.locator('${el.selector}')).toContainText('${el.text}');\``);
      });
      lines.push("");
    });
  }

  // Nav Links
  if (data.navLinks.length > 0) {
    lines.push("## Navigation Links");
    data.navLinks
      .filter((l) => l.text)
      .forEach((l) => lines.push(`- "${l.text}" → ${l.href}`));
    lines.push("");
  }

  // Standalone Buttons
  if (data.buttons.length > 0) {
    lines.push("## Standalone Buttons");
    data.buttons.forEach((b) => {
      lines.push(`- text="${b.text}"`);
      lines.push(`  → Playwright locator: \`page.${b.selector}\``);
    });
    lines.push("");
  }

  // Generic Icon Map (Tự động nhận diện Icon không chữ)
  if (data.genericIcons && data.genericIcons.length > 0) {
    lines.push("## Generic Icon Map (Biểu tượng & Nút bấm không chữ)");
    lines.push("> Crawler phát hiện các Icon tự động. Sử dụng các locator này khi kịch bản mô tả icon:");
    data.genericIcons.forEach((ic) => {
      lines.push(`- **Loại Icon**: ${ic.semantic} | Vị trí: ${ic.location}`);
      lines.push(`  → Playwright locator: \`page.${ic.selector}\``);
    });
    lines.push("");
  }

  // Alerts
  if (data.alerts.length > 0) {
    lines.push("## Alert / Error Message Selectors");
    data.alerts.forEach((a) => lines.push(`- "${a}"`));
    lines.push("");
  }

  return lines.join("\n");
}
