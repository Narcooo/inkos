import { useState, useEffect, lazy, Suspense } from "react";
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { ChatPage } from "./pages/ChatPage";
import { BookDetail } from "./pages/BookDetail";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ServiceListPage } from "./pages/ServiceListPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
import { ProjectSettings } from "./pages/ProjectSettings";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { GenreManager } from "./pages/GenreManager";
import { StyleManager } from "./pages/StyleManager";
import { ConsistencyPanel } from "./pages/ConsistencyPanel";
import { ImportManager } from "./pages/ImportManager";
import { RadarView } from "./pages/RadarView";
import { DoctorView } from "./pages/DoctorView";
import { RelationGraphPanel } from "./pages/RelationGraphPanel";
import { TimelinePage } from "./pages/TimelinePage";
import { AgentHubPage } from "./pages/AgentHubPage";
import { SkillListPage } from "./pages/SkillListPage";
import { ForeshadowingPage } from "./pages/ForeshadowingPage";
import { WorldListPage } from "./pages/WorldListPage";
import { WorldDetailPage } from "./pages/WorldDetailPage";
import { WorldGeoVizPanel } from "./pages/WorldGeoVizPanel";
import { WorldInheritancePage } from "./pages/WorldInheritancePage";
import { WorldMapPage } from "./pages/WorldMapPage";
import { PublishPage } from "./pages/PublishPage";
import { EditDashboard } from "./pages/EditDashboard";
import { ConsistencyCheck } from "./pages/ConsistencyCheck";
import { StoryPlayer } from "./pages/StoryPlayer";
const ChapterWizard = lazy(() => import("./pages/ChapterWizard"));
import { StoryGraphTree } from "./pages/StoryGraphTree";
import { BookStylePage } from "./pages/BookStylePage";
const FlowView = lazy(() => import("./pages/FlowView"));
const FilmWizard = lazy(() => import("./pages/FilmWizard"));
import { LanguageSelector } from "./pages/LanguageSelector";
import { AchievementSystem } from "./components/AchievementSystem";
import { ArchivePage } from "./pages/ArchivePage";
import { VolumeManagement } from "./pages/VolumeManagement";
import { CharacterTiering } from "./pages/CharacterTiering";
import { BookSidebar, BookSidebarToggle } from "./components/chat/BookSidebar";
import { useSSE } from "./hooks/use-sse";
import { useSessionEvents } from "./hooks/use-session-events";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { postApi, putApi, useApi } from "./hooks/use-api";
import { Sun, Moon } from "lucide-react";
import { House } from "lucide-react";

export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActiveBookId(route: HashRoute): string | undefined {
  if ("bookId" in route) return route.bookId;
  return undefined;
}

export function isBookCreateChatRoute(route: HashRoute): boolean {
  return route.page === "book-create";
}

export function deriveStartupGate(input: {
  readonly ready: boolean;
  readonly projectError: string | null;
}): "ready" | "loading" | "error" {
  if (input.ready) return "ready";
  return input.projectError ? "error" : "loading";
}

export function App() {
  const { route, setRoute } = useHashRoute();
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t, lang: currentLang } = useI18n();
  const { data: project, error: projectError, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>("/project");
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
    toChat: () => setRoute({ page: "chat" }),
    toBook: (bookId: string) => setRoute({ page: "book", bookId }),
    toBookSettings: (bookId: string) => setRoute({ page: "book-settings", bookId }),
    toBookCreate: () => setRoute({ page: "book-create" }),
    toChapter: (bookId: string, chapterNumber: number) =>
      setRoute({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => setRoute({ page: "analytics", bookId }),
    toServices: () => setRoute({ page: "services" }),
    toProjectSettings: () => setRoute({ page: "project-settings" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
    toTruth: (bookId: string) => setRoute({ page: "truth", bookId }),
    toDaemon: () => setRoute({ page: "daemon" }),
    toLogs: () => setRoute({ page: "logs" }),
    toGenres: () => setRoute({ page: "genres" }),
    toStyle: () => setRoute({ page: "style" }),
    toStyleConsistency: () => setRoute({ page: "style-consistency" }),
    toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => setRoute({ page: "import", ...(tab ? { tab } : {}) }),
    toRadar: () => setRoute({ page: "radar" }),
    toDoctor: () => setRoute({ page: "doctor" }),
    toRelations: (bookId: string) => setRoute({ page: "relations", bookId }),
    toTimeline: (bookId: string) => setRoute({ page: "timeline", bookId }),
    toPlay: (projectId: string) => setRoute({ page: "play", projectId }),
    toFilm: (projectId: string) => setRoute({ page: "film", projectId }),
    toFlow: (projectId: string) => setRoute({ page: "flow", projectId }),
    toFilmAuthor: (projectId: string) => setRoute({ page: "film-author", projectId }),
    toFilmStudio: (projectId: string) => setRoute({ page: "film-studio", projectId }),
    toAgents: () => setRoute({ page: "agents" }),
    toAgentPipeline: () => setRoute({ page: "agents" }),
    toArchive: () => setRoute({ page: "archive" }),
    toSkills: () => setRoute({ page: "skills" }),
    toForeshadowing: (bookId: string) => setRoute({ page: "foreshadowing", bookId }),
    toWorlds: () => setRoute({ page: "worlds" }),
    toWorldDetail: (worldId: string) => setRoute({ page: "world-detail", worldId }),
    toWorldGeoViz: (worldId: string) => setRoute({ page: "world-geoviz", worldId }),
    toWorldMap: (worldId: string) => setRoute({ page: "world-map", worldId }),
    toWorldInheritance: (worldId: string) => setRoute({ page: "world-inheritance", worldId }),
    toWorldCreate: (bookId?: string) => setRoute({ page: "world-create", ...(bookId ? { bookId } : {}) }),
    toBookWorlds: (bookId: string) => setRoute({ page: "book-worlds", bookId }),
    toConsistency: (bookId: string) => setRoute({ page: "consistency", bookId }),
    toPublish: (bookId: string) => setRoute({ page: "publish", bookId }),
    toEditDashboard: (bookId: string) => setRoute({ page: "edit-dashboard", bookId }),
    toChapterWizard: (bookId: string) => setRoute({ page: "chapter-wizard", bookId }),
    toVolumeManagement: (bookId: string) => setRoute({ page: "volume-management", bookId }),
    toCharacterTiering: (bookId: string) => setRoute({ page: "character-tiering", bookId }),
    toBookStyle: (bookId: string) => setRoute({ page: "book-style", bookId }),
  };

  const activeBookId = deriveActiveBookId(route);
  const activePage =
    activeBookId
      ? `book:${activeBookId}`
      : route.page === "service-detail"
        ? "services"
        : route.page;

  const startupGate = deriveStartupGate({ ready, projectError });

  if (startupGate === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-destructive/5 p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-destructive">无法加载项目配置 / Failed to load project config</h1>
            <p className="mt-2 text-sm text-muted-foreground break-all">{projectError}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            请检查项目根目录下的 inkos.json 是否存在且为合法 JSON，然后重试。
          </p>
          <button
            type="button"
            onClick={() => refetchProject()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            重试 / Retry
          </button>
        </div>
      </div>
    );
  }

  if (startupGate === "loading") {
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
             <button
               onClick={nav.toDashboard}
               className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3.5 py-2 text-[17px] font-semibold text-foreground hover:bg-secondary/50 transition-colors"
             >
               <House size={18} />
               <span>首页</span>
               <span className="text-muted-foreground/70">/</span>
               <span className="font-serif">InkOS Studio</span>
             </button>
          </div>

          <div className="flex items-center gap-2">
            <AchievementSystem
              totalChapters={0}
              totalWords={0}
              sessionCount={0}
              consecutiveApproved={0}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={async () => {
                  await putApi("/project", { language: "zh" });
                  refetchProject();
                }}
                className={`px-2.5 py-1 text-[16px] font-medium rounded-md ${currentLang === "zh" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                中
              </button>
              <button
                onClick={async () => {
                  await putApi("/project", { language: "en" });
                  refetchProject();
                }}
                className={`px-2.5 py-1 text-[16px] font-medium rounded-md ${currentLang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                EN
              </button>
            </div>

            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
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
          {isBookCreateChatRoute(route) && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                mode="book-create"
                nav={nav}
                theme={theme}
                t={t}
                sse={sse}
              />
            </div>
          )}
          {route.page === "chat" && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                mode="project-chat"
                nav={nav}
                theme={theme}
                t={t}
                sse={sse}
              />
            </div>
          )}
          {route.page === "book" && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                activeBookId={route.bookId}
                mode="book"
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
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ServiceListPage nav={nav} />
            </div>
          )}
          {route.page === "project-settings" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ProjectSettings nav={nav} theme={theme} t={t} />
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
          {route.page === "style-consistency" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ConsistencyPanel nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "import" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ImportManager nav={nav} theme={theme} t={t} initialTab={route.tab} />
            </div>
          )}
          {route.page === "radar" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <RadarView nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "relations" && (
            <RelationGraphPanel bookId={route.bookId} />
          )}
          {route.page === "timeline" && (
            <TimelinePage bookId={route.bookId} />
          )}
          {route.page === "doctor" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <DoctorView nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "play" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <StoryPlayer projectId={route.projectId} nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "film" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <StoryGraphTree projectId={route.projectId} nav={nav} theme={theme} t={t} />
            </div>
          )}
          {route.page === "film-author" && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                activeBookId={route.projectId}
                mode="interactive-film-authoring"
                nav={nav}
                theme={theme}
                t={t}
                sse={sse}
              />
            </div>
          )}
          {route.page === "film-studio" && (
            <Suspense fallback={<div className="p-6 text-sm">加载创作向导…</div>}>
              <FilmWizard projectId={route.projectId} nav={nav} theme={theme} t={t} sse={sse} />
            </Suspense>
          )}
          {route.page === "flow" && (
            <Suspense fallback={<div className="p-6 text-sm">加载流程图…</div>}>
              <FlowView projectId={route.projectId} nav={nav} theme={theme} t={t} />
            </Suspense>
          )}
          {route.page === "agents" && (
            <div className="max-w-5xl mx-auto w-full px-6 py-12 md:px-12 lg:py-16 fade-in">
              <AgentHubPage nav={nav} />
            </div>
          )}
          {route.page === "archive" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ArchivePage />
            </div>
          )}
          {route.page === "skills" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <SkillListPage />
            </div>
          )}
          {route.page === "foreshadowing" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ForeshadowingPage bookId={route.bookId} />
            </div>
          )}
          {(route.page === "worlds" || route.page === "book-worlds") && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <WorldListPage nav={nav} bookId={route.page === "book-worlds" ? route.bookId : undefined} />
            </div>
          )}
          {(route.page === "world-detail" || route.page === "world-create") && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <WorldDetailPage
                worldId={route.page === "world-detail" ? route.worldId : undefined}
                nav={nav}
                bookId={route.page === "world-create" && "bookId" in route ? (route as { bookId?: string }).bookId : undefined}
              />
            </div>
          )}
          {route.page === "world-geoviz" && (
            <div className="w-full h-full fade-in">
              <WorldGeoVizPanel worldId={route.worldId} nav={nav} />
            </div>
          )}
          {route.page === "world-map" && (
            <div className="w-full h-full fade-in">
              <WorldMapPage worldId={route.worldId} nav={nav} />
            </div>
          )}
          {route.page === "world-inheritance" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <WorldInheritancePage worldId={route.worldId} />
            </div>
          )}
          {route.page === "publish" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <PublishPage bookId={route.bookId} nav={nav} />
            </div>
          )}
          {route.page === "edit-dashboard" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <EditDashboard bookId={route.bookId} nav={nav} />
            </div>
          )}
          {route.page === "chapter-wizard" && (
            <Suspense fallback={<div className="p-6 text-sm">加载章节生成管道…</div>}>
              <ChapterWizard bookId={route.bookId} nav={nav} theme={theme} t={t} />
            </Suspense>
          )}
          {route.page === "consistency" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ConsistencyCheck bookId={route.bookId} nav={nav} />
            </div>
          )}
          {route.page === "volume-management" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <VolumeManagement bookId={route.bookId} nav={nav} />
            </div>
          )}
          {route.page === "character-tiering" && (
            <CharacterTiering bookId={route.bookId} />
          )}
          {route.page === "book-style" && (
            <div className="max-w-5xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <BookStylePage bookId={route.bookId} nav={nav} theme={theme} t={t} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
