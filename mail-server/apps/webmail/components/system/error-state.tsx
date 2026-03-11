'use client';

type ErrorStateProps = {
  actionLabel: string;
  description: string;
  onAction: () => void;
  title: string;
};

export function ErrorState({ actionLabel, description, onAction, title }: ErrorStateProps) {
  return (
    <section className="shell-surface w-full max-w-xl rounded-[32px] border border-line/70 px-8 py-10 shadow-shell">
      <p className="font-serif text-sm uppercase tracking-[0.32em] text-accent">出错了</p>
      <h2 className="mt-4 text-3xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm leading-7 ink-muted">{description}</p>
      <button
        className="mt-8 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white"
        onClick={onAction}
        type="button"
      >
        {actionLabel}
      </button>
    </section>
  );
}
