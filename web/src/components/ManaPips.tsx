const PIP: Record<string, string> = {
  W: 'bg-amber-100 text-slate-800',
  U: 'bg-sky-500 text-white',
  B: 'bg-slate-600 text-white',
  R: 'bg-red-500 text-white',
  G: 'bg-emerald-600 text-white',
};

/** "UBr" -> main colors U,B + splash r (lowercase, dimmed). */
export function ManaPips({ colors }: { colors: string }) {
  return (
    <span className="inline-flex gap-0.5">
      {[...colors].map((c, i) => (
        <span
          key={i}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${PIP[c.toUpperCase()] ?? 'bg-slate-700'} ${c === c.toLowerCase() ? 'opacity-50 scale-90' : ''}`}
          title={c === c.toLowerCase() ? 'splash' : undefined}
        >
          {c.toUpperCase()}
        </span>
      ))}
    </span>
  );
}
