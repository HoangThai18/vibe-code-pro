import { IntlMessageFormat } from 'intl-messageformat';
const cp = (s: string) => JSON.stringify(s) + ' ' + [...s].filter(c => c.codePointAt(0)! > 0x7e || c === ' ').map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(',');
const d = new Date('2026-10-24T08:30:00Z');
console.log(cp(new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' }).format(1250000)));
console.log(cp(new Intl.NumberFormat('en', { style: 'currency', currency: 'VND' }).format(1250000)));
console.log(cp(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(125050 / 100)));
console.log(cp(new Intl.NumberFormat('vi', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(125050 / 100)));
console.log(cp(new Intl.DateTimeFormat('vi', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)));
console.log(cp(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' }).format(d)));
console.log(cp(new Intl.DateTimeFormat('en', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date('2001-07-18T00:00:00Z'))));
console.log(cp(new Intl.DateTimeFormat('vi', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date('2001-07-18T00:00:00Z'))));
const m = new IntlMessageFormat('{count, plural, other {# khách}} lúc {at, date, short} {at, time, short}', 'vi');
console.log(cp(String(m.format({ count: 1250, at: d }))));
const e = new IntlMessageFormat('{count, plural, one {# customer} other {# customers}}', 'en');
console.log(e.format({ count: 1 }), '|', e.format({ count: 1250 }), '|', e.format({ count: 0 }));
try { console.log(new IntlMessageFormat('{count, plural, one {# khách} other {# khách}}', 'vi').format({ count: 1 })); } catch (err) { console.log('ERR', (err as Error).message); }
try { console.log(new IntlMessageFormat('Chào {name}', 'vi').format({})); } catch (err) { console.log('ERR missing', (err as Error).message); }
console.log(new Intl.PluralRules('vi').select(1), new Intl.PluralRules('en').select(1), new Intl.PluralRules('en').select(0), new Intl.PluralRules('vi').resolvedOptions().pluralCategories, new Intl.PluralRules('en').resolvedOptions().pluralCategories);
let t = performance.now(); for (let i = 0; i < 10000; i++) new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' }).format(i); console.log('nf new each', ((performance.now() - t) / 10000 * 1000).toFixed(1), 'us');
const nf = new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' }); t = performance.now(); for (let i = 0; i < 10000; i++) nf.format(i); console.log('nf cached', ((performance.now() - t) / 10000 * 1000).toFixed(2), 'us');
t = performance.now(); for (let i = 0; i < 10000; i++) new Intl.DateTimeFormat('vi', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); console.log('dtf new each', ((performance.now() - t) / 10000 * 1000).toFixed(1), 'us');
