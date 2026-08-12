import type { IntegrationSecurityPolicyConfig } from './schema.js';

const PROD_DB_KEYWORDS = [
  'rds.amazonaws.com',
  'neon.tech',
  'supabase.co',
  'cockroachlabs.cloud',
  'cloudsql',
  'azure.com',
  'production',
  'prod_db',
  'prod-db',
  'main-db',
];

const SECRET_PATTERNS = [
  /password=([^&\s]+)/gi,
  /api[-_]?key=([^&\s]+)/gi,
  /secret=([^&\s]+)/gi,
  /token=([^&\s]+)/gi,
  /bearer\s+([a-z0-9._-]+)/gi,
];

const DANGEROUS_SHELL_PATTERNS = [
  /\brm\s+-[rf]/i,
  /\bdel\s+\/[fq]/i,
  /\brd\s+\/[sq]/i,
  /\bformat\s+[a-z]:/i,
  /\bsudo\s+/i,
  /;\s*(rm|del|rd|format)\b/i,
  /&&\s*(rm|del|rd|format)\b/i,
  /\|\s*(sh|bash)\b/i,
  /`[^`]+`/g,
  /\$\([^)]+\)/g,
];

export function isProductionDatabaseUrl(dbUrl: string): boolean {
  if (!dbUrl) return false;
  const lower = dbUrl.toLowerCase();
  
  // Host check ALWAYS takes precedence over database name suffix/prefix.
  const containsProdKeyword = PROD_DB_KEYWORDS.some(keyword => lower.includes(keyword));
  if (containsProdKeyword) {
    return true; // Strictly classified as Production!
  }

  // Only if no production keyword matches, check if it's explicitly named as a test DB
  if (lower.includes('_test') || lower.includes('test_') || lower.includes('testdb')) {
    return false;
  }

  return false;
}

export function validateExternalDatabaseUrlSafety(
  dbUrl: string,
  config: IntegrationSecurityPolicyConfig,
): void {
  validateDatabaseUrlSafety(dbUrl, config);

  // Default-Deny Rule 1: Must explicitly allow external test DBs via environment variable flag
  if (process.env.TESTKIT_ALLOW_EXTERNAL_TEST_DB !== 'true') {
    throw new Error(
      `[SECURITY ERROR] Kết nối EXTERNAL_TEST_DB bị chặn theo chính sách Default-Deny. Đặt TESTKIT_ALLOW_EXTERNAL_TEST_DB=true để xác nhận cho phép kết nối DB ngoài!`,
    );
  }

  // Default-Deny Rule 2: Host must be in allowedHostnames
  if (!validateHostnameAllowList(dbUrl, config.allowedHostnames)) {
    throw new Error(
      `[SECURITY ERROR] Host của EXTERNAL_TEST_DB ("${redactSecrets(dbUrl)}") không thuộc danh sách allowedHostnames được duyệt!`,
    );
  }

  // Default-Deny Rule 3: Database name MUST have explicit _test or test_ marker
  const lower = dbUrl.toLowerCase();
  if (!lower.includes('_test') && !lower.includes('test_') && !lower.includes('testdb')) {
    throw new Error(
      `[SECURITY ERROR] Tên Database trong EXTERNAL_TEST_DB phải có từ khóa "_test" hoặc "test_" để xác nhận là DB dùng riêng cho kiểm thử!`,
    );
  }
}

export function validateDatabaseUrlSafety(dbUrl: string, config: IntegrationSecurityPolicyConfig): void {
  if (!config.blockProductionUrls) return;

  if (isProductionDatabaseUrl(dbUrl)) {
    throw new Error(
      `[SECURITY ERROR] Phát hiện DATABASE_URL có dấu hiệu Production ("${redactSecrets(dbUrl)}"). Integration Sandbox bị chặn hoàn toàn để bảo vệ dữ liệu thật!`,
    );
  }
}

export function validateHostnameAllowList(urlStr: string, allowedHostnames: string[]): boolean {
  if (!urlStr) return true;
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    
    const defaults = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    const fullAllowList = [...defaults, ...allowedHostnames.map(h => h.toLowerCase())];

    return fullAllowList.includes(hostname);
  } catch {
    return false; // Invalid URL is not allowed
  }
}

export function validateCommandSafety(commandLine: string): void {
  if (!commandLine) return;
  for (const pattern of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(commandLine)) {
      throw new Error(`[SECURITY ERROR] Lệnh "${commandLine}" chứa chuỗi ký tự nguy hại. Bị chặn bởi Shell Safety Policy!`);
    }
  }
}

export function redactSecrets(text: string): string {
  if (!text) return '';
  let sanitized = text;
  
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, group) => {
      return match.replace(group, '[REDACTED_SECRET]');
    });
  }

  // Redact password in postgresql://user:pass@host:port/db
  sanitized = sanitized.replace(
    /(postgres(?:ql)?|mysql):\/\/([^:]+):([^@]+)@/gi,
    '$1://$2:[REDACTED_SECRET]@',
  );

  return sanitized;
}

export function sanitizeEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const secretKeyRegex = /(SECRET|PASSWORD|PASS|TOKEN|KEY|CREDENTIAL|PRIVATE)/i;
  const allowListPrefixes = ['TESTKIT_', 'PATH', 'NODE_', 'VITEST_', 'PLAYWRIGHT_'];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();

    // Check if allowed prefix
    if (allowListPrefixes.some(pref => upperKey.startsWith(pref))) {
      result[key] = value;
      continue;
    }

    // Default-deny all credential keys
    if (secretKeyRegex.test(upperKey)) {
      continue; // Strip credential
    }

    result[key] = value;
  }

  return result;
}
