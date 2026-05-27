import { useState, useEffect } from "react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Wand2, Save, X, Edit2 } from "lucide-react";

interface StyleProfile {
  readonly sourceName?: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly paragraphLengthRange?: {
    readonly min: number;
    readonly max: number;
  };
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
  readonly analyzedAt?: string;
}

interface Nav {
  toBookDetail: (bookId: string) => void;
}

export function StyleProfileView({
  bookId,
  nav,
  theme,
  t,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data: bookData } = useApi<{ profile: StyleProfile }>(`/books/${bookId}/style`);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bookData?.profile) {
      setProfile(bookData.profile);
      setEditedProfile(null);
      setError(null);
    }
  }, [bookData]);

  const handleEdit = () => {
    if (profile) {
      setEditedProfile({ ...profile });
      setEditing(true);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setEditedProfile(null);
  };

  const handleSave = async () => {
    if (!editedProfile) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJson(`/books/${bookId}/style`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: editedProfile }),
      });
      setEditing(false);
      setEditedProfile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: unknown) => {
    if (!editedProfile) return;
    setEditedProfile({ ...editedProfile, [field]: value });
  };

  const updateArrayField = (field: string, value: string) => {
    if (!editedProfile) return;
    const currentValue = editedProfile[field] as ReadonlyArray<string> | undefined;
    const newArray = currentValue ? [...currentValue, value] : [value];
    setEditedProfile({ ...editedProfile, [field]: newArray });
  };

  const removeArrayItem = (field: string, index: number) => {
    if (!editedProfile) return;
    const currentValue = editedProfile[field] as ReadonlyArray<string> | undefined;
    if (!currentValue) return;
    const newArray = currentValue.filter((_, i) => i !== index);
    setEditedProfile({ ...editedProfile, [field]: newArray });
  };

  if (!profile) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button onClick={() => nav.toBookDetail(bookId)} className={c.link}>
            {t("bread.home")}
          </button>
          <span className="text-border">/</span>
          <span>{t("style.profile")}</span>
        </div>

        <div className="flex flex-col items-center justify-center py-32 space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
            <Wand2 size={32} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm italic font-serif text-muted-foreground">
            {t("style.noProfile")}
          </p>
        </div>
      </div>
    );
  }

  const displayProfile = editing && editedProfile ? editedProfile : profile;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => nav.toBookDetail(bookId)} className={c.link}>
          {t("bread.home")}
        </button>
        <span className="text-border">/</span>
        <span>{t("style.profile")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Wand2 size={28} className="text-primary" />
          {t("style.profileTitle")}
        </h1>

        {!editing ? (
          <button
            onClick={handleEdit}
            className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} flex items-center gap-2`}
          >
            <Edit2 size={14} />
            {t("style.edit")}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} flex items-center gap-2`}
            >
              <X size={14} />
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} flex items-center gap-2 disabled:opacity-50`}
            >
              <Save size={14} />
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive">
          {error}
        </div>
      )}

      <div className={`border ${c.cardStatic} rounded-lg p-6 space-y-6`}>
        {/* Source Name */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            {t("style.sourceName")}
          </label>
          {editing ? (
            <input
              type="text"
              value={(editedProfile.sourceName as string) || ""}
              onChange={(e) => updateField("sourceName", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="text-lg font-medium">{profile.sourceName || t("style.unnamed")}</div>
          )}
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-secondary/30 rounded-lg p-4">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
              {t("style.avgSentence")}
            </div>
            {editing ? (
              <input
                type="number"
                step="0.1"
                value={editedProfile.avgSentenceLength as number}
                onChange={(e) => updateField("avgSentenceLength", parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 rounded bg-background border border-border text-2xl font-bold"
              />
            ) : (
              <div className="text-2xl font-bold">{(profile.avgSentenceLength ?? 0).toFixed(1)}</div>
            )}
          </div>

          <div className="bg-secondary/30 rounded-lg p-4">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
              {t("style.sentenceStdDev")}
            </div>
            {editing ? (
              <input
                type="number"
                step="0.1"
                value={editedProfile.sentenceLengthStdDev as number}
                onChange={(e) => updateField("sentenceLengthStdDev", parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 rounded bg-background border border-border text-2xl font-bold"
              />
            ) : (
              <div className="text-2xl font-bold">{(profile.sentenceLengthStdDev ?? 0).toFixed(1)}</div>
            )}
          </div>

          <div className="bg-secondary/30 rounded-lg p-4">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
              {t("style.avgParagraph")}
            </div>
            {editing ? (
              <input
                type="number"
                value={editedProfile.avgParagraphLength as number}
                onChange={(e) => updateField("avgParagraphLength", parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 rounded bg-background border border-border text-2xl font-bold"
              />
            ) : (
              <div className="text-2xl font-bold">{(profile.avgParagraphLength ?? 0).toFixed(0)}</div>
            )}
          </div>

          <div className="bg-secondary/30 rounded-lg p-4">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
              {t("style.vocabDiversity")}
            </div>
            {editing ? (
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={editedProfile.vocabularyDiversity as number}
                onChange={(e) => updateField("vocabularyDiversity", parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 rounded bg-background border border-border text-2xl font-bold"
              />
            ) : (
              <div className="text-2xl font-bold">{((profile.vocabularyDiversity ?? 0) * 100).toFixed(0)}%</div>
            )}
          </div>
        </div>

        {/* Paragraph Length Range */}
        {profile.paragraphLengthRange && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-secondary/30 rounded-lg p-4">
              <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
                {t("style.minParagraph")}
              </div>
              {editing ? (
                <input
                  type="number"
                  value={(editedProfile.paragraphLengthRange as { min: number; max: number })?.min ?? 0}
                  onChange={(e) => {
                    const range = editedProfile.paragraphLengthRange as { min: number; max: number } | undefined;
                    updateField("paragraphLengthRange", {
                      min: parseInt(e.target.value) || 0,
                      max: range?.max ?? 0,
                    });
                  }}
                  className="w-full px-2 py-1 rounded bg-background border border-border text-xl font-bold"
                />
              ) : (
                <div className="text-xl font-bold">{profile.paragraphLengthRange.min}</div>
              )}
            </div>

            <div className="bg-secondary/30 rounded-lg p-4">
              <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
                {t("style.maxParagraph")}
              </div>
              {editing ? (
                <input
                  type="number"
                  value={(editedProfile.paragraphLengthRange as { min: number; max: number })?.max ?? 0}
                  onChange={(e) => {
                    const range = editedProfile.paragraphLengthRange as { min: number; max: number } | undefined;
                    updateField("paragraphLengthRange", {
                      min: range?.min ?? 0,
                      max: parseInt(e.target.value) || 0,
                    });
                  }}
                  className="w-full px-2 py-1 rounded bg-background border border-border text-xl font-bold"
                />
              ) : (
                <div className="text-xl font-bold">{profile.paragraphLengthRange.max}</div>
              )}
            </div>
          </div>
        )}

        {/* Top Patterns */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            {t("style.topPatterns")}
          </div>
          <div className="flex flex-wrap gap-2">
            {(displayProfile.topPatterns as ReadonlyArray<string> | undefined)?.map((pattern, index) => (
              <span
                key={index}
                className="px-3 py-1.5 text-sm bg-secondary rounded-lg flex items-center gap-2"
              >
                {pattern}
                {editing && (
                  <button
                    onClick={() => removeArrayItem("topPatterns", index)}
                    className="hover:text-destructive transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
            {editing && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("style.addPattern")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const input = e.target as HTMLInputElement;
                      if (input.value.trim()) {
                        updateArrayField("topPatterns", input.value.trim());
                        input.value = "";
                      }
                    }
                  }}
                  className="px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        </div>

        {/* Rhetorical Features */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            {t("style.rhetoricalFeatures")}
          </div>
          <div className="flex flex-wrap gap-2">
            {(displayProfile.rhetoricalFeatures as ReadonlyArray<string> | undefined)?.map((feature, index) => (
              <span
                key={index}
                className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg flex items-center gap-2"
              >
                {feature}
                {editing && (
                  <button
                    onClick={() => removeArrayItem("rhetoricalFeatures", index)}
                    className="hover:text-destructive transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
            {editing && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("style.addFeature")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const input = e.target as HTMLInputElement;
                      if (input.value.trim()) {
                        updateArrayField("rhetoricalFeatures", input.value.trim());
                        input.value = "";
                      }
                    }
                  }}
                  className="px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        </div>

        {/* Analyzed At */}
        {profile.analyzedAt && (
          <div className="text-xs text-muted-foreground">
            {t("style.analyzedAt")}: {new Date(profile.analyzedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
