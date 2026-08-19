/**
 * Universal FK Dependency Graph & Schema Foreign Key Resolver
 *
 * Tự động phân tích các trường trong request schema và ánh xạ tới các endpoint danh mục
 * để lấy giá trị khóa ngoại (Foreign Key) thực tế trước khi gửi POST/PUT/PATCH.
 */

import { sendApiRequest } from './client.js';

export interface FkMappingRule {
  fieldPattern: RegExp;
  targetCollection: string;
  valueField: 'code' | 'id' | 'key' | 'value';
}

/**
 * Các quy tắc heuristic nhận dạng khóa ngoại tiêu chuẩn quốc tế và theo domain.
 */
export const DEFAULT_FK_RULES: FkMappingRule[] = [
  // 1. Địa lý / Hành chính
  { fieldPattern: /^province(?:_code|_id)?$/i, targetCollection: '/provinces/', valueField: 'code' },
  { fieldPattern: /^district(?:_code|_id)?$/i, targetCollection: '/districts/', valueField: 'code' },
  { fieldPattern: /^ward(?:_code|_id)?$/i, targetCollection: '/wards/', valueField: 'code' },

  // 2. Tôn giáo & Tổ chức
  { fieldPattern: /^religion(?:_code|_id)?$/i, targetCollection: '/religions/', valueField: 'code' },
  { fieldPattern: /^religion_type(?:_code|_id)?$/i, targetCollection: '/religious-organization-types/', valueField: 'code' },
  { fieldPattern: /^organization(?:_code|_id)?$/i, targetCollection: '/religious-organizations/', valueField: 'code' },
  { fieldPattern: /^parent(?:_organization|_org)?(?:_code|_id)?$/i, targetCollection: '/religious-organizations/', valueField: 'code' },
  { fieldPattern: /^facility(?:_code|_id)?$/i, targetCollection: '/religious-facilities/', valueField: 'code' },
  { fieldPattern: /^training_facility(?:_code|_id)?$/i, targetCollection: '/religious-training-facilities/', valueField: 'code' },

  // 3. Chức sắc / Nhân sự / Dân tộc
  { fieldPattern: /^ethnic_group(?:_code|_id)?$/i, targetCollection: '/ethnic-groups/', valueField: 'id' },
  { fieldPattern: /^ethnicgroup$/i, targetCollection: '/ethnic-groups/', valueField: 'id' },
  { fieldPattern: /^dignitary(?:_code|_id)?$/i, targetCollection: '/religious-dignitaries/', valueField: 'code' },
  { fieldPattern: /^officer(?:_code|_id)?$/i, targetCollection: '/religious-officers/', valueField: 'code' },
  { fieldPattern: /^department(?:_id)?$/i, targetCollection: '/departments/', valueField: 'id' },
  { fieldPattern: /^group(?:_id)?$/i, targetCollection: '/groups/', valueField: 'id' },
  { fieldPattern: /^user(?:_id)?$/i, targetCollection: '/users/', valueField: 'id' },
  { fieldPattern: /^branch(?:_code|_id)?$/i, targetCollection: '/language-branches/', valueField: 'code' },
  { fieldPattern: /^family(?:_code|_id)?$/i, targetCollection: '/language-families/', valueField: 'code' },
  { fieldPattern: /^permissions?$/i, targetCollection: '/permissions/', valueField: 'id' },
];

/**
 * Tự động tìm endpoint collection tương ứng cho một trường khóa ngoại.
 */
export function inferCollectionForField(fieldName: string, availablePaths: string[] = []): string | null {
  const lower = fieldName.toLowerCase().replace(/_id$|_code$|_pk$/, '');

  // 1. Kiểm tra trong danh sách quy tắc mặc định
  for (const rule of DEFAULT_FK_RULES) {
    if (rule.fieldPattern.test(fieldName)) {
      // Tìm path thực tế có chứa targetCollection
      const matchedPath = availablePaths.find(p => p.toLowerCase().includes(rule.targetCollection));
      return matchedPath ? matchedPath.replace(/\{[^}]+\}.*$/, '').replace(/\/*$/, '/') : rule.targetCollection;
    }
  }

  // 2. Tìm trong danh sách paths có sẵn của OpenAPI spec
  if (availablePaths.length > 0) {
    const candidates = [
      `/${lower}s/`,
      `/${lower}/`,
      `/${lower.replace(/_/g, '-')}/`,
      `/${lower.replace(/_/g, '-')}s/`,
    ];
    for (const cand of candidates) {
      const found = availablePaths.find(p => p.toLowerCase().endsWith(cand) || p.toLowerCase().includes(cand));
      if (found) {
        return found.replace(/\{[^}]+\}.*$/, '').replace(/\/*$/, '/');
      }
    }
  }

  return null;
}

/**
 * Phân giải và điền khóa ngoại thực tế vào Request Body trước khi bắn request.
 */
export const EXCLUDED_FK_FIELDS = new Set([
  'username',
  'password',
  'old_password',
  'new_password',
  'current_password',
  'email',
  'refresh',
  'access',
  'token',
  'refresh_token',
  'access_token',
  'name',
  'title',
  'description',
  'content',
  'address',
  'phone',
  'note',
  'code',
  'alias',
  'identifier',
  'query',
  'url',
]);

export async function resolveForeignKeysInPayload(
  payload: unknown,
  baseUrl: string,
  defaultHeaders: Record<string, string>,
  cache: Map<string, any[]>,
  availablePaths: string[] = [],
): Promise<unknown> {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return Promise.all(
      payload.map(item => resolveForeignKeysInPayload(item, baseUrl, defaultHeaders, cache, availablePaths)),
    );
  }

  const obj = { ...(payload as Record<string, unknown>) };

  for (const [key, val] of Object.entries(obj)) {
    // Không bao giờ thay thế các trường credential, text cốt lõi hoặc mã định danh
    if (EXCLUDED_FK_FIELDS.has(key.toLowerCase())) {
      continue;
    }

    // Chỉ xử lý nếu trường có dạng ID/Code hoặc là object
    if (typeof val === 'object' && val !== null) {
      obj[key] = await resolveForeignKeysInPayload(val, baseUrl, defaultHeaders, cache, availablePaths);
      continue;
    }

    const collectionEndpoint = inferCollectionForField(key, availablePaths);
    if (!collectionEndpoint) continue;

    // Lấy entity từ cache hoặc probe GET
    let entities = cache.get(collectionEndpoint);
    if (!entities || entities.length === 0) {
      try {
        const probeRes = await sendApiRequest(baseUrl, {
          method: 'GET',
          path: collectionEndpoint,
          timeoutMs: 5000,
        }, defaultHeaders);

        if (probeRes.status === 200 && probeRes.body) {
          const body: any = probeRes.body;
          const items = Array.isArray(body) ? body : (body.results || body.data || body.items || []);
          if (items.length > 0) {
            entities = items;
            cache.set(collectionEndpoint, items);
          }
        }
      } catch {
        // bỏ qua nếu probe lỗi
      }
    }

    if (entities && entities.length > 0) {
      if (key.toLowerCase().startsWith('permission')) {
        obj[key] = entities.slice(0, 2).map((e: any) => e.id || 1);
        continue;
      }

      const sample = entities[0];
      const isIdField = key.toLowerCase().includes('id') || typeof val === 'number';

      if (isIdField && sample.id !== undefined) {
        obj[key] = sample.id;
      } else if (sample.code !== undefined) {
        obj[key] = sample.code;
      } else if (sample.id !== undefined) {
        obj[key] = sample.id;
      } else if (sample.value !== undefined) {
        obj[key] = sample.value;
      }
    }
  }

  return obj;
}
