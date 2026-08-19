/**
 * Universal Project Profile Engine (.aiautotest/profile.yaml | profile.json)
 *
 * Cho phép cấu hình 1 lần cho từng dự án, tự động áp dụng:
 * - Thông tin kết nối & Auth strategy
 * - Quy tắc bỏ qua (skipEndpoints) để tránh side-effects phá hủy dữ liệu (DELETE / Logout)
 * - Ghi đè payload (payloadOverrides) theo endpoint
 * - Ánh xạ tham số đường dẫn (paramResolvers)
 * - Tự động giải mã biến môi trường ${env:VAR_NAME}
 */

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';

export interface ProjectProfile {
  project?: {
    name?: string;
    baseUrl?: string;
    specFile?: string;
    specUrl?: string;
  };
  auth?: {
    strategy?: 'bearer' | 'basic' | 'apikey' | 'login_endpoint' | 'playwright_session';
    bearerToken?: string;
    apiKeyHeader?: string;
    apiKeyValue?: string;
    username?: string;
    password?: string;
    loginEndpoint?: string;
    loginBody?: Record<string, unknown>;
    tokenPath?: string;
    headers?: Record<string, string>;
  };
  throttling?: {
    delayMs?: number;
    maxRetries?: number;
  };
  skipEndpoints?: string[];
  payloadOverrides?: Record<string, Record<string, unknown>>;
  paramResolvers?: Record<string, string>;
}

function parseYamlContent(raw: string): unknown {
  try {
    const loadFn = (yaml as any).load || (yaml as any).default?.load || yaml.load;
    return loadFn(raw);
  } catch {
    return null;
  }
}

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{env:([A-Z0-9_]+)(?:\s*\|\|\s*([^}]+))?\}/gi, (_, varName, defVal) => {
      return process.env[varName] !== undefined ? process.env[varName]! : (defVal ? defVal.trim() : '');
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolateEnvVars(v));
  }
  if (value && typeof value === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      res[k] = interpolateEnvVars(v);
    }
    return res;
  }
  return value;
}

/**
 * Tự động tìm và nạp Project Profile từ thư mục dự án.
 */
export function loadProjectProfile(projectRoot = process.cwd()): ProjectProfile | null {
  const candidatePaths = [
    path.join(projectRoot, '.aiautotest', 'profile.yaml'),
    path.join(projectRoot, '.aiautotest', 'profile.yml'),
    path.join(projectRoot, '.aiautotest', 'profile.json'),
    path.join(projectRoot, 'testkit.profile.yaml'),
    path.join(projectRoot, 'testkit.profile.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        let parsed: unknown;
        if (p.endsWith('.json')) {
          parsed = JSON.parse(raw);
        } else {
          parsed = parseYamlContent(raw);
        }
        if (parsed && typeof parsed === 'object') {
          return interpolateEnvVars(parsed) as ProjectProfile;
        }
      } catch (err: any) {
        console.warn(`[Project Profile] Lỗi khi nạp "${p}": ${err.message}`);
      }
    }
  }

  return null;
}

/**
 * Kiểm tra xem một endpoint cụ thể có nằm trong danh sách skipEndpoints hay không.
 */
export function isEndpointSkipped(
  method: string,
  apiPath: string,
  skipRules?: string[],
): boolean {
  if (!skipRules || skipRules.length === 0) return false;

  const target = `${method.toUpperCase()} ${apiPath}`;
  for (const rule of skipRules) {
    const trimmed = rule.trim();
    if (!trimmed) continue;

    // Khớp chính xác "DELETE /dema/api/religions/{code}/"
    if (target === trimmed || apiPath === trimmed) return true;

    // Khớp pattern với wildcard "DELETE /dema/api/religions/*"
    const regexPattern = '^' + trimmed
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') + '$';

    if (new RegExp(regexPattern, 'i').test(target) || new RegExp(regexPattern, 'i').test(apiPath)) {
      return true;
    }
  }

  return false;
}
