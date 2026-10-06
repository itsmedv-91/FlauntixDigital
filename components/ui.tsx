import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn, displayName, initials } from '@/lib/utils';

export const btn = {
  base: 'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  primary: 'bg-brand-500 px-3.5 py-2 text-white hover:bg-brand-600',
  secondary: 'border border-zinc-200 bg-white px-3.5 py-2 text-ink hover:bg-zinc-50',
  ghost: 'px-2.5 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-ink',
  danger: 'border border-red-200 bg-white px-3.5 py-2 text-red-600 hover:bg-red-50',
  sm: 'px-2.5 py-1.5 text-xs',
};

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: 'sm' }) {
  return <button className={cn(btn.base, btn[variant], size === 'sm' && btn.sm, className)} {...props} />;
}

export function LinkButton({
  variant = 'primary',
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: 'sm' }) {
  return <Link className={cn(btn.base, btn[variant], size === 'sm' && btn.sm, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-zinc-200/80 bg-white shadow-card', className)} {...props} />;
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1.5 inline-block text-xs font-medium text-zinc-500 hover:text-brand-600">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', className ?? 'bg-zinc-100 text-zinc-700')}>
      {children}
    </span>
  );
}

export function Avatar({
  person,
  size = 'md',
}: {
  person: { full_name?: string | null; email?: string | null } | null | undefined;
  size?: 'sm' | 'md';
}) {
  const name = displayName(person);
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs',
      )}
      style={{ backgroundColor: `hsl(${hue} 55% 48%)` }}
    >
      {initials(name)}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-zinc-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={cn(inputCls, props.className)} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cn(inputCls, 'pr-8', className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/60 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-zinc-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tracking-tight', tone === 'warn' ? 'text-coral-500' : 'text-ink')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </Card>
  );
}

/** A no-JS disclosure panel for "New …" forms. */
export function Disclosure({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-zinc-200/80 bg-white shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="text-zinc-400 transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-zinc-100 px-5 py-4">{children}</div>
    </details>
  );
}
