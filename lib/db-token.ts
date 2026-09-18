import crypto from 'crypto';

/**
 * Server-only JWT issuer for PostgREST. Signed with SUPABASE_JWT_SECRET so
 * RLS policies can read identity via request.jwt.claims instead of relying
 * on auth.uid() (which is always NULL since we don't use Supabase Auth).
 *
 * role is intentionally 'anon', not 'authenticated' — RLS policies in the
 * migrations are written for `anon` grants that check custom claims
 * (username/user_role/user_id) rather than switching Postgres role.
 */
const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const TOKEN_HOURS = 8;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface DbTokenUser {
  id: string;
  username: string;
  full_name?: string | null;
  role?: string | null;
}

/** Returns null (never fails login) if SUPABASE_JWT_SECRET isn't configured yet. */
export function issueDbToken(user: DbTokenUser): string | null {
  if (!SECRET) return null;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_HOURS * 3600;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    role: 'anon',
    aud: 'authenticated',
    iat,
    exp,
    user_id: user.id,
    username: user.username,
    user_role: user.role ?? '',
    full_name: user.full_name ?? '',
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}
