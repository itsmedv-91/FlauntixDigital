'use client';

import { useRef, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { discardOrphanUpload, registerAsset } from '@/lib/actions/assets';
import { ASSET_BUCKET, ASSET_KINDS, ASSET_MAX_BYTES } from '@/lib/constants';
import { formatBytes } from '@/lib/utils';
import { Button } from './ui';
import { Field, Input, Select, Textarea } from './ui';

/** Keeps the original extension so downloads open in the right application. */
function storagePath(agencyId: string, clientId: string | null, fileName: string) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return `${agencyId}/${clientId ?? '_agency'}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
}

/**
 * Uploads straight from the browser to Supabase Storage, then records the row
 * through a Server Action. The file deliberately never touches the Next server:
 * Server Actions are capped at 2mb and agencies upload video.
 */
export function AssetUpload({
  agencyId,
  clients,
  defaultClientId,
  replaces,
}: {
  agencyId: string;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
  replaces?: { id: string; name: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit(formData: FormData) {
    setError(null);
    setDone(null);
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    if (file.size > ASSET_MAX_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(ASSET_MAX_BYTES)}.`);
      return;
    }

    const clientId = (formData.get('client_id') as string) || null;
    const path = storagePath(agencyId, clientId, file.name);

    setBusy(`Uploading ${file.name}…`);
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(ASSET_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });

    if (uploadError) {
      setBusy(null);
      setError(`Upload failed: ${uploadError.message}`);
      return;
    }

    setBusy('Saving…');
    formData.set('storage_path', path);
    formData.set('mime_type', file.type || '');
    formData.set('size_bytes', String(file.size));
    if (!formData.get('name')) formData.set('name', file.name);
    if (replaces) formData.set('replaces_id', replaces.id);

    startTransition(async () => {
      try {
        await registerAsset(formData);
        setDone(`${formData.get('name')} added.`);
        setFile(null);
        formRef.current?.reset();
      } catch (e) {
        // The file is up but the row is not: take the file back out so the
        // library never shows a half-finished upload.
        await discardOrphanUpload(path).catch(() => {});
        setError(e instanceof Error ? e.message : 'Could not save the asset.');
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className="grid gap-4 sm:grid-cols-2">
      {replaces && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800 sm:col-span-2">
          Uploading a new version of <span className="font-semibold">{replaces.name}</span>. The current one is archived
          but stays downloadable.
        </p>
      )}

      <Field label="File" className="sm:col-span-2" hint={`Up to ${formatBytes(ASSET_MAX_BYTES)}`}>
        <input
          type="file"
          required
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-zinc-200"
        />
      </Field>

      <Field label="Name" hint={file ? `Defaults to ${file.name}` : 'Defaults to the file name'}>
        <Input name="name" placeholder="e.g. Nivaan logo — primary, dark" />
      </Field>
      <Field label="Kind">
        <Select name="kind" defaultValue="logo">
          {ASSET_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Client" hint="Leave empty for an agency-wide asset">
        <Select name="client_id" defaultValue={defaultClientId ?? ''}>
          <option value="">Agency-wide</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Tags" hint="Comma separated">
        <Input name="tags" placeholder="instagram, dark, svg" />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="description" rows={2} placeholder="Where to use it, what not to do with it…" />
      </Field>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={Boolean(busy) || !file}>
          {busy ?? (replaces ? 'Upload new version' : 'Add to library')}
        </Button>
        {file && !busy && <span className="ml-3 text-xs text-zinc-500">{formatBytes(file.size)}</span>}
        {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {done && <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>}
      </div>
    </form>
  );
}
