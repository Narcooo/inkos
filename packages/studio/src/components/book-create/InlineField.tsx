import type { Theme } from "../../hooks/use-theme";

export interface InlineFieldProps {
  readonly fieldKey: string;
  readonly label: string;
  readonly value: string;
  readonly type?: "text" | "textarea" | "number";
  readonly onChange: (key: string, value: string) => void;
  readonly theme: Theme;
}

export function InlineField({ fieldKey, label, value, type = "text", onChange }: InlineFieldProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(fieldKey, e.target.value);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-background/70 px-4 py-3 my-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={handleChange}
          rows={4}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm leading-7 resize-y focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={handleChange}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
        />
      )}
    </div>
  );
}
