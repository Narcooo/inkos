import { useState, useEffect } from "react";
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { ChatPage } from "./pages/ChatPage";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ServiceListPage } from "./pages/ServiceListPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { GenreManager } from "./pages/GenreManager";
import { StyleManager } from "./pages/StyleManager";
import { ImportManager } from "./pages/ImportManager";
import { RadarView } from "./pages/RadarView";
import { DoctorView } from "./pages/DoctorView";
import { LanguageSelector } from "./pages/LanguageSelector";
import { BookSidebar, BookSidebarToggle } from "./components/chat/BookSidebar";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { postApi, putApi, useApi } from "./hooks/use-api";
import { Sun, Moon } from "lucide-react";

export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActiveBookId(route: HashRoute): string | undefined {
  if ("bookId" in route) return route.bookId;
  return undefined;
}

export function App() {
  const { route, setRoute } = useHashRoute();
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t, lang: currentLang } = useI18n();
  const { data: project, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>("/project");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(false);

  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
    }
  }, [project]);

  const nav = {
    toDashboard: () => setRoute({ page: "dashboard" }),
    toBook: (bookId: string) => setRoute({ page: "book", bookId }),
    toBookCreate: () => setRoute({ page: "book-create" }),
    toChapter: (bookId: string, chapterNumber: number) =>
      setRoute({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => setRoute({ page: "analytics", bookId }),
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
    toTruth: (bookId: string) => setRoute({ page: "truth", bookId }),
    toDaemon: () => setRoute({ page: "daemon" }),
    toLogs: () => setRoute({ page: "logs" }),
    toGenres: () => setRoute({ page: "genres" }),
    toStyle: () => setRoute({ page: "style" }),
    toImport: () => setRoute({ page: "import" }),
    toRadar: () => setRoute({ page: "radar" }),
    toDoctor: () => setRoute({ page: "doctor" }),
  };

  const activeBookId = deriveActiveBookId(route);
  const activePage =
    activeBookId
      ? `book:${activeBookId}`
      : route.page === "service-detail"
        ? "services"
        : route.page;

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (lang) => {
          await postApi("/project/language", { language: lang });
          setShowLanguageSelector(false);
          refetchProject();
        }}
      />
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Left Sidebar */}
      <Sidebar nav={nav} activePage={activePage} sse={sse} t={t} />

      {/* Center Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/30 backdrop-blur-sm">
        {/* Header Strip */}
        <header className="h-14 shrink-0 flex items-center justify-between px-8 border-b border-border/40">
          <div className="flex items-center gap-2">
             <button onClick={nav.toDashboard} className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold hover:text-foreground transition-colors">
               InkOS Studio
             </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
              <button
                onClick={async () => {
                  await putApi("/project", { language: "zh" });
                  refetchProject();
                }}
                className={`text-xs px-2 py-0.5 rounded ${currentLang === "zh" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                中
              </button>
              <button
                onClick={async () => {
                  await putApi("/project", { language: "en" });
                  refetchProject();
                }}
                className={`text-xs px-2 py-0.5 rounded ${currentLang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                EN
              </button>
            </div>

            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-y-auto scroll-smooth">
          {route.page === "dashboard" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <Dashboard nav={nav} sse={sse} theme={theme} t={t} />
            </div>
          )}
          {(route.page === "book" || route.page === "book-create") && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                activeBookId={route.page === "book" ? route.bookId : undefined}
                nav={nav}
                theme={theme}
                t={t}
                sse={sse}
              />
              {route.page === "book" && (
                <>
                  <BookSidebar bookId={route.bookId} theme={theme} t={t} sse={sse} />
                  <BookSidebarToggle bookId={route.bookId} theme={theme} t={t} sse={sse} />
                </>
              )}
            </div>
          )}
          {route.page === "chapter" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "analytics" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "services" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ServiceListPage nav={nav} />
            </div>
          )}
          {route.page === "service-detail" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ServiceDetailPage serviceId={route.serviceId} nav={nav} />
            </div>
          )}
          {route.page === "truth" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "daemon" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />
            </div>
          )}
          {route.page === "logs" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <LogViewer nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "genres" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <GenreManager nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "style" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <StyleManager nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "import" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ImportManager nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "radar" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <RadarView nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "doctor" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <DoctorView nav={nav} theme={theme} t={t} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
