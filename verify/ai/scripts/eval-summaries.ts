// scripts/eval-summaries.ts
// Chạy khi đổi prompt, model, effort: npx tsx scripts/eval-summaries.ts
// Gọi API thật nên tốn tiền: chạy tay hoặc theo lịch, không chạy ở mọi PR
import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import { createAiClient } from '../src/ai/client';
import { summarizeNotes, type CustomerNote } from '../src/ai/summarize-notes';
import { costMicroUsd, type AiUsageStore } from '../src/ai/usage';

interface EvalCase {
  id: string;
  notes: CustomerNote[];
  mustMention: string[];
  mustNotMention: string[];
}

export async function runEval(client: Anthropic, cases: EvalCase[]) {
  let spent = 0;
  const usage: AiUsageStore = {
    monthCostMicroUsd: async () => 0,
    monthBudgetMicroUsd: async () => Number.MAX_SAFE_INTEGER,
    record: async (_ctx, model, u) => void (spent += costMicroUsd(model, u)),
  };
  const results = [];
  for (const c of cases) {
    try {
      const out = await summarizeNotes({ client, usage }, { tenantId: 'eval', userId: 'eval' }, c.notes);
      const text = `${out.summary}\n${out.followUps.join('\n')}`.toLowerCase();
      const missing = c.mustMention.filter((s) => !text.includes(s.toLowerCase()));
      const leaked = c.mustNotMention.filter((s) => text.includes(s.toLowerCase()));
      results.push({ id: c.id, pass: missing.length === 0 && leaked.length === 0, missing, leaked });
    } catch (err) {
      results.push({ id: c.id, pass: false, error: String(err) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: cases.length, costUsd: spent / 1e6, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = JSON.parse(await readFile(new URL('../evals/summaries.json', import.meta.url), 'utf8')) as EvalCase[];
  const report = await runEval(createAiClient(), cases);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
}
