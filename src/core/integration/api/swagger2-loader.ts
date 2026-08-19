/**
 * Universal Swagger 2.0 to OpenAPI 3.0 Normalizer
 *
 * Cho phép nạp bất kỳ file Swagger 2.0 (JSON / YAML) từ các dự án Spring Boot / .NET / Java cũ
 * và tự động chuyển đổi sang OpenAPI 3.x để tái sử dụng toàn bộ test suite.
 */

import type { OpenApiSpec } from './contract-loader.js';

export function convertSwagger2ToOpenApi3(swagger: any): OpenApiSpec {
  if (swagger.openapi && swagger.openapi.startsWith('3.')) {
    return swagger as OpenApiSpec;
  }

  const openapi: OpenApiSpec = {
    openapi: '3.0.3',
    info: swagger.info || { title: 'Converted Swagger 2.0 API', version: '1.0.0' },
    paths: {},
    components: {
      schemas: swagger.definitions || {},
    },
  };

  const basePath = swagger.basePath && swagger.basePath !== '/' ? swagger.basePath.replace(/\/$/, '') : '';

  for (const [pathKey, pathItem] of Object.entries(swagger.paths || {})) {
    const fullPath = `${basePath}${pathKey}`;
    const newPathItem: Record<string, any> = {};

    for (const [method, op] of Object.entries(pathItem as Record<string, any>)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
        const operation: any = {
          summary: op.summary || `${method.toUpperCase()} ${fullPath}`,
          operationId: op.operationId,
          parameters: [],
          responses: {},
        };

        // Chuyển đổi parameters
        for (const param of (op.parameters || [])) {
          if (param.in === 'body') {
            operation.requestBody = {
              required: param.required,
              content: {
                'application/json': {
                  schema: param.schema,
                },
              },
            };
          } else {
            operation.parameters.push({
              name: param.name,
              in: param.in,
              required: param.required,
              schema: {
                type: param.type,
                format: param.format,
                enum: param.enum,
                default: param.default,
              },
            });
          }
        }

        // Chuyển đổi responses
        for (const [statusCode, resp] of Object.entries(op.responses || {})) {
          const responseObj: any = {
            description: (resp as any).description || '',
          };
          if ((resp as any).schema) {
            responseObj.content = {
              'application/json': {
                schema: (resp as any).schema,
              },
            };
          }
          operation.responses[statusCode] = responseObj;
        }

        newPathItem[method] = operation;
      } else {
        newPathItem[method] = op;
      }
    }

    openapi.paths[fullPath] = newPathItem;
  }

  return openapi;
}
