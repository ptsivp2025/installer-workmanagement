import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Unauthenticated (pre-login) branding lookup — platform_settings' RLS
// policy requires is_authenticated(), which the login page can never
// satisfy (no session yet). Also the single source the in-app ThemeProvider
// uses (providers.tsx), so the same color/logo apply on login AND every
// authenticated page — never anything else from that table.
export async function GET() {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from('platform_settings')
    .select('company_name, logo_url, primary_color, secondary_color, login_bg_url, login_headline, login_subheadline')
    .eq('id', true)
    .single();
  return NextResponse.json({
    company_name: data?.company_name ?? 'Installer Work Management',
    logo_url: data?.logo_url ?? null,
    primary_color: data?.primary_color ?? '#2563eb',
    secondary_color: data?.secondary_color ?? '#1d4ed8',
    login_bg_url: data?.login_bg_url ?? null,
    login_headline: data?.login_headline ?? null,
    login_subheadline: data?.login_subheadline ?? null,
  });
}
