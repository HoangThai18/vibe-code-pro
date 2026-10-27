'use client';
// Anti-pattern for the hydration test: no explicit time zone
export function NaiveTime({ at }: { at: string }) {
  return <time id="at">{new Date(at).toLocaleString('vi-VN')}</time>;
}
