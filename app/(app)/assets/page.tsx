import Link from 'next/link';
import { getContext } from '@/lib/auth';
import { deleteAsset, setAssetArchived, updateAsset } from '@/lib/actions/assets';
import { ASSET_BUCKET, ASSET_KINDS } from '@/lib/constants';
import type { Asset } from '@/lib/types';
import { AssetUpload } from '@/components/asset-upload';
import { CopyLink } from '@/components/copy-link';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { cn, formatBytes, formatDate } from '@/lib/utils';

export const metadata = { title: 'Assets' };

type Row = Asset & { client: { id: string; name: string } | null };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; kind?: string; q?: string; archived?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getContext();

  let q = ctx.supabase
    .from('assets')
    .select('*, client:clients(id, name)')
    .eq('agency_id', ctx.agencyId);
  if (sp.client) q = sp.client === 'none' ? q.is('client_id', null) : q.eq('client_id', sp.client);
  if (sp.kind) q = q.eq('kind', sp.kind);
  if (sp.q) q = q.ilike('name', `%${sp.q.replace(/[%_]/g, '')}%`);
  q = sp.archived === '1' ? q.not('archived_at', 'is', null) : q.is('archived_at', null);

  const [{ data, error }, { data: clients }] = await Promise.all([
    q.order('created_at', { ascending: false }).limit(300),
    ctx.isStaff
      ? ctx.supabase.from('clients').select('id, name').eq('agency_id', ctx.agencyId).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const assets = (data ?? []) as unknown as Row[];

  // One signed-URL call for the whole page; these are for inline previews only,
  // so they are short-lived. Downloads go through /assets/[id]/download, which
  // signs a fresh URL per click and never expires as a link.
  const imagePaths = assets
    .filter((a) => a.mime_type?.startsWith('image/'))
    .map((a) => a.storage_path);
  const previews = new Map<string, string>();
  if (imagePaths.length > 0) {
    const { data: signed } = await ctx.supabase.storage.from(ASSET_BUCKET).createSignedUrls(imagePaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) previews.set(s.path, s.signedUrl);
    }
  }

  const totalBytes = assets.reduce((s, a) => s + Number(a.size_bytes ?? 0), 0);
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    Object.entries({ ...sp, ...patch, new: undefined }).forEach(([k, v]) => v && next.set(k, String(v)));
    const qs = next.toString();
    return qs ? `/assets?${qs}` : '/assets';
  };

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={ctx.isStaff ? 'Logos, brand guides, fonts and creatives' : 'Brand assets for the work assigned to you'}
        actions={
          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
            <Link
              href={link({ archived: undefined })}
              className={cn('rounded-md px-3 py-1.5 font-medium', sp.archived !== '1' ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
            >
              Current
            </Link>
            <Link
              href={link({ archived: '1' })}
              className={cn('rounded-md px-3 py-1.5 font-medium', sp.archived === '1' ? 'bg-ink text-white' : 'text-zinc-600 hover:text-ink')}
            >
              Archived
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={sp.archived === '1' ? 'Archived' : 'Assets'} value={assets.length} />
        <Stat label="Storage used" value={formatBytes(totalBytes)} hint="Of what is listed" />
        <Stat label="Logos" value={assets.filter((a) => a.kind === 'logo').length} />
        <Stat label="Agency-wide" value={assets.filter((a) => !a.client_id).length} hint="Not tied to a client" />
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load the library: {error.message}
        </p>
      )}

      {ctx.isStaff && (
        <div className="mb-5 space-y-4">
          <Disclosure summary="Add an asset" open={sp.new === '1'}>
            <AssetUpload agencyId={ctx.agencyId} clients={clients ?? []} defaultClientId={sp.client} />
          </Disclosure>

          <form className="flex flex-wrap items-center gap-2" action="/assets">
            {sp.archived === '1' && <input type="hidden" name="archived" value="1" />}
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="Search by name…" className="w-56" />
            <Select name="client" defaultValue={sp.client ?? ''} className="w-auto">
              <option value="">All clients</option>
              <option value="none">Agency-wide only</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select name="kind" defaultValue={sp.kind ?? ''} className="w-auto">
              <option value="">Any kind</option>
              {ASSET_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </Select>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink ring-1 ring-zinc-200 hover:bg-zinc-50">Apply</button>
          </form>
        </div>
      )}

      {assets.length === 0 ? (
        <EmptyState
          title={sp.archived === '1' ? 'Nothing archived' : sp.q || sp.client || sp.kind ? 'No assets match' : 'The library is empty'}
          body={
            ctx.isStaff
              ? 'Upload logos, brand guides and fonts so nobody has to dig through WhatsApp for the right file.'
              : 'Brand assets for your clients will appear here.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => {
            const kind = ASSET_KINDS.find((k) => k.value === a.kind);
            const preview = previews.get(a.storage_path);
            return (
              <Card key={a.id} className="flex flex-col overflow-hidden">
                <div className="flex h-36 items-center justify-center border-b border-zinc-100 bg-zinc-50">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt={a.name} className="h-full w-full object-contain p-3" />
                  ) : (
                    <div className="text-center">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{kind?.label}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">{a.mime_type ?? 'file'}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium leading-snug text-ink">
                      {a.name}
                      {a.version > 1 && <span className="ml-1.5 text-xs font-normal text-zinc-400">v{a.version}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {[a.client?.name ?? 'Agency-wide', formatBytes(a.size_bytes), formatDate(a.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  {a.description && <p className="text-xs text-zinc-600">{a.description}</p>}

                  {!!a.tags?.length && (
                    <div className="flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  )}

                  {a.archived_at && <Badge className="w-fit bg-zinc-200 text-zinc-600">Archived</Badge>}

                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                    <a
                      href={`/assets/${a.id}/download`}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      Download
                    </a>
                    {ctx.isStaff && (
                      <form action={setAssetArchived.bind(null, a.id, !a.archived_at)}>
                        <button className="text-xs text-zinc-500 hover:text-ink">
                          {a.archived_at ? 'Restore' : 'Archive'}
                        </button>
                      </form>
                    )}
                    {ctx.isManager && (
                      <form action={deleteAsset.bind(null, a.id)}>
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          className="!px-0 !text-xs !text-zinc-400 hover:!text-red-600"
                          confirm={`Delete "${a.name}" and its file for good? Archiving keeps it available instead.`}
                          pendingText="…"
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    )}
                  </div>

                  {ctx.isStaff && (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-ink">
                        Details, link and new version
                      </summary>
                      <div className="mt-2 space-y-3 border-t border-zinc-100 pt-3">
                        <div>
                          <p className="mb-1 text-[11px] font-medium text-zinc-500">
                            Permanent link — paste into a content item&apos;s creative links
                          </p>
                          <CopyLink url={`/assets/${a.id}/download`} />
                        </div>
                        <form action={updateAsset.bind(null, a.id)} className="space-y-2">
                          <Field label="Name">
                            <Input name="name" defaultValue={a.name} required />
                          </Field>
                          <Field label="Kind">
                            <Select name="kind" defaultValue={a.kind}>
                              {ASSET_KINDS.map((k) => (
                                <option key={k.value} value={k.value}>{k.label}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Client">
                            <Select name="client_id" defaultValue={a.client_id ?? ''}>
                              <option value="">Agency-wide</option>
                              {(clients ?? []).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Tags">
                            <Input name="tags" defaultValue={a.tags?.join(', ') ?? ''} />
                          </Field>
                          <Field label="Notes">
                            <Textarea name="description" rows={2} defaultValue={a.description ?? ''} />
                          </Field>
                          <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                        </form>
                        <div className="border-t border-zinc-100 pt-3">
                          <AssetUpload
                            agencyId={ctx.agencyId}
                            clients={clients ?? []}
                            defaultClientId={a.client_id ?? undefined}
                            replaces={{ id: a.id, name: a.name }}
                          />
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
