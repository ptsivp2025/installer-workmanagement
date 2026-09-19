import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/_next/', '/favicon', '/icon'];

const PUBLIC_EXACT = [
  '/login',
  // Self-registration is by definition reached without a session, and so
  // are the two reads its form needs (branding for the hero, the division
  // list for the dropdown) — every one of them is already write-guarded or
  // read-only on its own side.
  '/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/register',
  '/api/public/branding',
  '/api/public/sales-divisions',
];

const CRON_PREFIX = '/api/cron/';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXACT.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith(CRON_PREFIX)) return NextResponse.next();

  const session = request.cookies.get('iwm_session');
  if (!session?.value) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
