// apps/web/src/features/ai/settle-draft.ts — what the reply box keeps once the stream ends
import type { DraftResult } from './read-draft-stream';

// The user watched the text arrive: say why it changed. Refused or failed: never leave half an answer to send
export function settleDraft(text: string, result: DraftResult): { text: string; notice: string | null } {
  switch (result) {
    case 'done':
      return { text, notice: null };
    case 'truncated':
      return { text, notice: 'Bản nháp bị cắt giữa chừng: đọc lại và viết nốt trước khi gửi.' };
    case 'refused':
      return { text: '', notice: 'AI không soạn nháp cho tin nhắn này. Bạn tự trả lời nhé.' };
    case 'error':
      return { text: '', notice: 'AI tạm thời không dùng được. Bạn tự trả lời nhé.' };
  }
}
