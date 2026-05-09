import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Upload, Wand2 } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  CUSTOM_STYLE_TEMPLATE_EVENT,
  buildStyleRevisionBrief,
  findStyleRevisionTemplate,
  getAllStyleRevisionTemplates,
  type StyleRevisionTemplate,
  type StyleTemplateLanguage,
} from "./style-revision-templates";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly language?: string;
}

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
}

interface BookDetailResponse {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly language?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

interface RevisionResponse {
  readonly savedPath?: string;
  readonly persistedAs?: "chapter" | "copy";
}

interface TextRevisionResponse {
  readonly revisedContent: string;
  readonly fileName: string;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

type SourceMode = "book" | "file";

function resolveLanguage(lang: string | undefined, uiLang: string): StyleTemplateLanguage {
  if (lang === "ko" || uiLang === "ko") return "ko";
  if (lang === "en" || uiLang === "en") return "en";
  return "zh";
}

function copyFor(language: StyleTemplateLanguage) {
  return language === "ko"
    ? {
        title: "문체 변경",
        subtitle: "완성된 장을 선택한 문체 양식에 맞춰 다시 다듬습니다. 사건 사실과 결말은 유지됩니다.",
        book: "작품",
        chapter: "장",
        template: "문체 양식",
        custom: "추가 지시",
        customPlaceholder: "선택 사항. 이번 장에만 적용할 문체 지시를 덧붙이세요.",
        run: "문체 변경 실행",
        running: "변경 중...",
        openBook: "작품 열기",
        chooseBook: "작품 선택",
        chooseChapter: "장 선택",
        noChapters: "선택한 작품에 아직 장이 없습니다.",
        success: "문체 변경을 완료했습니다.",
        savedAt: "사본 저장 위치",
        failed: "문체 변경 실패",
        source: "대상",
        bookSource: "작품 장",
        fileSource: "텍스트 파일",
        file: "텍스트 또는 Markdown 파일",
        chooseFile: ".txt 또는 .md 파일을 선택하세요.",
        fileText: "파일 내용",
        filePlaceholder: "파일을 선택하거나 문체를 변경할 텍스트를 붙여 넣으세요.",
        runFile: "파일 문체 변경",
        download: "변경본 다운로드",
        fileSuccess: "파일 문체 변경을 완료했습니다.",
        unsupportedFile: "텍스트 파일(.txt, .md, .markdown)만 사용할 수 있습니다.",
      }
    : language === "en"
      ? {
          title: "Style Revision",
          subtitle: "Revise a completed chapter with a selected style template while preserving plot facts and ending outcome.",
          book: "Book",
          chapter: "Chapter",
          template: "Style Template",
          custom: "Extra instruction",
          customPlaceholder: "Optional. Add one-off style guidance for this chapter.",
          run: "Run Style Revision",
          running: "Revising...",
          openBook: "Open Book",
          chooseBook: "Select a book",
          chooseChapter: "Select a chapter",
          noChapters: "The selected book has no chapters yet.",
          success: "Style revision complete.",
          savedAt: "Copy saved at",
          failed: "Style revision failed",
          source: "Source",
          bookSource: "Book Chapter",
          fileSource: "Text File",
          file: "Text or Markdown file",
          chooseFile: "Select a .txt or .md file.",
          fileText: "File content",
          filePlaceholder: "Select a file or paste the text to revise.",
          runFile: "Revise File Style",
          download: "Download Revision",
          fileSuccess: "File style revision complete.",
          unsupportedFile: "Only text files (.txt, .md, .markdown) are supported.",
        }
      : {
          title: "文风修改",
          subtitle: "按所选文风模板修订已完成章节，同时保留剧情事实和结尾结果。",
          book: "书籍",
          chapter: "章节",
          template: "文风模板",
          custom: "补充要求",
          customPlaceholder: "可选。补充这次章节专用的文风要求。",
          run: "执行文风修改",
          running: "修改中...",
          openBook: "打开书籍",
          chooseBook: "选择书籍",
          chooseChapter: "选择章节",
          noChapters: "所选书籍还没有章节。",
          success: "文风修改完成。",
          savedAt: "副本保存位置",
          failed: "文风修改失败",
          source: "对象",
          bookSource: "书籍章节",
          fileSource: "文本文件",
          file: "文本或 Markdown 文件",
          chooseFile: "选择 .txt 或 .md 文件。",
          fileText: "文件内容",
          filePlaceholder: "选择文件，或粘贴要修改文风的文本。",
          runFile: "修改文件文风",
          download: "下载修改稿",
          fileSuccess: "文件文风修改完成。",
          unsupportedFile: "只支持文本文件（.txt、.md、.markdown）。",
        };
}

function isSupportedTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".txt")
    || name.endsWith(".md")
    || name.endsWith(".markdown")
    || file.type === "text/plain"
    || file.type === "text/markdown";
}

function revisedFileName(fileName: string): string {
  const fallback = "style-revision.md";
  const safe = fileName.trim() || fallback;
  const dot = safe.lastIndexOf(".");
  if (dot <= 0) return `${safe}-style-revision.md`;
  return `${safe.slice(0, dot)}-style-revision${safe.slice(dot)}`;
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = revisedFileName(fileName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function StyleRevisionManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang: uiLang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: styleTemplatesData } = useApi<{ templates: ReadonlyArray<StyleRevisionTemplate> }>("/style-templates");
  const books = booksData?.books ?? [];
  const [styleTemplateVersion, setStyleTemplateVersion] = useState(0);
  const styleTemplates = useMemo(
    () => getAllStyleRevisionTemplates(styleTemplatesData?.templates),
    [styleTemplateVersion, styleTemplatesData?.templates],
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>("book");
  const [bookId, setBookId] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [templateId, setTemplateId] = useState(styleTemplates[0]?.id ?? "");
  const [customInstruction, setCustomInstruction] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [revisedFileText, setRevisedFileText] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const { data: detail, refetch } = useApi<BookDetailResponse>(
    bookId ? `/books/${encodeURIComponent(bookId)}` : "",
  );
  const selectedBook = detail?.book ?? books.find((book) => book.id === bookId);
  const language = resolveLanguage(selectedBook?.language, uiLang);
  const copy = copyFor(language);
  const selectedTemplate = findStyleRevisionTemplate(templateId, styleTemplatesData?.templates) ?? styleTemplates[0];
  const chapters = detail?.chapters ?? [];
  const canRunBookRevision = Boolean(bookId && chapterNumber && selectedTemplate && !running);
  const canRunFileRevision = Boolean(fileText.trim() && selectedTemplate && !running);

  useEffect(() => {
    const onTemplatesChanged = () => setStyleTemplateVersion((version) => version + 1);
    window.addEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
    return () => window.removeEventListener(CUSTOM_STYLE_TEMPLATE_EVENT, onTemplatesChanged);
  }, []);

  useEffect(() => {
    if (!templateId && styleTemplates[0]) {
      setTemplateId(styleTemplates[0].id);
    }
    if (templateId && !styleTemplates.some((template) => template.id === templateId)) {
      setTemplateId(styleTemplates[0]?.id ?? "");
    }
  }, [styleTemplates, templateId]);

  useEffect(() => {
    if (!bookId && books[0]) {
      setBookId(books[0].id);
    }
  }, [bookId, books]);

  useEffect(() => {
    if (!chapterNumber && chapters[0]) {
      setChapterNumber(String(chapters[0].number));
    }
    if (chapterNumber && chapters.length > 0 && !chapters.some((chapter) => String(chapter.number) === chapterNumber)) {
      setChapterNumber(String(chapters[0]?.number ?? ""));
    }
  }, [chapterNumber, chapters]);

  const templateBrief = useMemo(() => {
    if (!selectedTemplate) return "";
    const base = buildStyleRevisionBrief(selectedTemplate, language);
    return customInstruction.trim()
      ? `${base}\n\n## ${copy.custom}\n${customInstruction.trim()}`
      : base;
  }, [copy.custom, customInstruction, language, selectedTemplate]);

  const runRevision = async () => {
    if (!canRunBookRevision || !selectedTemplate) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await fetchJson<RevisionResponse>(`/books/${encodeURIComponent(bookId)}/revise/${encodeURIComponent(chapterNumber)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", brief: templateBrief, saveAsCopy: true }),
      });
      setStatus({
        tone: "success",
        message: result.savedPath ? `${copy.success} ${copy.savedAt}: ${result.savedPath}` : copy.success,
      });
      refetch();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : copy.failed,
      });
    } finally {
      setRunning(false);
    }
  };

  const runFileRevision = async () => {
    if (!canRunFileRevision || !selectedTemplate) return;
    setRunning(true);
    setStatus(null);
    setRevisedFileText("");
    try {
      const result = await fetchJson<TextRevisionResponse>("/style-revision/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: fileText,
          brief: templateBrief,
          fileName: fileName || "input.md",
          language,
        }),
      });
      setFileName(result.fileName || fileName || "input.md");
      setRevisedFileText(result.revisedContent);
      setStatus({ tone: "success", message: copy.fileSuccess });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : copy.failed,
      });
    } finally {
      setRunning(false);
    }
  };

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setStatus(null);
    setRevisedFileText("");
    if (!isSupportedTextFile(file)) {
      setStatus({ tone: "error", message: copy.unsupportedFile });
      return;
    }
    setFileName(file.name);
    setFileText(await file.text());
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
            <Wand2 size={18} />
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
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.source}</span>
          <div className="inline-flex rounded-md border border-border bg-background/70 p-1">
            {([
              ["book", copy.bookSource],
              ["file", copy.fileSource],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setSourceMode(mode);
                  setStatus(null);
                }}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  sourceMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {sourceMode === "book" && (
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{copy.book}</span>
            <select
              value={bookId}
              onChange={(event) => {
                setBookId(event.target.value);
                setChapterNumber("");
                setStatus(null);
              }}
              className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
            >
              <option value="" disabled>{copy.chooseBook}</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>{book.title}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{copy.chapter}</span>
            <select
              value={chapterNumber}
              onChange={(event) => {
                setChapterNumber(event.target.value);
                setStatus(null);
              }}
              disabled={chapters.length === 0}
              className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background disabled:opacity-50`}
            >
              <option value="" disabled>{chapters.length === 0 ? copy.noChapters : copy.chooseChapter}</option>
              {chapters.map((chapter) => (
                <option key={chapter.number} value={chapter.number}>
                  {language === "ko" ? `${chapter.number}장` : language === "en" ? `Chapter ${chapter.number}` : `第${chapter.number}章`} · {chapter.title || "-"} · {chapter.wordCount}
                </option>
              ))}
            </select>
          </label>
          </div>
        )}

        {sourceMode === "file" && (
          <div className="space-y-4">
            <label className="space-y-2 block">
              <span className="text-xs font-medium text-muted-foreground">{copy.file}</span>
              <div className={`w-full ${c.input} rounded-md px-3 py-3 bg-background`}>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  onChange={(event) => void onFileSelected(event.target.files?.[0])}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
                />
                <p className="mt-2 text-xs text-muted-foreground">{fileName || copy.chooseFile}</p>
              </div>
            </label>

            <label className="space-y-2 block">
              <span className="text-xs font-medium text-muted-foreground">{copy.fileText}</span>
              <textarea
                value={fileText}
                onChange={(event) => {
                  setFileText(event.target.value);
                  setRevisedFileText("");
                  setStatus(null);
                }}
                rows={12}
                className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y font-mono`}
                placeholder={copy.filePlaceholder}
              />
            </label>
          </div>
        )}

        <label className="space-y-2 block">
          <span className="text-xs font-medium text-muted-foreground">{copy.template}</span>
          <select
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setStatus(null);
            }}
            className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
          >
            {styleTemplates.map((template) => (
              <option key={template.id} value={template.id}>{template.label[language]}</option>
            ))}
          </select>
        </label>

        {selectedTemplate && (
          <div className="rounded-md border border-border/60 bg-background/60 p-4 space-y-3">
            <div>
              <div className="font-medium text-sm">{selectedTemplate.label[language]}</div>
              <p className="text-xs text-muted-foreground leading-6">{selectedTemplate.description[language]}</p>
            </div>
            <ul className="space-y-2 text-sm leading-6">
              {selectedTemplate.rules[language].map((rule) => (
                <li key={rule} className="flex gap-2">
                  <span className="text-primary">-</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="space-y-2 block">
          <span className="text-xs font-medium text-muted-foreground">{copy.custom}</span>
          <textarea
            value={customInstruction}
            onChange={(event) => setCustomInstruction(event.target.value)}
            rows={4}
            className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
            placeholder={copy.customPlaceholder}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {sourceMode === "book" ? (
            <button
              type="button"
              onClick={() => void runRevision()}
              disabled={!canRunBookRevision}
              className={`inline-flex items-center gap-2 px-4 py-2.5 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
            >
              <Wand2 size={15} />
              {running ? copy.running : copy.run}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runFileRevision()}
              disabled={!canRunFileRevision}
              className={`inline-flex items-center gap-2 px-4 py-2.5 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
            >
              <Upload size={15} />
              {running ? copy.running : copy.runFile}
            </button>
          )}
          {sourceMode === "book" && bookId && (
            <button
              type="button"
              onClick={() => nav.toBook(bookId)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 font-medium text-sm"
            >
              {copy.openBook}
            </button>
          )}
          {sourceMode === "file" && revisedFileText && (
            <button
              type="button"
              onClick={() => downloadTextFile(fileName || "input.md", revisedFileText)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 font-medium text-sm"
            >
              <Download size={15} />
              {copy.download}
            </button>
          )}
        </div>
      </section>

      {sourceMode === "file" && revisedFileText && (
        <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <h2 className="text-lg font-serif">{copy.download}</h2>
          </div>
          <textarea
            value={revisedFileText}
            onChange={(event) => setRevisedFileText(event.target.value)}
            rows={14}
            className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y font-mono`}
          />
        </section>
      )}
    </div>
  );
}
