/**
 * Auth Capture — Tự động đăng nhập vào ứng dụng web và lưu Playwright storageState.
 *
 * Quy trình:
 * 1. Mở URL đăng nhập bằng Playwright.
 * 2. Điền username + password vào các ô form (tìm bằng label/placeholder/aria-label).
 * 3. Click nút Submit.
 * 4. Chờ redirect tới expectedRedirectUrl hoặc phát hiện login thành công.
 * 5. Lưu storageState (Cookie + localStorage) ra file .auth/storage-state.json.
 * 6. Lưu AuthSession metadata ra .auth/session.json.
 */

import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { AuthConfig, AuthSession } from './auth-session.js';
import {
  STORAGE_STATE_PATH,
  saveAuthSession,
  createNoAuthSession,
} from './auth-session.js';

// ─── Error types ──────────────────────────────────────────────────────────────

export class AuthCaptureError extends Error {
  constructor(
    public readonly code:
      | 'LOGIN_FORM_NOT_FOUND'
      | 'SUBMIT_BUTTON_NOT_FOUND'
      | 'REDIRECT_TIMEOUT'
      | 'STILL_ON_LOGIN_PAGE'
      | 'INVALID_CONFIG',
    message: string,
  ) {
    super(message);
    this.name = 'AuthCaptureError';
  }
}

// ─── Heuristics để tìm input và nút submit ────────────────────────────────────

const USERNAME_SELECTORS = [
  '[data-test="username"]',
  '[data-testid="username"]',
  '#user-name',
  '#username',
  'input[type="email"]',
  'input[placeholder*="username" i]',
  'input[placeholder*="user name" i]',
  'input[placeholder*="tên đăng nhập" i]',
  'input[placeholder*="tài khoản" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][name*="login" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
  'input[name="username"]',
  'input[name="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  '[data-test="password"]',
  '[data-testid="password"]',
  '#password',
  'input[type="password"]',
  'input[placeholder*="password" i]',
  'input[placeholder*="mật khẩu" i]',
  'input[name="password"]',
  'input[autocomplete="current-password"]',
];

const SUBMIT_SELECTORS = [
  '[data-test="login-button"]',
  '[data-testid="login-button"]',
  '#login-button',
  'input[type="submit"]',
  'button[type="submit"]',
  'input[value*="Login" i]',
  'input[value*="Đăng nhập" i]',
  'button:has-text("Đăng nhập")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Submit")',
];

async function findInputByLabelOrSelector(
  page: Page,
  label: string | undefined,
  fallbackSelectors: string[],
): Promise<import('playwright').Locator | null> {
  // Thử tìm theo label text trước
  if (label) {
    const byLabel = page.getByLabel(label, { exact: false });
    if (await byLabel.count() > 0) return byLabel.first();

    const byPlaceholder = page.getByPlaceholder(label, { exact: false });
    if (await byPlaceholder.count() > 0) return byPlaceholder.first();
  }
  // Fallback theo selector heuristic
  for (const selector of fallbackSelectors) {
    const el = page.locator(selector);
    if (await el.count() > 0) return el.first();
  }
  return null;
}

async function findSubmitButton(
  page: Page,
  label?: string,
): Promise<import('playwright').Locator | null> {
  if (label) {
    const byText = page.getByRole('button', { name: label, exact: false });
    if (await byText.count() > 0) return byText.first();
  }
  for (const selector of SUBMIT_SELECTORS) {
    const el = page.locator(selector);
    if (await el.count() > 0) return el.first();
  }
  return null;
}

function isLoginPage(url: string, loginUrl: string): boolean {
  try {
    const currentPath = new URL(url).pathname.toLowerCase();
    const loginPath = new URL(loginUrl).pathname.toLowerCase();
    return currentPath === loginPath
      || currentPath.includes('/login')
      || currentPath.includes('/dang-nhap')
      || currentPath.includes('/signin')
      || currentPath.includes('/auth');
  } catch {
    return url.includes('login') || url.includes('dang-nhap') || url.includes('signin');
  }
}

// ─── Core: Capture session bằng PLAYWRIGHT_STORAGE_STATE ─────────────────────

async function captureStorageStateSession(
  config: AuthConfig,
  context: BrowserContext,
  page: Page,
): Promise<AuthSession> {
  const loginUrl = config.loginUrl!;
  const timeout = config.loginTimeoutMs ?? 15000;

  console.log(`[Auth] Đang mở trang đăng nhập: ${loginUrl}`);
  await page.goto(loginUrl, { timeout, waitUntil: 'domcontentloaded' });

  // Chờ redirect nếu trang yêu cầu đăng nhập (ví dụ: trang đích redirect về /dang-nhap)
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // Timeout networkidle không ảnh hưởng — tiếp tục
  }

  const currentUrl = page.url();
  if (currentUrl !== loginUrl) {
    console.log(`[Auth] Trang đã redirect đến: ${currentUrl}`);
  }

  // Tìm và điền username
  let usernameInput = await findInputByLabelOrSelector(
    page,
    config.usernameLabel,
    USERNAME_SELECTORS,
  );

  // Nếu không tìm thấy form login → kiểm tra redirect
  if (!usernameInput && currentUrl !== loginUrl) {
    // Trang đã redirect (ví dụ: /to-chuc → /dang-nhap), thử tìm lại trên trang hiện tại
    console.log(`[Auth] Không tìm thấy form tại URL gốc, đang thử trên trang redirect: ${currentUrl}`);
    await page.waitForTimeout(1000);
    usernameInput = await findInputByLabelOrSelector(
      page,
      config.usernameLabel,
      USERNAME_SELECTORS,
    );
  }

  // Nếu vẫn không tìm thấy → tự dò URL login phổ biến
  if (!usernameInput) {
    const loginPatterns = ['/dang-nhap', '/login', '/signin', '/auth/login'];
    const baseUrl = new URL(loginUrl).origin;
    for (const pattern of loginPatterns) {
      const candidateUrl = baseUrl + pattern;
      if (candidateUrl === currentUrl) continue;
      console.log(`[Auth] Đang thử tìm form đăng nhập tại: ${candidateUrl}`);
      try {
        await page.goto(candidateUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        usernameInput = await findInputByLabelOrSelector(
          page,
          config.usernameLabel,
          USERNAME_SELECTORS,
        );
        if (usernameInput) {
          console.log(`[Auth] ✅ Tìm thấy form đăng nhập tại: ${candidateUrl}`);
          break;
        }
      } catch {
        // Bỏ qua URL không truy cập được
      }
    }
  }

  if (!usernameInput) {
    throw new AuthCaptureError(
      'LOGIN_FORM_NOT_FOUND',
      `Không tìm thấy ô nhập username/email.\n` +
      `  URL nhập: ${loginUrl}\n` +
      `  URL hiện tại: ${currentUrl}\n` +
      `  Gợi ý: Hãy nhập đúng URL trang đăng nhập (ví dụ: .../dang-nhap)`,
    );
  }
  await usernameInput.fill(config.username ?? '');
  console.log('[Auth] Đã điền username.');

  // Tìm và điền password
  const passwordInput = await findInputByLabelOrSelector(
    page,
    config.passwordLabel,
    PASSWORD_SELECTORS,
  );
  if (!passwordInput) {
    throw new AuthCaptureError(
      'LOGIN_FORM_NOT_FOUND',
      `Không tìm thấy ô nhập password trên trang: ${loginUrl}`,
    );
  }
  await passwordInput.fill(config.password ?? '');
  console.log('[Auth] Đã điền password.');

  // Tìm và click nút Submit
  const submitBtn = await findSubmitButton(page, config.submitButtonLabel);
  if (!submitBtn) {
    throw new AuthCaptureError(
      'SUBMIT_BUTTON_NOT_FOUND',
      `Không tìm thấy nút submit trên trang: ${loginUrl}. ` +
      'Thử chỉ định submitButtonLabel trong config.',
    );
  }

  // Click và chờ navigation
  console.log('[Auth] Đang click nút đăng nhập...');
  await Promise.all([
    page.waitForURL(url => !isLoginPage(url.toString(), loginUrl), { timeout }),
    submitBtn.click(),
  ]).catch(async () => {
    // Nếu không navigate ra khỏi login page, kiểm tra xem có expectedRedirectUrl không
    if (config.expectedRedirectUrl) {
      await page.waitForURL(`**${config.expectedRedirectUrl}**`, { timeout: 5000 });
    }
  });

  // Xác nhận không còn trên trang login
  if (isLoginPage(page.url(), loginUrl)) {
    throw new AuthCaptureError(
      'STILL_ON_LOGIN_PAGE',
      `Sau khi click Submit vẫn đang ở trang đăng nhập (${page.url()}). ` +
      'Kiểm tra lại credentials hoặc cấu hình usernameLabel/passwordLabel.',
    );
  }

  console.log(`[Auth] Đăng nhập thành công! URL hiện tại: ${page.url()}`);

  // Lưu storageState
  const absoluteStorageStatePath = path.resolve(STORAGE_STATE_PATH);
  await context.storageState({ path: absoluteStorageStatePath });
  console.log(`[Auth] Đã lưu storageState tại: ${absoluteStorageStatePath}`);

  const session: AuthSession = {
    strategy: 'PLAYWRIGHT_STORAGE_STATE',
    storageStatePath: absoluteStorageStatePath,
    capturedAt: new Date().toISOString(),
    loginUrl,
  };
  saveAuthSession(session);
  return session;
}

// ─── Core: Tạo session bằng JWT_HEADER ────────────────────────────────────────

function captureJwtHeaderSession(config: AuthConfig): AuthSession {
  if (!config.jwtToken) {
    throw new AuthCaptureError(
      'INVALID_CONFIG',
      'Chiến lược JWT_HEADER yêu cầu jwtToken trong config hoặc env var AUTH_JWT_TOKEN.',
    );
  }
  const session: AuthSession = {
    strategy: 'JWT_HEADER',
    extraHeaders: { 'Authorization': `Bearer ${config.jwtToken}` },
    capturedAt: new Date().toISOString(),
    loginUrl: config.loginUrl,
  };
  saveAuthSession(session);
  return session;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Mở Chromium, đăng nhập theo config và lưu session để tái sử dụng.
 *
 * @param config - Cấu hình xác thực
 * @returns AuthSession đã được lưu vào .auth/
 */
export async function captureAuthSession(config: AuthConfig): Promise<AuthSession> {
  if (config.strategy === 'NONE') {
    return createNoAuthSession();
  }

  if (config.strategy === 'JWT_HEADER') {
    return captureJwtHeaderSession(config);
  }

  // PLAYWRIGHT_STORAGE_STATE
  if (!config.loginUrl) {
    throw new AuthCaptureError(
      'INVALID_CONFIG',
      'loginUrl là bắt buộc với chiến lược PLAYWRIGHT_STORAGE_STATE.',
    );
  }
  if (!config.username || !config.password) {
    throw new AuthCaptureError(
      'INVALID_CONFIG',
      'username và password là bắt buộc với chiến lược PLAYWRIGHT_STORAGE_STATE.',
    );
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const session = await captureStorageStateSession(config, context, page);
    await context.close();
    return session;
  } finally {
    if (browser) await browser.close();
  }
}
