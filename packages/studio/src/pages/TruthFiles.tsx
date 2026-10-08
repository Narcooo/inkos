import { fetchJson, useApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Pencil, Save, X } from "lucide-react";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
  readonly readonly?: boolean;
  readonly readonlyReason?: string;
}

export interface FilePresentation {
  readonly canEdit: boolean;
  readonly readonly: boolean;
  readonly readonlyReason: string | null;
}

export function deriveFilePresentation(
  fileName: string | null,
  fileData: { content: string | null; readonly?: boolean; readonlyReason?: string } | null | undefined,
): FilePresentation {
  const readonly = fileData?.readonly === true;
  const canEdit = !!fileName && !!fileData && fileData.content != null && !readonly;
  return {
    canEdit,
    readonly,
    readonlyReason: readonly ? fileData?.readonlyReason ?? "readonly" : null,
  };
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function TruthFiles({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const { data: fileData, refetch: refetchFile } = useApi<{ file: string; content: string | null; readonly?: boolean; readonlyReason?: string }>(
    selected ? `/books/${bookId}/truth/${selected}` : "",
  );

  const presentation = deriveFilePresentation(selected, fileData);
  const isRuntimeDiagnostic = presentation.readonlyReason === "runtime-diagnostic";

  const startEdit = () => {
    setEditText(fileData?.content ?? "");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      await fetchJson(`/books/${bookId}/truth/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      setEditMode(false);
      refetchFile();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("truth.title")}</span>
      </div>

      <h1 className="font-serif text-3xl">{t("truth.title")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 sm:gap-6">
        {/* File list */}
        <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
          {data?.files.map((f) => (
            <button
              key={f.name}
              onClick={() => { setSelected(f.name); setEditMode(false); }}
              className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 transition-colors ${
                selected === f.name
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted/30 text-muted-foreground"
              }`}
            >
              <div className="font-mono text-sm truncate">{f.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{f.size.toLocaleString()} {t("truth.chars")}</div>
            </button>
          ))}
          {(!data?.files || data.files.length === 0) && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">{t("truth.empty")}</div>
          )}
        </div>

        {/* Content viewer */}
        <div className={`border ${c.cardStatic} rounded-lg p-5 min-h-[400px] flex flex-col`}>
          {selected && fileData?.content != null ? (
            <>
              {isRuntimeDiagnostic && (
                <div
                  data-testid="runtime-diagnostic-warning"
                  className="mb-3 px-3 py-2 rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs leading-relaxed"
                >
                  <div className="font-medium">运行时诊断文件 / Runtime diagnostic</div>
                  <div className="mt-1">
                    这里展示本章写作时的上下文选择、保护层、可压缩层和预算 trace。它只用于追溯系统看了什么，不作为可编辑设定。
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mb-3">
                {editMode ? (
                  <>
                    <button
                      onClick={cancelEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary}`}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50`}
                    >
                      <Save size={14} />
                      {savingEdit ? t("truth.saving") : t("truth.save")}
                    </button>
                  </>
                ) : (
                  presentation.canEdit && (
                    <button
                      onClick={startEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary}`}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  )
                )}
              </div>
              {editMode ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className={`${c.input} flex-1 rounded-md p-3 text-sm font-mono leading-relaxed resize-none min-h-[360px]`}
                />
              ) : (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80">{fileData.content}</pre>
              )}
            </>
          ) : selected && fileData?.content === null ? (
            <div className="text-muted-foreground text-sm">{t("truth.notFound")}</div>
          ) : (
            <div className="text-muted-foreground/50 text-sm italic">{t("truth.selectFile")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
