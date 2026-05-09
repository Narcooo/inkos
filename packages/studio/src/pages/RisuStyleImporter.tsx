import { useEffect, useMemo, useState } from "react";
import { FileJson, Save } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  CUSTOM_STYLE_TEMPLATE_EVENT,
  buildStyleTemplateFromRisuPreset,
  loadCustomStyleTemplates,
  saveCustomStyleTemplate,
  type StyleRevisionTemplate,
  type StyleTemplateLanguage,
} from "./style-revision-templates";

interface Nav {
  toDashboard: () => void;
  toStyleRevision: () => void;
}

function resolveLanguage(language: string): StyleTemplateLanguage {
  return language === "ko" ? "ko" : language === "en" ? "en" : "zh";
}

function copyFor(language: StyleTemplateLanguage) {
  return language === "ko"
    ? {
        title: "Risu to 문체",
        subtitle: "Risu 프리셋 JSON을 붙여 넣어 InkOS 문체 양식으로 저장합니다.",
        json: "Risu 프리셋 JSON",
        jsonPlaceholder: "Risu에서 내보낸 preset.json 내용을 붙여 넣으세요.",
        parse: "문체 추출",
        save: "문체로 저장",
        saved: "문체 양식으로 저장했습니다.",
        openRevision: "문체 변경에서 사용",
        preview: "추출 결과",
        savedStyles: "저장된 사용자 문체",
        noSaved: "아직 저장된 사용자 문체가 없습니다.",
      }
    : language === "en"
      ? {
          title: "Risu to Style",
          subtitle: "Paste a Risu preset JSON and save it as an InkOS style template.",
          json: "Risu preset JSON",
          jsonPlaceholder: "Paste the exported Risu preset.json content.",
          parse: "Extract Style",
          save: "Save as Style",
          saved: "Saved as a style template.",
          openRevision: "Use in Style Revision",
          preview: "Extracted Preview",
          savedStyles: "Saved Custom Styles",
          noSaved: "No custom styles saved yet.",
        }
      : {
          title: "Risu 转文风",
          subtitle: "粘贴 Risu preset JSON，并保存为 InkOS 文风模板。",
          json: "Risu preset JSON",
          jsonPlaceholder: "粘贴从 Risu 导出的 preset.json 内容。",
          parse: "提取文风",
          save: "保存为文风",
          saved: "已保存为文风模板。",
          openRevision: "在文风修改中使用",
          preview: "提取预览",
          savedStyles: "已保存自定义文风",
          noSaved: "还没有保存自定义文风。",
        };
}

export function RisuStyleImporter({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const language = resolveLanguage(lang);
  const copy = copyFor(language);
  const [jsonText, setJsonText] = useState("");
  const [template, setTemplate] = useState<StyleRevisionTemplate | null>(null);
  const [saved, setSaved] = useState<ReadonlyArray<StyleRevisionTemplate>>(() => loadCustomStyleTemplates());
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const onTemplatesChanged = () => setSaved(loadCustomStyleTemplates());
    window.addEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
    return () => window.removeEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
  }, []);

  const rules = useMemo(() => template?.rules[language] ?? [], [language, template]);

  const parse = () => {
    setStatus(null);
    try {
      const nextTemplate = buildStyleTemplateFromRisuPreset(jsonText);
      setTemplate(nextTemplate);
    } catch (error) {
      setTemplate(null);
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Invalid Risu JSON" });
    }
  };

  const save = () => {
    if (!template) return;
    saveCustomStyleTemplate(template);
    setStatus({ tone: "success", message: copy.saved });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{copy.title}</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <FileJson size={18} />
          </div>
          <h1 className="font-serif text-4xl">{copy.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground leading-7 max-w-2xl">{copy.subtitle}</p>
      </div>

      {status && (
        <div className={`rounded-md border px-4 py-3 text-sm ${
          status.tone === "error" ? c.error : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        }`}>
          {status.message}
        </div>
      )}

      <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-5">
        <label className="space-y-2 block">
          <span className="text-xs font-medium text-muted-foreground">{copy.json}</span>
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            rows={12}
            className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y font-mono`}
            placeholder={copy.jsonPlaceholder}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={parse}
            disabled={!jsonText.trim()}
            className={`inline-flex items-center gap-2 px-4 py-2.5 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
          >
            <FileJson size={15} />
            {copy.parse}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!template}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-sm"
          >
            <Save size={15} />
            {copy.save}
          </button>
          <button
            type="button"
            onClick={nav.toStyleRevision}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 font-medium text-sm"
          >
            {copy.openRevision}
          </button>
        </div>
      </section>

      {template && (
        <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{copy.preview}</div>
            <h2 className="text-xl font-serif mt-1">{template.label[language]}</h2>
            <p className="text-sm text-muted-foreground leading-7 mt-1">{template.description[language]}</p>
          </div>
          <ul className="space-y-2 text-sm leading-6">
            {rules.map((rule) => (
              <li key={rule} className="flex gap-2">
                <span className="text-primary">-</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-3">
        <h2 className="text-lg font-serif">{copy.savedStyles}</h2>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.noSaved}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {saved.map((item) => (
              <div key={item.id} className="rounded-md border border-border/60 bg-background/60 p-3">
                <div className="font-medium text-sm">{item.label[language]}</div>
                <p className="text-xs text-muted-foreground leading-6 mt-1">{item.description[language]}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
