/**
 * Auth Session — Kiểu dữ liệu và thao tác lưu/đọc phiên xác thực Playwright.
 *
 * Hỗ trợ 3 chiến lược:
 * - PLAYWRIGHT_STORAGE_STATE: Dùng storageState (Cookie + localStorage) sau khi đăng nhập.
 * - JWT_HEADER: Inject Authorization: Bearer <token> vào BrowserContext.extraHTTPHeaders.
 * - NONE: Không cần xác thực (public routes).
 */

import fs from 'fs';
import path from 'path';

// ─── Chiến lược xác thực ────────────────────────────────────────────────────

export type AuthStrategy = 'NONE' | 'PLAYWRIGHT_STORAGE_STATE' | 'JWT_HEADER';

// ─── Cấu hình Auth — Được đọc từ CLI hoặc file .auth/ci-config.json ─────────

export interface AuthConfig {
  /** Chiến lược xác thực áp dụng. */
  strategy: AuthStrategy;
  /** URL trang đăng nhập. Bắt buộc với PLAYWRIGHT_STORAGE_STATE / JWT_HEADER. */
  loginUrl?: string;
  /** Tên/label của ô nhập Username/Email trên form. */
  usernameLabel?: string;
  /** Tên/label của ô nhập Password trên form. */
  passwordLabel?: string;
  /** Giá trị username thực tế. */
  username?: string;
  /** Giá trị password thực tế. */
  password?: string;
  /**
   * URL (hoặc path pattern) mà website redirect tới sau khi đăng nhập thành công.
   * Ví dụ: '/dashboard', 'https://app.example.com/home'
   */
  expectedRedirectUrl?: string;
  /** Label nút Submit login. Mặc định: tự detect nút type=submit trong form. */
  submitButtonLabel?: string;
  /** Timeout (ms) chờ redirect sau khi click Submit. Mặc định: 15000ms. */
  loginTimeoutMs?: number;
  /** Token JWT (chỉ dùng với JWT_HEADER). Đọc từ env nếu không có trong file. */
  jwtToken?: string;
}

// ─── Kết quả sau khi capture session ─────────────────────────────────────────

export interface AuthSession {
  strategy: AuthStrategy;
  /** Đường dẫn tuyệt đối tới file storageState JSON của Playwright. */
  storageStatePath?: string;
  /** HTTP headers inject vào BrowserContext khi dùng JWT_HEADER. */
  extraHeaders?: Record<string, string>;
  /** Thời điểm session được capture (ISO string). */
  capturedAt: string;
  /** URL đăng nhập đã dùng khi capture. */
  loginUrl?: string;
}

// ─── Đường dẫn mặc định ──────────────────────────────────────────────────────

export const AUTH_DIR = '.auth';
export const SESSION_PATH = path.join(AUTH_DIR, 'session.json');
export const CI_CONFIG_PATH = path.join(AUTH_DIR, 'ci-config.json');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'storage-state.json');

// ─── Save / Load session ──────────────────────────────────────────────────────

/** Lưu AuthSession ra file để tái sử dụng. */
export function saveAuthSession(session: AuthSession, filePath = SESSION_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
}

/** Đọc AuthSession đã lưu. Trả về null nếu không có hoặc không hợp lệ. */
export function loadAuthSession(filePath = SESSION_PATH): AuthSession | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AuthSession;
    if (!parsed.strategy || !parsed.capturedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Xoá session đã cache để buộc đăng nhập lại lần sau. */
export function clearAuthSession(filePath = SESSION_PATH): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  if (fs.existsSync(STORAGE_STATE_PATH)) fs.rmSync(STORAGE_STATE_PATH, { force: true });
}

/**
 * Đọc AuthConfig từ file JSON (dùng cho CI non-interactive mode).
 * Hỗ trợ override credentials bằng env vars AUTH_USERNAME, AUTH_PASSWORD, AUTH_JWT_TOKEN.
 */
export function loadAuthConfig(filePath = CI_CONFIG_PATH): AuthConfig | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AuthConfig;
    if (!parsed.strategy) return null;
    if (parsed.strategy === 'JWT_HEADER' && !parsed.jwtToken) {
      parsed.jwtToken = process.env['AUTH_JWT_TOKEN'];
    }
    if (!parsed.username) parsed.username = process.env['AUTH_USERNAME'];
    if (!parsed.password) parsed.password = process.env['AUTH_PASSWORD'];
    return parsed;
  } catch {
    return null;
  }
}

/** Kiểm tra session có còn hợp lệ không (file tồn tại + đúng strategy). */
export function isAuthSessionValid(session: AuthSession | null): boolean {
  if (!session) return false;
  if (session.strategy === 'NONE') return true;
  if (session.strategy === 'PLAYWRIGHT_STORAGE_STATE') {
    return !!(session.storageStatePath && fs.existsSync(session.storageStatePath));
  }
  if (session.strategy === 'JWT_HEADER') {
    return !!(session.extraHeaders?.['Authorization']);
  }
  return false;
}

/** Tạo AuthSession không cần xác thực (public routes). */
export function createNoAuthSession(): AuthSession {
  return { strategy: 'NONE', capturedAt: new Date().toISOString() };
}

// ─── Credential Cache — Tự động làm mới session khi hết hạn ─────────────────
// ⚠️  Thông tin đăng nhập được lưu plaintext — CHỈ dùng cho môi trường local.
// Không commit file này lên version control.

export const AUTH_CREDENTIALS_CACHE_PATH = path.join(AUTH_DIR, '.credentials.json');

/** Lưu thông tin đăng nhập để Crawler tự động đăng nhập lại khi session hết hạn. */
export function saveAuthCredentialsCache(config: Omit<AuthConfig, 'jwtToken'>): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(
    AUTH_CREDENTIALS_CACHE_PATH,
    JSON.stringify(config, null, 2) + '\n',
    'utf-8',
  );
}

/** Đọc thông tin đăng nhập đã cache. Trả về null nếu không có hoặc thiếu trường bắt buộc. */
export function loadAuthCredentialsCache(): AuthConfig | null {
  if (!fs.existsSync(AUTH_CREDENTIALS_CACHE_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_CREDENTIALS_CACHE_PATH, 'utf-8')) as AuthConfig;
    if (!parsed.strategy || !parsed.loginUrl || !parsed.username || !parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Xóa cache credential (ví dụ khi user chọn không lưu hoặc đổi tài khoản). */
export function clearAuthCredentialsCache(): void {
  if (fs.existsSync(AUTH_CREDENTIALS_CACHE_PATH)) {
    fs.rmSync(AUTH_CREDENTIALS_CACHE_PATH, { force: true });
  }
}
