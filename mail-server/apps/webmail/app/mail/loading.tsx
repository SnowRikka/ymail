export default function MailLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-4 lg:px-6">
      <div className="shell-surface min-h-[88vh] rounded-[32px] border border-line/70 p-4 shadow-shell md:p-6">
        <div className="h-12 w-52 animate-pulse rounded-full bg-accent/15" />
        <div className="mt-6 grid gap-4 md:grid-cols-[280px_320px_1fr]">
          <div className="h-[72vh] animate-pulse rounded-[28px] bg-mist" />
          <div className="h-[72vh] animate-pulse rounded-[28px] bg-mist" />
          <div className="h-[72vh] animate-pulse rounded-[28px] bg-mist" />
        </div>
      </div>
    </main>
  );
}
