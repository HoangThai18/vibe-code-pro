// Cost of constructing Intl formatters vs reusing one (Node 22). Run: node scripts/bench-intl.mjs
const d = new Date('2026-10-24T08:30:00Z');
const opts = { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
const N = 20000;
const us = (f) => { const t = performance.now(); for (let i = 0; i < N; i++) f(i); return ((performance.now() - t) / N * 1000).toFixed(2); };
for (let run = 0; run < 3; run++) {
  const dtf = new Intl.DateTimeFormat('vi', opts);
  const nf = new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' });
  console.log(`run ${run}: new DateTimeFormat ${us(() => new Intl.DateTimeFormat('vi', opts).format(d))} us, cached ${us(() => dtf.format(d))} us; ` +
    `new NumberFormat ${us((i) => new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' }).format(i))} us, cached ${us((i) => nf.format(i))} us`);
}
