// apps/api/src/ai/client.ts
import Anthropic from '@anthropic-ai/sdk';

// Model để trong config: đổi bằng biến môi trường, đo bằng eval trước khi đổi (testing.md)
export const AI_MODEL = process.env.AI_MODEL ?? 'claude-opus-5-5';

export function createAiClient(options: ConstructorParameters<typeof Anthropic>[0] = {}): Anthropic {
  // Key đọc từ ANTHROPIC_API_KEY ở server. SDK tự retry 429, 5xx, lỗi mạng (2 lần); timeout tính bằng ms
  return new Anthropic({ timeout: 60_000, maxRetries: 2, ...options });
}
