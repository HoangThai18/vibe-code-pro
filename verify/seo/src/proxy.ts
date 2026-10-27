// src/proxy.ts — staging and previews: noindex on every response
import { NextResponse } from 'next/server';

// Read per request, so one build can go from staging to production.
// Fail closed: anything not explicitly production is noindex.
export function proxy() {
  const response = NextResponse.next();
  if (process.env.APP_ENV !== 'production') response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
