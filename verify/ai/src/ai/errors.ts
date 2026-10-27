// apps/api/src/ai/errors.ts
import Anthropic from '@anthropic-ai/sdk';

export class AiUnavailableError extends Error {}

// Transient errors (after SDK retries): report "AI temporarily unavailable"; the main flow keeps working.
// 400, 401, 403, 404 are code or config bugs: rethrow so error tracking catches them.
export function toAiError(err: unknown): unknown {
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    return new AiUnavailableError('AI tạm thời không dùng được', { cause: err });
  }
  return err;
}
