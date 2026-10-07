import { NextResponse } from 'next/server';
import { signedAssetUrl } from '@/lib/actions/assets';

/**
 * A permanent link that resolves to a fresh signed URL on every click.
 *
 * This is what makes library assets usable elsewhere: a signed URL expires, so
 * pasting one into `content_items.asset_urls` would rot within the hour. This
 * URL keeps working, and access is still checked per request — the `assets`
 * select policy decides whether the caller gets a link at all.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = await signedAssetUrl(id, true);
  if (!url) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.redirect(url, { status: 307 });
}
