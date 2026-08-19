/**
 * Universal Endpoint Template Registry & Smart Payload Synthesizer
 *
 * Cung cấp cơ chế tự động sinh Request Body hợp lệ dựa trên:
 * 1. Schema OpenAPI (Format, Enum, Min/Max, Required properties)
 * 2. Mẫu định dạng tiêu chuẩn quốc tế cho các endpoint đặc thù (Auth, Upload, Password, Search)
 * 3. Hỗ trợ biến môi trường động (${env:VAR_NAME})
 */

import type { OpenApiSchemaObject } from './contract-loader.js';

export interface SpecializedPayloadContext {
  method: string;
  path: string;
  schema?: OpenApiSchemaObject;
  env?: Record<string, string | undefined>;
}

/**
 * Tự động nhận diện các endpoint đặc thù và sinh payload hợp lệ chuẩn quốc tế.
 */
export function findSpecializedPayload(
  ctx: SpecializedPayloadContext,
): Record<string, unknown> | null {
  const method = ctx.method.toUpperCase();
  const lowerPath = ctx.path.toLowerCase();
  const env = ctx.env || process.env;

  // 1. Endpoint Đăng nhập / Lấy Token
  if (['/token/', '/token', '/auth/login', '/auth/token', '/login', '/api-token-auth/'].some(p => lowerPath.endsWith(p))) {
    if (method === 'POST') {
      const username = env.API_USERNAME || 'admin';
      const password = env.API_PASSWORD || '123123';
      return {
        username,
        password,
      };
    }
  }

  // 2. Endpoint Refresh Token
  if (['/token/refresh/', '/token/refresh', '/auth/refresh', '/refresh'].some(p => lowerPath.endsWith(p))) {
    if (method === 'POST') {
      return {
        refresh: env.API_REFRESH_TOKEN || 'sample_valid_refresh_token_jwt_string',
        refresh_token: env.API_REFRESH_TOKEN || 'sample_valid_refresh_token_jwt_string',
      };
    }
  }

  // 3. Endpoint Đổi mật khẩu
  if (lowerPath.includes('password')) {
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const oldPass = env.API_PASSWORD || '123123';
      const newPass = env.API_NEW_PASSWORD || 'Admin@2026Secure!';
      return {
        old_password: oldPass,
        current_password: oldPass,
        new_password: newPass,
        confirm_password: newPass,
        password: newPass,
      };
    }
  }

  // 4. Endpoint Upload File / Presigned URL
  if (lowerPath.includes('upload-url') || lowerPath.includes('presigned-url') || lowerPath.endsWith('/upload/')) {
    if (method === 'POST' || method === 'PUT') {
      return {
        file_name: 'test_attachment_document.pdf',
        filename: 'test_attachment_document.pdf',
        name: 'test_attachment_document.pdf',
        content_type: 'application/pdf',
        mime_type: 'application/pdf',
        file_size: 10240,
        size: 10240,
      };
    }
  }

  // 5. Endpoint Logout
  if (lowerPath.includes('/logout')) {
    if (method === 'POST') {
      return {
        refresh: env.API_REFRESH_TOKEN || 'sample_refresh_token',
        refresh_token: env.API_REFRESH_TOKEN || 'sample_refresh_token',
      };
    }
  }

  return null;
}

/**
 * Sinh giá trị mẫu thông minh từ OpenAPI Schema Object với đầy đủ Format, Enum, Min/Max.
 */
export function generateSmartPayload(
  schema?: OpenApiSchemaObject,
  fieldName = '',
  depth = 0,
): unknown {
  if (!schema || depth > 4) return {};

  // 1. Nếu schema có Enum: ưu tiên lấy phần tử đầu tiên
  if ((schema as any).enum && Array.isArray((schema as any).enum) && (schema as any).enum.length > 0) {
    return (schema as any).enum[0];
  }

  // 2. Nếu schema có default value
  if ((schema as any).default !== undefined) {
    return (schema as any).default;
  }

  // 3. Nếu schema có example
  if ((schema as any).example !== undefined) {
    return (schema as any).example;
  }

  // 4. Xử lý kiểu mảng (Array)
  if (schema.type === 'array') {
    if (schema.items) {
      const itemVal = generateSmartPayload(schema.items, fieldName, depth + 1);
      return itemVal !== undefined ? [itemVal] : [];
    }
    return [];
  }

  const lowerField = fieldName.toLowerCase();
  const format = (schema as any).format ? String((schema as any).format).toLowerCase() : '';

  // 5. Xử lý kiểu chuỗi (String)
  if (schema.type === 'string') {
    if (format === 'date-time') return new Date().toISOString();
    if (format === 'date') return new Date().toISOString().split('T')[0];
    if (format === 'email' || lowerField.includes('email')) return 'automation.tester@example.com';
    if (format === 'uri' || format === 'url' || lowerField.includes('url') || lowerField.includes('link')) {
      return 'https://example.com/asset.jpg';
    }
    if (format === 'uuid' || lowerField.includes('uuid')) return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    if (format === 'ipv4') return '192.168.1.1';

    // Heuristics theo tên trường
    if (lowerField.includes('phone') || lowerField.includes('mobile') || lowerField.includes('tel')) {
      return '0901234567';
    }
    if (lowerField.includes('code') || lowerField.includes('slug')) {
      return `AUTO_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    }
    if (lowerField.includes('name') || lowerField.includes('title')) {
      return `Tự động kiểm thử ${fieldName || 'Entity'}`;
    }
    if (lowerField.includes('description') || lowerField.includes('content') || lowerField.includes('note') || lowerField.includes('comment')) {
      return 'Dữ liệu sinh tự động bởi AIAUTOTEST Universal Suite';
    }
    if (lowerField.includes('address')) return 'Số 123 Đường Tự Động, Phường 1, Quận 1';
    if (lowerField.includes('tax') || lowerField.includes('identity')) return '0123456789';

    const minLen = (schema as any).minLength || 1;
    const maxLen = (schema as any).maxLength || 50;
    const baseStr = fieldName ? `Sample_${fieldName}` : 'sample_text';
    return baseStr.substring(0, maxLen).padEnd(minLen, 'x');
  }

  // 6. Xử lý kiểu số (Integer / Number)
  if (schema.type === 'integer' || schema.type === 'number') {
    const min = (schema as any).minimum !== undefined ? (schema as any).minimum : 1;
    const max = (schema as any).maximum !== undefined ? (schema as any).maximum : 100;
    if (lowerField.includes('status') || lowerField.includes('type') || lowerField.includes('level') || lowerField.includes('role')) {
      return min > 0 ? min : 1;
    }
    if (lowerField.includes('age') || lowerField.includes('year')) return 2026;
    if (lowerField.includes('order') || lowerField.includes('index') || lowerField.includes('rank')) return 1;
    return Math.min(max, Math.max(min, 10));
  }

  // 7. Xử lý kiểu Boolean
  if (schema.type === 'boolean') {
    if (lowerField.includes('delete') || lowerField.includes('archived')) return false;
    return true;
  }

  // 8. Xử lý kiểu Object với properties
  if (schema.type === 'object' || schema.properties) {
    const payload: Record<string, unknown> = {};
    const props = schema.properties || {};
    const requiredList = schema.required || [];

    for (const [propName, propSchema] of Object.entries(props)) {
      const lowerName = propName.toLowerCase();
      // Bỏ qua các trường read-only và audit do server tự sinh
      if ((propSchema as any).readOnly === true) continue;
      if (['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'].includes(lowerName)) continue;
      if (lowerName === 'id' && depth === 0 && (schema as any).required?.includes(propName) !== true) continue;

      payload[propName] = generateSmartPayload(propSchema, propName, depth + 1);
    }

    // Đảm bảo các trường required không bị undefined/null
    for (const req of requiredList) {
      if (payload[req] === undefined && props[req]) {
        payload[req] = generateSmartPayload(props[req], req, depth + 1);
      }
    }

    return payload;
  }

  return {};
}
