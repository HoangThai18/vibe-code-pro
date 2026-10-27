// src/i18n/check-messages.ts — CI step: node --import tsx src/i18n/check-messages.ts messages
// Each locale: exactly vi's keys, the same {arguments}, plural branches per Intl.PluralRules
import { isPluralElement, isStructurallySame, parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function flatten(node: object, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else flatten(v, `${prefix}${k}.`, out);
  }
  return out;
}

// en needs one + other; vi has only other (`one` in vi is dead text); =0 branches are always fine
function pluralErrors(ast: MessageFormatElement[], locale: string): string[] {
  const allowed: string[] = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  return ast.filter(isPluralElement).flatMap((el) => {
    const keys = Object.keys(el.options).filter((k) => !k.startsWith('='));
    return [
      ...allowed.filter((c) => !keys.includes(c)).map((c) => `{${el.value}} lacks '${c}'`),
      ...keys.filter((k) => !allowed.includes(k)).map((k) => `{${el.value}} has '${k}', not a ${locale} category`),
      ...Object.values(el.options).flatMap((o) => pluralErrors(o.value, locale)),
    ];
  });
}

export function checkMessages(dir: string, base = 'vi'): string[] {
  const load = (locale: string) => flatten(JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')));
  const ref = load(base);
  const errors: string[] = [];
  for (const locale of readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))) {
    const catalog = load(locale);
    for (const key of ref.keys()) if (!catalog.has(key)) errors.push(`${locale}: missing ${key}`);
    for (const [key, message] of catalog) {
      const refMessage = ref.get(key);
      if (refMessage === undefined) { errors.push(`${locale}: ${key} is not in ${base}.json`); continue; }
      try {
        const ast = parse(message, { requiresOtherClause: true });
        const same = isStructurallySame(parse(refMessage), ast);
        if (!same.success) errors.push(`${locale}: ${key}: ${same.error?.message}`);
        errors.push(...pluralErrors(ast, locale).map((e) => `${locale}: ${key}: ${e}`));
      } catch (err) {
        errors.push(`${locale}: ${key}: invalid ICU message (${(err as Error).message})`);
      }
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkMessages(process.argv[2] ?? 'messages');
  errors.forEach((e) => console.error(e));
  process.exitCode = errors.length ? 1 : 0;
}
