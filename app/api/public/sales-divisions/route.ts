import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// The registration form needs the division list before anyone is logged in,
// and sales_divisions' RLS policy requires is_authenticated() — so the read
// goes through the service role here, exposing nothing but id + name of
// active divisions (the same labels the login page's branding already is).
export async function GET() {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from('sales_divisions')
    .select('id, name')
    .eq('active', true)
    .order('sort_order');
  return NextResponse.json({ divisions: data ?? [] });
}
