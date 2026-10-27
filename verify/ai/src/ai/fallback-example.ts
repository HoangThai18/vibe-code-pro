// apps/api/src/ai/summarize-with-fallback.ts (beta: kiểm tên beta và tham số ở tài liệu hiện hành)
import type Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from './client';

export async function withFallback(client: Anthropic, text: string) {
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: text }],
  });
  return response.stop_reason;
}
