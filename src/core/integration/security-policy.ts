import type { IntegrationSecurityPolicyConfig } from './schema.js';

const PROD_DB_KEYWORDS = [
  'production',
  'prod_db',
  'rds.amazonaws.com',
  'neon.tech',
  'supabase.co',
  'cockroachlabs.cloud',
  'cloudsql',
  'azure.com',
];

const SECRET_PATTERNS = [
  /password=([^&\s]+)/gi,
  /api[-_]?key=([^&\s]+)/gi,
  /secret=([^&\s]+)/gi,
  /token=([^&\s]+)/gi,
  /bearer\s+([a-z0-9._-]+)/gi,
];

export function isProductionDatabaseUrl(dbUrl: string): boolean {
  if (!dbUrl) return false;
  const lower = dbUrl.toLowerCase();
  
  // Allow explicit test database names
  if (lower.includes('_test') || lower.includes('test_') || lower.includes('testdb')) {
    return false;
  }

  return PROD_DB_KEYWORDS.some(keyword => lower.includes(keyword));
}

export function validateDatabaseUrlSafety(dbUrl: string, config: IntegrationSecurityPolicyConfig): void {
  if (!config.blockProductionUrls) return;

  if (isProductionDatabaseUrl(dbUrl)) {
    throw new Error(
      `[SECURITY ERROR] Phát hiện DATABASE_URL có dấu hiệu Production ("${redactSecrets(dbUrl)}"). Integration Sandbox bị chặn để bảo vệ dữ liệu thật!`,
    );
  }
}

export function validateHostnameAllowList(urlStr: string, allowedHostnames: string[]): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    
    const defaults = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    const fullAllowList = [...defaults, ...allowedHostnames.map(h => h.toLowerCase())];

    return fullAllowList.includes(hostname);
  } catch {
    return false;
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
  const forbiddenKeys = ['AWS_SECRET_ACCESS_KEY', 'PROD_DB_PASSWORD', 'PRODUCTION_KEY', 'STRIPE_LIVE_SECRET'];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (forbiddenKeys.includes(key.toUpperCase())) {
      continue; // Strip production secrets from child process env
    }
    result[key] = value;
  }

  return result;
}
