import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Unauthenticated (pre-login) branding lookup — platform_settings' RLS
// policy requires is_authenticated(), which the login page can never
// satisfy (no session yet). Only company_name/logo_url are exposed here,
// never anything else in that table.
export async function GET() {
  const supabase = getAdminClient();
  const { data } = await supabase.from('platform_settings').select('company_name, logo_url').eq('id', true).single();
  return NextResponse.json({
    company_name: data?.company_name ?? 'Installer Work Management',
    logo_url: data?.logo_url ?? null,
  });
}
