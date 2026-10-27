const codes = new Map([
  ['TET10', { type: 'percent', value: 10 }],
  ['GIAM50K', { type: 'amount', value: 50_000 }],
]);

export function findDiscount(code) {
  return codes.get(String(code ?? '').trim().toUpperCase()) ?? null;
}
