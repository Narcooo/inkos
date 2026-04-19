import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en";
}

interface GenreDetail {
  readonly profile: {
    readonly name: string;
    readonly id: string;
    readonly language: string;
    readonly chapterTypes: ReadonlyArray<string>;
    readonly fatigueWords: ReadonlyArray<string>;
    readonly numericalSystem: boolean;
    readonly powerScaling: boolean;
    readonly eraResearch: boolean;
    readonly pacingRule: string;
    readonly auditDimensions: ReadonlyArray<number>;
  };
  readonly body: string;
}

interface GenreFormData {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly chapterTypes: string;
  readonly fatigueWords: string;
  readonly numericalSystem: boolean;
  readonly powerScaling: boolean;
  readonly eraResearch: boolean;
  readonly pacingRule: string;
  readonly body: string;
}

const EMPTY_FORM: GenreFormData = {
  id: "",
  name: "",
  language: "zh",
  chapterTypes: "",
  fatigueWords: "",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  body: "",
};

function parseCommaSeparated(value: string): ReadonlyArray<string> {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function GenreForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isEdit,
  c,
  t,
}: {
  readonly form: GenreFormData;
  readonly onChange: (next: GenreFormData) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly isEdit: boolean;
  readonly c: ReturnType<typeof useColors>;
  readonly t: TFunction;
}) {
  const set = <K extends keyof GenreFormData>(key: K, value: GenreFormData[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wide">ID</label>
          <input
            type="text"
            value={form.id}
            onChange={(e) => set("id", e.target.value)}
            disabled={isEdit}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide">Language</label>
        <select
          value={form.language}
          onChange={(e) => set("language", e.target.value as "zh" | "en")}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="zh">zh</option>
          <option value="en">en</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide">
          Chapter Types (comma-separated)
        </label>
        <input
          type="text"
          value={form.chapterTypes}
          onChange={(e) => set("chapterTypes", e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide">
          Fatigue Words (comma-separated)
        </label>
        <input
          type="text"
          value={form.fatigueWords}
          onChange={(e) => set("fatigueWords", e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.numericalSystem}
            onChange={(e) => set("numericalSystem", e.target.checked)}
          />
          Numerical System
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.powerScaling}
            onChange={(e) => set("powerScaling", e.target.checked)}
          />
          Power Scaling
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.eraResearch}
            onChange={(e) => set("eraResearch", e.target.checked)}
          />
          Era Research
        </label>
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide">Pacing Rule</label>
        <input
          type="text"
          value={form.pacingRule}
          onChange={(e) => set("pacingRule", e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wide">Rules (Markdown)</label>
        <textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onSubmit} className={`px-4 py-2 text-sm rounded-md ${c.btnPrimary}`}>
          {isEdit ? t("genre.saveChanges") : t("genre.createNew")}
        </button>
        <button onClick={onCancel} className={`px-4 py-2 text-sm rounded-md ${c.btnSecondary}`}>
          {t("genre.cancel")}
        </button>
      </div>
    </div>
  );
}

interface Nav {
  toDashboard: () => void;
}

export function GenreManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data, refetch } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const [selected, setSelected] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"hidden" | "create" | "edit">("hidden");
  const [form, setForm] = useState<GenreFormData>(EMPTY_FORM);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Only show genres matching current language, plus custom project genres
  const filteredGenres = data?.genres.filter((g) => g.language === lang || g.source === "project") ?? [];
  const validSelected = selected && filteredGenres.some((g) => g.id === selected) ? selected : null;
  const selectedGenre = filteredGenres.find((g) => g.id === validSelected) ?? null;

  const { data: detail } = useApi<GenreDetail>(validSelected ? `/genres/${validSelected}` : "");

  const handleCopy = async (id: string) => {
    await postApi(`/genres/${id}/copy`);
    alert(`Copied ${id} to project genres/`);
    refetch();
  };

  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setFormMode("create");
  };

  const openEditForm = () => {
    if (!detail) return;
    setForm({
      id: detail.profile.id,
      name: detail.profile.name,
      language: detail.profile.language as "zh" | "en",
      chapterTypes: detail.profile.chapterTypes.join(", "),
      fatigueWords: detail.profile.fatigueWords.join(", "),
      numericalSystem: detail.profile.numericalSystem,
      powerScaling: detail.profile.powerScaling,
      eraResearch: detail.profile.eraResearch ?? false,
      pacingRule: detail.profile.pacingRule,
      body: detail.body,
    });
    setFormMode("edit");
  };

  const closeForm = () => {
    setFormMode("hidden");
  };

  const handleCreate = async () => {
    try {
      await postApi("/genres/create", {
        id: form.id,
        name: form.name,
        language: form.language,
        chapterTypes: parseCommaSeparated(form.chapterTypes),
        fatigueWords: parseCommaSeparated(form.fatigueWords),
        numericalSystem: form.numericalSystem,
        powerScaling: form.powerScaling,
        eraResearch: form.eraResearch,
        pacingRule: form.pacingRule,
        body: form.body,
      });
      setFormMode("hidden");
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create genre");
    }
  };

  const handleEdit = async () => {
    if (!validSelected) return;
    try {
      await fetchJson(`/genres/${validSelected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            id: form.id,
            name: form.name,
            language: form.language,
            chapterTypes: parseCommaSeparated(form.chapterTypes),
            fatigueWords: parseCommaSeparated(form.fatigueWords),
            numericalSystem: form.numericalSystem,
            powerScaling: form.powerScaling,
            eraResearch: form.eraResearch,
            pacingRule: form.pacingRule,
          },
          body: form.body,
        }),
      });
      setFormMode("hidden");
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update genre");
    }
  };

  const handleDelete = async () => {
    if (!validSelected) return;
    setConfirmDeleteOpen(false);
    try {
      await fetchJson(`/genres/${validSelected}`, { method: "DELETE" });
      setSelected(null);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete genre");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("create.genre")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">{t("create.genre")}</h1>
        <button
          onClick={openCreateForm}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md ${c.btnPrimary}`}
        >
          <Plus size={16} />
          Create Genre
        </button>
      </div>

      {formMode !== "hidden" && (
        <div className={`border ${c.cardStatic} rounded-lg p-6`}>
          <h2 className="text-lg font-medium mb-4">
            {formMode === "create" ? "Create New Genre" : `Edit: ${form.id}`}
          </h2>
          <GenreForm
            form={form}
            onChange={setForm}
            onSubmit={formMode === "create" ? handleCreate : handleEdit}
            onCancel={closeForm}
            isEdit={formMode === "edit"}
            c={c}
            t={t}
          />
        </div>
      )}

      <div className="grid grid-cols-[250px_1fr] gap-6">
        {/* Genre list */}
        <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
          {filteredGenres.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelected(g.id)}
              className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors ${
                validSelected === g.id ? "bg-primary/10 text-primary" : "hover:bg-muted/30"
              }`}
            >
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {g.id} · {g.language} · {g.source}
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className={`border ${c.cardStatic} rounded-lg p-6 min-h-[400px]`}>
          {validSelected && detail ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-medium">{detail.profile.name}</h2>
                  <div className="text-sm text-muted-foreground mt-1">
                    {detail.profile.id} · {detail.profile.language} ·
                    {detail.profile.numericalSystem ? " Numerical" : ""}
                    {detail.profile.powerScaling ? " Power" : ""}
                    {detail.profile.eraResearch ? " Era" : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={openEditForm}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${c.btnSecondary} rounded-md`}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  {selectedGenre?.source === "project" && (
                    <button
                      onClick={() => setConfirmDeleteOpen(true)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${c.btnDanger} rounded-md`}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                  <button
                    onClick={() => validSelected && handleCopy(validSelected)}
                    className={`px-3 py-1.5 text-sm ${c.btnSecondary} rounded-md`}
                  >
                    Copy to Project
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Chapter Types</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.chapterTypes.map((ct) => (
                    <span key={ct} className="px-2 py-1 text-xs bg-secondary rounded">{ct}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Fatigue Words</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.fatigueWords.slice(0, 15).map((w) => (
                    <span key={w} className="px-2 py-1 text-xs bg-secondary rounded">{w}</span>
                  ))}
                  {detail.profile.fatigueWords.length > 15 && (
                    <span className="text-xs text-muted-foreground">+{detail.profile.fatigueWords.length - 15}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Pacing</div>
                <div className="text-sm">{detail.profile.pacingRule || "—"}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Rules</div>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80 bg-muted/30 p-4 rounded-md max-h-[300px] overflow-y-auto">
                  {detail.body || "—"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic flex items-center justify-center h-full">
              Select a genre to view details
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Genre"
        message={`Delete genre "${validSelected}"?`}
        confirmLabel={t("common.delete") ?? "Delete"}
        cancelLabel={t("genre.cancel") ?? "Cancel"}
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
