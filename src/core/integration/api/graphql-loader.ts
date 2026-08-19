/**
 * Universal GraphQL Introspection to OpenAPI 3.0 Normalizer
 *
 * Cho phép nạp kết quả Introspection Query của GraphQL (JSON)
 * và tự động chuyển đổi thành bộ Test Suite chuẩn để kiểm thử toàn bộ Query & Mutation.
 */

import type { OpenApiSpec, OpenApiOperation } from './contract-loader.js';

export function convertGraphQLToOpenApi3(introspection: any): OpenApiSpec {
  const schema = introspection.data?.__schema || introspection.__schema || introspection;
  const spec: OpenApiSpec = {
    openapi: '3.0.3',
    info: {
      title: 'Converted GraphQL API Suite',
      version: '1.0.0',
      description: 'Automatically converted from GraphQL Introspection Schema',
    },
    paths: {},
  };

  const types: any[] = schema.types || [];
  const queryTypeName = schema.queryType?.name || 'Query';
  const mutationTypeName = schema.mutationType?.name || 'Mutation';

  const queryType = types.find(t => t.name === queryTypeName);
  const mutationType = types.find(t => t.name === mutationTypeName);

  // 1. Chuyển đổi Queries
  if (queryType && Array.isArray(queryType.fields)) {
    for (const field of queryType.fields) {
      const fieldName = field.name;
      if (fieldName.startsWith('__')) continue;

      const pathKey = `/graphql/query/${fieldName}/`;
      const queryGql = `query { ${fieldName} { __typename } }`;

      const operation: OpenApiOperation = {
        summary: `GraphQL Query: ${fieldName}`,
        operationId: `TC_GQL_QUERY_${fieldName.toUpperCase()}`,
        tags: ['GraphQL Queries'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                default: { query: queryGql },
              },
            },
          },
        },
        responses: {
          '200': {
            description: `GraphQL Query response for ${fieldName}`,
          },
        },
      };

      spec.paths[pathKey] = { post: operation };
    }
  }

  // 2. Chuyển đổi Mutations
  if (mutationType && Array.isArray(mutationType.fields)) {
    for (const field of mutationType.fields) {
      const fieldName = field.name;
      if (fieldName.startsWith('__')) continue;

      const pathKey = `/graphql/mutation/${fieldName}/`;
      const mutationGql = `mutation { ${fieldName} { __typename } }`;

      const operation: OpenApiOperation = {
        summary: `GraphQL Mutation: ${fieldName}`,
        operationId: `TC_GQL_MUTATION_${fieldName.toUpperCase()}`,
        tags: ['GraphQL Mutations'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                default: { query: mutationGql },
              },
            },
          },
        },
        responses: {
          '200': {
            description: `GraphQL Mutation response for ${fieldName}`,
          },
        },
      };

      spec.paths[pathKey] = { post: operation };
    }
  }

  return spec;
}
