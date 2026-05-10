import { lazy, Suspense, useState, useEffect } from "react";
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
import { Sidebar } from "./components/Sidebar";
import { LanguageSelector } from "./pages/LanguageSelector";
import { useSSE } from "./hooks/use-sse";
import { useSessionEvents } from "./hooks/use-session-events";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { postApi, putApi, useApi } from "./hooks/use-api";
import { Sun, Moon } from "lucide-react";
import { House } from "lucide-react";

const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const BookCreate = lazy(() => import("./pages/BookCreate").then((module) => ({ default: module.BookCreate })));
const BookDetail = lazy(() => import("./pages/BookDetail").then((module) => ({ default: module.BookDetail })));
const ChapterReader = lazy(() => import("./pages/ChapterReader").then((module) => ({ default: module.ChapterReader })));
const Analytics = lazy(() => import("./pages/Analytics").then((module) => ({ default: module.Analytics })));
const ServiceListPage = lazy(() => import("./pages/ServiceListPage").then((module) => ({ default: module.ServiceListPage })));
const ServiceDetailPage = lazy(() => import("./pages/ServiceDetailPage").then((module) => ({ default: module.ServiceDetailPage })));
const TruthFiles = lazy(() => import("./pages/TruthFiles").then((module) => ({ default: module.TruthFiles })));
const DaemonControl = lazy(() => import("./pages/DaemonControl").then((module) => ({ default: module.DaemonControl })));
const LogViewer = lazy(() => import("./pages/LogViewer").then((module) => ({ default: module.LogViewer })));
const GenreManager = lazy(() => import("./pages/GenreManager").then((module) => ({ default: module.GenreManager })));
const StyleManager = lazy(() => import("./pages/StyleManager").then((module) => ({ default: module.StyleManager })));
const ImportManager = lazy(() => import("./pages/ImportManager").then((module) => ({ default: module.ImportManager })));
const RadarView = lazy(() => import("./pages/RadarView").then((module) => ({ default: module.RadarView })));
const DoctorView = lazy(() => import("./pages/DoctorView").then((module) => ({ default: module.DoctorView })));
const BookSidebar = lazy(() => import("./components/chat/BookSidebar").then((module) => ({ default: module.BookSidebar })));
const BookSidebarToggle = lazy(() => import("./components/chat/BookSidebar").then((module) => ({ default: module.BookSidebarToggle })));

export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActiveBookId(route: HashRoute): string | undefined {
  if ("bookId" in route) return route.bookId;
  return undefined;
}

export function isStandaloneBookCreateRoute(route: HashRoute): boolean {
  return route.page === "book-create";
}

function RouteLoading() {
  return (
    <div className="grid min-h-full place-items-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
    </div>
  );
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

  useSessionEvents(sse, route, setRoute);

  const nav = {
    toDashboard: () => setRoute({ page: "dashboard" }),
    toBook: (bookId: string) => setRoute({ page: "book", bookId }),
    toBookSettings: (bookId: string) => setRoute({ page: "book-settings", bookId }),
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
    <div className="h-screen ios-app-shell text-foreground flex overflow-hidden font-sans p-2 gap-2 lg:p-3 lg:gap-3">
      {/* Left Sidebar */}
      <Sidebar nav={nav} activePage={activePage} sse={sse} t={t} />

      {/* Center Content */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 ios-glass rounded-[28px] overflow-hidden">
        {/* Header Strip */}
        <header className="h-16 shrink-0 flex items-center justify-between px-3 border-b border-border/35 lg:px-5">
          <div className="flex items-center gap-2">
             <button
               onClick={nav.toDashboard}
               className="ios-pill inline-flex items-center gap-2 whitespace-nowrap px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-card/80 transition-colors"
             >
               <House size={14} />
               <span className="hidden sm:inline">首页</span>
               <span className="hidden text-muted-foreground/60 sm:inline">/</span>
               <span>InkOS</span>
             </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="ios-pill flex gap-0.5 p-1">
              <button
                onClick={async () => {
                  await putApi("/project", { language: "zh" });
                  refetchProject();
                }}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${currentLang === "zh" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                中
              </button>
              <button
                onClick={async () => {
                  await putApi("/project", { language: "en" });
                  refetchProject();
                }}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${currentLang === "en" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                EN
              </button>
            </div>

            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="ios-pill inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-y-auto scroll-smooth">
          <Suspense fallback={<RouteLoading />}>
          {route.page === "dashboard" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <Dashboard nav={nav} sse={sse} theme={theme} t={t} />
            </div>
          )}
          {isStandaloneBookCreateRoute(route) && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <BookCreate nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "book" && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                activeBookId={route.bookId}
                nav={nav}
                theme={theme}
                t={t}
                sse={sse}
              />
              <BookSidebar bookId={route.bookId} theme={theme} t={t} sse={sse} />
              <BookSidebarToggle bookId={route.bookId} theme={theme} t={t} sse={sse} />
            </div>
          )}
          {route.page === "book-settings" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} sse={sse} />
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
            <div className="min-h-full px-3 py-3 md:px-4 md:py-4 fade-in">
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
          </Suspense>
        </main>
      </div>
    </div>
  );
}
