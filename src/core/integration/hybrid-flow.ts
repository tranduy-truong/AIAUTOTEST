/**
 * Hybrid E2E + API Integration Flow Engine
 *
 * Kết nối tầng Kiểm thử Giao diện (Playwright E2E) với tầng Kiểm thử API Integration (OpenAPI):
 * 1. Tự động trích xuất Token / Cookies từ Playwright Auth Session (.auth/storage-state.json)
 *    để cấp quyền cho API Runner mà không cần Tester phải copy-paste thủ công.
 * 2. Cung cấp tiện ích `verifyApiStateAfterUiAction`: Thao tác trên giao diện Web UI,
 *    sau đó gọi ngay REST API để kiểm tra tính toàn vẹn dữ liệu backend tức thì.
 */

import fs from 'fs';
import path from 'path';
import { sendApiRequest } from './api/client.js';
import type { ApiResponseSnapshot } from './api/schema.js';

export interface ExtractedAuthHeaders {
  authorization?: string;
  cookie?: string;
  customHeaders: Record<string, string>;
}

/**
 * Trích xuất Bearer Token hoặc Cookie từ file Playwright storage-state.json.
 */
export function extractAuthFromPlaywrightStorageState(
  storageStatePath = path.join(process.cwd(), '.auth', 'storage-state.json'),
): ExtractedAuthHeaders {
  const result: ExtractedAuthHeaders = { customHeaders: {} };

  if (!fs.existsSync(storageStatePath)) {
    return result;
  }

  try {
    const raw = fs.readFileSync(storageStatePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      cookies?: Array<{ name: string; value: string; domain?: string }>;
      origins?: Array<{
        origin: string;
        localStorage?: Array<{ name: string; value: string }>;
      }>;
    };

    // 1. Quét cookies
    if (parsed.cookies && parsed.cookies.length > 0) {
      const cookieHeader = parsed.cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
      result.cookie = cookieHeader;

      // Tìm token trong cookie nếu có
      const tokenCookie = parsed.cookies.find(c =>
        /token|jwt|access_token|bearer/i.test(c.name),
      );
      if (tokenCookie) {
        result.authorization = `Bearer ${tokenCookie.value}`;
      }
    }

    // 2. Quét localStorage từ các origins
    if (parsed.origins) {
      for (const origin of parsed.origins) {
        if (!origin.localStorage) continue;
        for (const item of origin.localStorage) {
          if (/token|jwt|access|bearer/i.test(item.name)) {
            let tokenVal = item.value;
            // Xử lý nếu token bị bọc trong JSON
            try {
              const inner = JSON.parse(tokenVal);
              if (typeof inner === 'object' && inner !== null) {
                tokenVal = inner.access || inner.token || inner.accessToken || tokenVal;
              }
            } catch {}

            const cleanToken = tokenVal.replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
            if (cleanToken.length > 20) {
              result.authorization = `Bearer ${cleanToken}`;
              break;
            }
          }
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return result;
}

/**
 * Tiện ích kiểm chứng API tức thì sau thao tác UI (UI Action → API Assertion).
 *
 * @example
 * ```typescript
 * // Thao tác trên giao diện: Tạo tổ chức tôn giáo mới
 * await page.getByRole('button', { name: 'Lưu' }).click();
 *
 * // Kiểm chứng ngay qua API xem dữ liệu đã được lưu đúng chưa:
 * const check = await verifyApiStateAfterUiAction(
 *   'https://hcm.mobifone.vn',
 *   '/dema/api/religious-organizations/',
 *   200,
 *   { results: (items) => items.some(i => i.name === 'Tổ chức mới') }
 * );
 * expect(check.ok).toBe(true);
 * ```
 */
export async function verifyApiStateAfterUiAction(
  baseUrl: string,
  apiPath: string,
  expectedStatus = 200,
  propertyMatchers?: Record<string, unknown | ((val: any) => boolean)>,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; response: ApiResponseSnapshot; errors: string[] }> {
  const auth = extractAuthFromPlaywrightStorageState();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...extraHeaders,
  };

  if (auth.authorization && !headers['Authorization']) {
    headers['Authorization'] = auth.authorization;
  }
  if (auth.cookie && !headers['Cookie']) {
    headers['Cookie'] = auth.cookie;
  }

  const response = await sendApiRequest(baseUrl, {
    method: 'GET',
    path: apiPath,
  }, headers);

  const errors: string[] = [];

  if (response.status !== expectedStatus) {
    errors.push(`Status mismatch: expected ${expectedStatus}, got ${response.status}`);
  }

  if (propertyMatchers && response.body && typeof response.body === 'object') {
    const bodyObj = response.body as Record<string, any>;
    for (const [key, matcher] of Object.entries(propertyMatchers)) {
      const actualVal = bodyObj[key];
      if (typeof matcher === 'function') {
        if (!matcher(actualVal)) {
          errors.push(`Matcher function failed for property "${key}" (value: ${JSON.stringify(actualVal)})`);
        }
      } else if (JSON.stringify(actualVal) !== JSON.stringify(matcher)) {
        errors.push(`Property mismatch on "${key}": expected ${JSON.stringify(matcher)}, got ${JSON.stringify(actualVal)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    response,
    errors,
  };
}
