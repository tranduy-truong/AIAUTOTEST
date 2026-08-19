/**
 * AI-Powered Payload Synthesizer (LLM-backed)
 *
 * Sử dụng LLM (Gemini / OpenAI / Groq) để đọc hiểu ngữ cảnh nghiệp vụ,
 * tên trường tiếng Việt, mô tả endpoint và tự động sinh Request Body chuẩn xác.
 */

import { OpenAIAdapter } from '../../../../src/adapters/openai.js';
import type { OpenApiSchemaObject } from './contract-loader.js';
import { generateSmartPayload } from './template-registry.js';

interface AiSynthesizerContext {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  schema?: OpenApiSchemaObject;
}

const aiPayloadCache = new Map<string, Record<string, unknown>>();

export async function synthesizeSmartPayloadWithAi(
  ctx: AiSynthesizerContext,
): Promise<Record<string, unknown>> {
  const cacheKey = `${ctx.method.toUpperCase()} ${ctx.path}`;
  if (aiPayloadCache.has(cacheKey)) {
    return aiPayloadCache.get(cacheKey)!;
  }

  // Fallback nhanh nếu không có API Key
  const hasAiKey = !!(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.AI_API_KEY
  );

  if (!hasAiKey || !ctx.schema) {
    const fallback = generateSmartPayload(ctx.schema || {}, 'root');
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return fallback as Record<string, unknown>;
    }
    return {};
  }

  try {
    const adapter = new OpenAIAdapter();
    const prompt = `Bạn là một AI Backend QA Engineer chuyên nghiệp.
Nhiệm vụ của bạn là sinh một JSON Request Body hợp lệ để test endpoint API sau:

- HTTP Method: ${ctx.method.toUpperCase()}
- Endpoint Path: ${ctx.path}
- Summary / Description: ${ctx.summary || ''} ${ctx.description || ''}
- OpenAPI Schema:
\`\`\`json
${JSON.stringify(ctx.schema, null, 2)}
\`\`\`

YÊU CẦU QUAN TRỌNG:
1. CHỈ trả về đúng 1 khối JSON thuần túy (không kèm giải thích, không markdown code fence).
2. Điền dữ liệu thực tế, có ý nghĩa, phù hợp với văn cảnh tiếng Việt và domain nghiệp vụ.
3. Không gửi các trường ID tự tăng hoặc read-only (như id, created_at, updated_at).
4. Các trường ngày tháng theo chuẩn ISO YYYY-MM-DD hoặc ISO8601.
5. Số điện thoại: 10 chữ số bắt đầu bằng 09/03/07/08.
6. Email: định dạng hợp lệ.`;

    const completion = await adapter.client.chat.completions.create({
      model: adapter.model,
      messages: [
        { role: 'system', content: 'You are an API testing expert. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    });

    const response = completion.choices[0]?.message?.content || '';
    const cleaned = response.trim().replace(/^```json\s*|^```\s*|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      aiPayloadCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    // Fallback nếu LLM timeout hoặc trả về lỗi cú pháp
  }

  const fallback = generateSmartPayload(ctx.schema, 'root');
  const result = (fallback && typeof fallback === 'object' && !Array.isArray(fallback))
    ? (fallback as Record<string, unknown>)
    : {};
  aiPayloadCache.set(cacheKey, result);
  return result;
}
