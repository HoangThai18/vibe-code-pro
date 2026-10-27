// apps/api/src/ai/with-fallback.ts (beta: check the beta name and parameters in the current docs)
import type Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from './client';
import type { AiCallContext, AiUsageStore } from './usage';

export async function withFallback(deps: { client: Anthropic; usage: AiUsageStore }, call: AiCallContext, text: string) {
  const response = await deps.client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: text }],
  });
  // response.model answered; usage.iterations lists every attempt with its own model: record() prices each one
  await deps.usage.record(call, response.model, response.usage);
  return response;
}
