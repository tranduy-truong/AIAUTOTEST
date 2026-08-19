/**
 * Universal Postman Collection to OpenAPI 3.0 Normalizer
 *
 * Cho phép người dùng xuất file Postman Collection v2.0/v2.1 (.json)
 * và tự động chuyển đổi sang bộ Test Suite OpenAPI 3.0 để chạy kiểm thử tự động.
 */

import type { OpenApiSpec, OpenApiOperation, OpenApiPathItem } from './contract-loader.js';

export function convertPostmanToOpenApi3(collection: any): OpenApiSpec {
  const info = collection.info || {};
  const spec: OpenApiSpec = {
    openapi: '3.0.3',
    info: {
      title: info.name || 'Converted Postman Collection API',
      version: info.version || '1.0.0',
      description: info.description || 'Imported from Postman Collection',
    },
    paths: {},
  };

  function extractItems(items: any[], currentTags: string[] = []) {
    for (const item of items || []) {
      // Nếu là Folder trong Postman
      if (item.item && Array.isArray(item.item)) {
        extractItems(item.item, [...currentTags, item.name]);
        continue;
      }

      // Nếu là Request trong Postman
      if (item.request) {
        const req = item.request;
        const method = (req.method || 'GET').toLowerCase();
        let rawUrl = '';

        if (typeof req.url === 'string') {
          rawUrl = req.url;
        } else if (req.url && req.url.raw) {
          rawUrl = req.url.raw;
        } else if (req.url && Array.isArray(req.url.path)) {
          rawUrl = '/' + req.url.path.join('/');
        }

        // Chuẩn hóa path: thay thế {{baseUrl}} hoặc http://domain thành /path
        let normalizedPath = rawUrl
          .replace(/^https?:\/\/[^\/]+/, '')
          .replace(/\{\{[^}]+\}\}/g, '')
          .replace(/:([a-zA-Z0-9_]+)/g, '{$1}'); // :id -> {id}

        if (!normalizedPath.startsWith('/')) {
          normalizedPath = '/' + normalizedPath;
        }
        if (!normalizedPath.endsWith('/') && !normalizedPath.includes('.')) {
          normalizedPath += '/';
        }

        if (!spec.paths[normalizedPath]) {
          spec.paths[normalizedPath] = {};
        }

        const operation: OpenApiOperation = {
          summary: item.name || `${method.toUpperCase()} ${normalizedPath}`,
          operationId: `TC_${method.toUpperCase()}_${normalizedPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          tags: currentTags.length > 0 ? currentTags : undefined,
          parameters: [],
          responses: {
            '200': {
              description: 'Successful Response (Imported from Postman)',
            },
          },
        };

        // Trích xuất Path & Query Params
        if (req.url && Array.isArray(req.url.variable)) {
          for (const v of req.url.variable) {
            operation.parameters?.push({
              name: v.key,
              in: 'path',
              required: true,
              schema: { type: 'string', default: v.value },
            });
          }
        }

        // Trích xuất Body nếu có
        if (req.body && req.body.raw && ['post', 'put', 'patch'].includes(method)) {
          try {
            const parsedBody = JSON.parse(req.body.raw);
            operation.requestBody = {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    default: parsedBody,
                  },
                },
              },
            };
          } catch {
            // body không phải JSON thuần
          }
        }

        spec.paths[normalizedPath][method as 'get' | 'post' | 'put' | 'patch' | 'delete'] = operation;
      }
    }
  }

  extractItems(collection.item);
  return spec;
}
