export interface InlineGroupProps {
  readonly label?: string;
  readonly children: React.ReactNode;
}

export function InlineGroup({ label, children }: InlineGroupProps) {
  return (
    <div className="my-2">
      {label && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {children}
      </div>
    </div>
  );
}
