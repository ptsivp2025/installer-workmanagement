import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/_next/', '/favicon', '/icon'];

const PUBLIC_EXACT = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
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
