/**
 * Discovery Crawler — Tự động quét đa trang web, thu thập element tương tác.
 *
 * Quy trình:
 * 1. Mở Playwright browser với auth session (storageState hoặc JWT header).
 * 2. Duyệt qua từng seedUrl người dùng cung cấp.
 * 3. Tại mỗi trang: chạy CAPTURE_SNAPSHOT_SCRIPT để thu thập element.
 * 4. Khám phá navigation links cùng domain → thêm vào queue.
 * 5. Giới hạn maxPages, maxDepth, chỉ cùng domain.
 */

import { chromium, Browser, Page } from 'playwright';
import type { AuthSession } from '../../core/auth/auth-session.js';
import type { ElementInfo } from '../../core/locator-resolver.js';
import { CAPTURE_SNAPSHOT_SCRIPT, captureSnapshot } from './live-runner.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PageDiscovery {
  url: string;
  title: string;
  elements: ElementInfo[];
  navLinks: string[];
}

export interface DiscoveryResult {
  pages: PageDiscovery[];
  totalElements: number;
  totalPages: number;
}

export interface DiscoveryCrawlerOptions {
  maxPages?: number;
  maxDepth?: number;
  sameDomainOnly?: boolean;
  headless?: boolean;
}

// ─── Script thu thập navigation links cùng domain ───────────────────────────

function collectNavLinksScript(baseDomain: string): string {
  return `
    (() => {
      const baseDomain = ${JSON.stringify(baseDomain)};
      const links = [];

      // 1. Quét tất cả các thẻ anchor <a href>
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const anchor of anchors) {
        try {
          const rawHref = anchor.getAttribute('href') || '';
          if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#' || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
            continue;
          }
          const url = new URL(anchor.href, document.location.href);
          if (url.hostname === baseDomain
              && url.protocol.startsWith('http')
              && !url.pathname.includes('dang-xuat')
              && !url.pathname.includes('logout')
              && !url.pathname.includes('signout')) {
            const cleanUrl = url.origin + url.pathname + (url.search || '');
            links.push(cleanUrl);
          }
        } catch {}
      }

      // 2. Quét các phần tử menu/router SPA có data-href, data-path, routerlink, to
      const routerElements = Array.from(document.querySelectorAll('[data-href], [data-path], [routerlink], [to], [data-menu-id]'));
      for (const el of routerElements) {
        try {
          const pathVal = el.getAttribute('data-href') || el.getAttribute('data-path') || el.getAttribute('routerlink') || el.getAttribute('to') || el.getAttribute('data-menu-id') || '';
          if (pathVal && !pathVal.startsWith('http') && pathVal.startsWith('/')) {
            const fullUrl = new URL(pathVal, document.location.origin).href;
            if (!fullUrl.includes('dang-xuat') && !fullUrl.includes('logout')) {
              links.push(fullUrl);
            }
          }
        } catch {}
      }

      // 3. Quét các thẻ li/div/span trong sidebar menu có thể chứa link
      const sidebarLinks = Array.from(document.querySelectorAll('.sidebar a, nav a, .ant-menu a, [role="menu"] a, .menu a'));
      for (const el of sidebarLinks) {
        try {
          const href = (el as HTMLAnchorElement).href;
          if (href) {
            const url = new URL(href, document.location.href);
            if (url.hostname === baseDomain && !url.pathname.includes('logout')) {
              links.push(url.origin + url.pathname + (url.search || ''));
            }
          }
        } catch {}
      }

      return [...new Set(links)];
    })()
  `;
}

// ─── Hàm chờ DOM ổn định ────────────────────────────────────────────────────

async function waitForStableDom(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await page.waitForFunction(
      `document.querySelector('input, textarea, select, button, a[href], [role], li, [class*="menu"]') !== null`,
      undefined,
      { timeout: 8000 },
    );
    // Tự động bung mở toàn bộ Accordion / Sidebar menu cha đang đóng để cào toàn bộ element con
    await page.evaluate(() => {
      try {
        const closedAccordions = Array.from(document.querySelectorAll('aside [aria-expanded="false"], nav [aria-expanded="false"], [class*="sidebar"] [class*="collapse"], [class*="sidebar"] [data-state="closed"], details:not([open])'));
        for (const el of closedAccordions) {
          (el as HTMLElement).click?.();
        }
      } catch {}
    }).catch(() => {});

    // Chờ thêm 500ms cho SPA render đầy đủ các sub-elements
    await page.waitForTimeout(500);
  } catch {
    // Trang có thể không có element tương tác — vẫn snapshot
  }
}

// ─── Hàm chính: Discovery Crawler ──────────────────────────────────────────

export async function runDiscoveryCrawler(
  seedUrls: string[],
  authSession: AuthSession,
  options: DiscoveryCrawlerOptions = {},
  authInfo?: { loginUrl?: string; username?: string; password?: string },
): Promise<DiscoveryResult> {
  const maxPages = options.maxPages ?? 15;
  const maxDepth = options.maxDepth ?? 3;
  const sameDomainOnly = options.sameDomainOnly ?? true;
  const headless = options.headless ?? true;

  // Xác định domain gốc từ seedUrl đầu tiên
  let baseDomain = '';
  try {
    baseDomain = new URL(seedUrls[0]).hostname;
  } catch {
    throw new Error(`URL gốc không hợp lệ: ${seedUrls[0]}`);
  }

  // Queue BFS: { url, depth }
  const queue: Array<{ url: string; depth: number }> = [];
  const visited = new Set<string>();
  const pages: PageDiscovery[] = [];

  // Khởi tạo queue từ seedUrls
  for (const seed of seedUrls) {
    const normalized = normalizeUrl(seed);
    if (!visited.has(normalized)) {
      queue.push({ url: normalized, depth: 0 });
      visited.add(normalized);
    }
  }

  // Mở browser
  const browser: Browser = await chromium.launch({ headless });
  try {
    const contextOptions: Record<string, unknown> = {};

    // Inject auth session nếu có
    if (authSession.strategy === 'PLAYWRIGHT_STORAGE_STATE' && authSession.storageStatePath) {
      contextOptions['storageState'] = authSession.storageStatePath;
    }
    if (authSession.strategy === 'JWT_HEADER' && authSession.extraHeaders) {
      contextOptions['extraHTTPHeaders'] = authSession.extraHeaders;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // ★ TỰ ĐỘNG ĐĂNG NHẬP TRỰC TIẾP TRƯỚC KHI QUÉT NẾU CÓ THÔNG TIN AUTH
    if (authInfo?.loginUrl && authInfo?.username && authInfo?.password) {
      console.log(`   🔐 [Discovery Auth] Đang đăng nhập tự động vào ${authInfo.loginUrl}...`);
      try {
        await page.goto(authInfo.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await waitForStableDom(page);

        // Nhập username
        await page.getByPlaceholder(/tên đăng nhập|username|user name|email/i)
          .or(page.getByLabel(/tên đăng nhập|username|user name|email/i))
          .or(page.locator('[data-test="username"], [data-testid="username"], #user-name, input[name*="user"], input[name*="email"], input[type="text"]'))
          .first()
          .fill(authInfo.username);

        // Nhập password
        await page.getByPlaceholder(/mật khẩu|password/i)
          .or(page.getByLabel(/mật khẩu|password/i))
          .or(page.locator('[data-test="password"], [data-testid="password"], #password, input[type="password"]'))
          .first()
          .fill(authInfo.password);

        // Click Login
        await page.getByRole('button', { name: /đăng nhập|login|sign in|submit/i })
          .or(page.locator('[data-test="login-button"], [data-testid="login-button"], #login-button, input[type="submit"], button[type="submit"]'))
          .first()
          .click();

        // Chờ chuyển hướng khỏi trang login hoặc mất form login
        const initialLoginUrl = page.url();
        await page.waitForURL(url => url.href !== initialLoginUrl && !url.href.includes('dang-nhap') && !url.href.includes('login'), { timeout: 15000 }).catch(() => {});
        await waitForStableDom(page);

        const currentUrlAfterLogin = page.url();
        console.log(`   ✅ [Discovery Auth] Đăng nhập thành công! Trang đích: ${currentUrlAfterLogin}`);

        // Đưa trang đích sau login vào queue đầu tiên
        const normAfterLogin = normalizeUrl(currentUrlAfterLogin);
        if (!visited.has(normAfterLogin)) {
          queue.unshift({ url: normAfterLogin, depth: 0 });
          visited.add(normAfterLogin);
        }
      } catch (authErr: any) {
        console.warn(`   ⚠️ [Discovery Auth] Tự động đăng nhập không thành công: ${authErr.message}`);
      }
    }

    // BFS: Duyệt từng URL trong queue
    while (queue.length > 0 && pages.length < maxPages) {
      const current = queue.shift()!;
      const { url, depth } = current;

      console.log(`   Trang ${pages.length + 1}/${maxPages}: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await waitForStableDom(page);

        // Thu thập element tương tác
        const snapshot = await captureSnapshot(page, `discovery:${url}`);
        const visibleElements = snapshot.elements.filter(el => el.isVisible);

        // Thu thập navigation links
        let navLinks: string[] = [];
        if (depth < maxDepth) {
          try {
            navLinks = await page.evaluate(collectNavLinksScript(baseDomain)) as string[];
          } catch {
            navLinks = [];
          }
        }

        // Tóm tắt element
        const inputCount = visibleElements.filter(el =>
          el.tag === 'input' || el.tag === 'textarea',
        ).length;
        const selectCount = visibleElements.filter(el =>
          el.tag === 'select' || el.ariaHasPopup || el.role === 'combobox',
        ).length;
        const buttonCount = visibleElements.filter(el =>
          el.tag === 'button' || el.role === 'button',
        ).length;
        const linkCount = visibleElements.filter(el =>
          el.tag === 'a' || el.role === 'link',
        ).length;

        console.log(
          `   → Phát hiện ${visibleElements.length} element tương tác` +
          ` (${inputCount} input, ${selectCount} select, ${buttonCount} button, ${linkCount} link)`,
        );

        const title = await page.title();
        pages.push({ url, title, elements: visibleElements, navLinks });

        // Thêm navLinks vào queue (BFS)
        if (sameDomainOnly && depth < maxDepth) {
          for (const link of navLinks) {
            const normalized = normalizeUrl(link);
            if (!visited.has(normalized) && queue.length + pages.length < maxPages * 3) {
              try {
                const linkDomain = new URL(normalized).hostname;
                if (linkDomain === baseDomain) {
                  queue.push({ url: normalized, depth: depth + 1 });
                  visited.add(normalized);
                }
              } catch {}
            }
          }
        }
      } catch (err: any) {
        console.warn(`   ⚠️ Không thể truy cập ${url}: ${err.message}`);
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const totalElements = pages.reduce((sum, p) => sum + p.elements.length, 0);
  return { pages, totalElements, totalPages: pages.length };
}

// ─── Build Discovery Report ──────────────────────────────────────────────────

function reportCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function buildDiscoveryReport(result: DiscoveryResult): string {
  const lines: string[] = [
    '# Discovery Crawler Report',
    '',
    `- Tổng số trang đã quét: ${result.totalPages}`,
    `- Tổng số element tương tác: ${result.totalElements}`,
    `- Thời điểm quét: ${new Date().toLocaleString('vi-VN')}`,
    '',
  ];

  for (const page of result.pages) {
    lines.push(`## 📄 ${page.title || 'Không tiêu đề'}`);
    lines.push(`**URL**: \`${page.url}\``);
    lines.push(`**Elements**: ${page.elements.length}`);
    lines.push('');

    if (page.elements.length === 0) {
      lines.push('_Không có element tương tác._');
      lines.push('');
      continue;
    }

    lines.push(
      '| Tag | Type/Role | Accessible name | Label/Placeholder | Text | ID/Name | Selector |',
    );
    lines.push(
      '| --- | --- | --- | --- | --- | --- | --- |',
    );

    // Bao gồm đầy đủ tất cả element tương tác cào được, sắp xếp theo độ ưu tiên
    const sorted = [...page.elements]
      .sort((a, b) => elementScore(b) - elementScore(a));

    for (const el of sorted) {
      lines.push(`| ${[
        el.tag,
        [el.type, el.role].filter(Boolean).join('/'),
        el.accessibleName || el.ariaLabel,
        el.labelText || el.placeholder,
        el.text,
        el.testId || el.id || el.name,
        el.selector,
      ].map(reportCell).join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Bỏ trailing slash, query, hash để tránh quét trùng
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function elementScore(el: ElementInfo): number {
  let score = 0;
  if (el.selector) score += 5;
  if (el.placeholder || el.ariaLabel || el.accessibleName) score += 4;
  if (el.testId || el.id || el.name) score += 3;
  if (['input', 'textarea', 'select', 'button'].includes(el.tag)) score += 3;
  if (el.labelText) score += 2;
  if (el.tag === 'a' && el.text) score += 1;
  return score;
}
