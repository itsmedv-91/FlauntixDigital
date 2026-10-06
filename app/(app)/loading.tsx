export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded-lg bg-zinc-200/70" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-zinc-200/50" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-zinc-200/40" />
    </div>
  );
}
