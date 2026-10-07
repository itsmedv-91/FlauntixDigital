import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Where portal magic links land. Exchanges the code, then binds this auth user
 * to their client_contacts rows once per sign-in (rather than on every page
 * load) so later lookups no longer depend on the email still matching.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.rpc('claim_portal_access');
      return NextResponse.redirect(`${origin}/portal`);
    }
  }
  return NextResponse.redirect(
    `${origin}/portal/login?error=${encodeURIComponent('That sign-in link is invalid or has expired. Ask for a new one.')}`,
  );
}
