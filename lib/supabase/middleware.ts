import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/invite', '/forgot-password', '/portal/login', '/portal/auth'];

function isPortalPath(path: string) {
  return path === '/portal' || path.startsWith('/portal/');
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Not configured yet: let the setup screen explain what's missing.
    return response;
  }

  const supabase = createServerClient(url, key, {
    // Annotated because the option is a union of the current and the
    // deprecated cookie APIs, which blocks contextual typing.
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    } satisfies CookieMethodsServer,
  });

  // Refreshes the auth token if expired. Must run before any redirect logic.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.search = '';
    // Clients belong on the portal's own sign-in page, not the team one.
    if (isPortalPath(path)) {
      redirect.pathname = '/portal/login';
    } else {
      redirect.pathname = '/login';
      redirect.searchParams.set('next', path);
    }
    return NextResponse.redirect(redirect);
  }

  if (user && (path === '/login' || path === '/signup')) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}
