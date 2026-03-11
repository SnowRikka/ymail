export default function RootLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="shell-surface w-full max-w-md rounded-[28px] border border-line/70 px-8 py-10 shadow-shell">
        <div className="h-3 w-20 animate-pulse rounded-full bg-accent/15" />
        <div className="mt-5 h-8 w-40 animate-pulse rounded-full bg-ink/10" />
        <div className="mt-8 space-y-3">
          <div className="h-12 animate-pulse rounded-2xl bg-mist" />
          <div className="h-12 animate-pulse rounded-2xl bg-mist" />
        </div>
      </div>
    </main>
  );
}
