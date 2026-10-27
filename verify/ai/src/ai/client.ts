// apps/api/src/ai/client.ts
import Anthropic from '@anthropic-ai/sdk';

// Model lives in config: change it via env var, measure with the eval before changing (testing.md)
export const AI_MODEL = process.env.AI_MODEL ?? 'claude-opus-5-5';

export function createAiClient(options: ConstructorParameters<typeof Anthropic>[0] = {}): Anthropic {
  // Key read from ANTHROPIC_API_KEY on the server. The SDK retries 429, 5xx and network errors (2 times); timeout is in ms
  return new Anthropic({ timeout: 60_000, maxRetries: 2, ...options });
}
