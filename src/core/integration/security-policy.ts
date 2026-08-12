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
  /(;|\&\&|\|)\s*(rm|del|rd|format)\s+/i,
  /;\s*rm\s+/i,
  /;\s*del\s+/i,
  /&&\s*rm\s+/i,
  /&&\s*del\s+/i,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
  /`[^`]+`/g,
  /\$\([^)]+\)/g,
];

export function isProductionDatabaseUrl(dbUrl: string): boolean {
  if (!dbUrl) return false;
  const lower = dbUrl.toLowerCase();
  
  // CRITICAL SECURITY FIX: Check production host indicators FIRST!
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
  
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    
    // Scrub all common credential patterns from sub-process environment
    if (
      upperKey.includes('PROD_DB') ||
      upperKey.includes('AWS_SECRET') ||
      upperKey.includes('STRIPE_LIVE') ||
      upperKey.includes('PRIVATE_KEY') ||
      upperKey.includes('PRODUCTION_KEY')
    ) {
      continue;
    }
    result[key] = value;
  }

  return result;
}
