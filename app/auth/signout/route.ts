import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // The portal sends its clients back to the portal's own sign-in page.
  const form = await request.formData().catch(() => null);
  const raw = form?.get('next');
  const next = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/login';

  const res = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  res.cookies.delete('flx_agency');
  return res;
}
