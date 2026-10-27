// test/html.ts — just enough HTML parsing for SEO checks (no browser, no JavaScript run)
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrs = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!.toLowerCase(), decode(m[2]!)]));
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => attrs(m[0]));

export function seoOf(html: string) {
  const meta = (key: string) => tags(html, 'meta').find((t) => t.name === key || t.property === key)?.content;
  const links = tags(html, 'link');
  return {
    title: decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''),
    description: meta('description'),
    robots: meta('robots'),
    ogUrl: meta('og:url'),
    ogImage: meta('og:image'),
    twitterCard: meta('twitter:card'),
    canonical: links.find((l) => l.rel === 'canonical')?.href,
    hreflang: Object.fromEntries(links.filter((l) => l.rel === 'alternate' && l.hreflang).map((l) => [l.hreflang!, l.href!])),
    jsonLd: [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>),
  };
}

// What a crawler reads without running JavaScript: scripts (and the RSC payload in them) and React's <!-- --> removed
export const visibleHtml = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');

export const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
