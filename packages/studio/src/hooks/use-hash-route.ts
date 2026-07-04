import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "chat" }
  | { page: "book"; bookId: string }
  | { page: "book-settings"; bookId: string }
  | { page: "book-create" }
  | { page: "services" }
  | { page: "project-settings" }
  | { page: "service-detail"; serviceId: string }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "style-consistency" }
  | { page: "import"; tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation" }
  | { page: "radar" }
  | { page: "doctor" }
  | { page: "play"; projectId: string }
  | { page: "film"; projectId: string }
  | { page: "flow"; projectId: string }
  | { page: "film-author"; projectId: string }
  | { page: "film-studio"; projectId: string }
  | { page: "relations"; bookId: string }
  | { page: "timeline"; bookId: string }
  | { page: "agents" }
  | { page: "archive" }
  | { page: "skills" }
  | { page: "foreshadowing"; bookId: string }
  | { page: "worlds" }
  | { page: "world-detail"; worldId: string }
  | { page: "world-create"; bookId?: string }
  | { page: "world-geoviz"; worldId: string }
  | { page: "world-map"; worldId: string }
  | { page: "publish"; bookId: string }
  | { page: "edit-dashboard"; bookId: string }
  | { page: "book-worlds"; bookId: string }
  | { page: "world-inheritance"; worldId: string }
  | { page: "chapter-wizard"; bookId: string }
  | { page: "consistency"; bookId: string }
  | { page: "volume-management"; bookId: string }
  | { page: "character-tiering"; bookId: string }
  | { page: "book-style"; bookId: string };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "chat") return { page: "chat" };
  if (path === "config" || path === "services") return { page: "services" };
  if (path === "settings") return { page: "project-settings" };
  if (path === "import") return { page: "import" };
  if (path === "agents") return { page: "agents" };
  if (path === "style-consistency") return { page: "style-consistency" };
  if (path === "archive") return { page: "archive" };
  if (path === "skills") return { page: "skills" };
  const foreshadowingMatch = path.match(/^foreshadowing\/([^\/]+)$/);
  if (foreshadowingMatch) return { page: "foreshadowing", bookId: decodeURIComponent(foreshadowingMatch[1]) };
  if (path === "worlds" || path === "worlds/new") return path === "worlds/new" ? { page: "world-create" } : { page: "worlds" };
  const worldsNewBookMatch = path.match(/^worlds\/new\/(.+)$/);
  if (worldsNewBookMatch) return { page: "world-create", bookId: decodeURIComponent(worldsNewBookMatch[1]) };
  const importMatch = path.match(/^import\/(chapters|canon|fanfic|spinoff|imitation)$/);
  if (importMatch) return { page: "import", tab: importMatch[1] as "chapters" | "canon" | "fanfic" | "spinoff" | "imitation" };
  if (path === "book/new") return { page: "book-create" };

  const serviceMatch = path.match(/^services\/([^/]+)$/);
  if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };

  const bookSettingsMatch = path.match(/^book\/([^/]+)\/settings$/);
  if (bookSettingsMatch) return { page: "book-settings", bookId: decodeURIComponent(bookSettingsMatch[1]) };

  const bookMatch = path.match(/^book\/([^/]+)$/);
  if (bookMatch) return { page: "book", bookId: decodeURIComponent(bookMatch[1]) };

  const playMatch = path.match(/^play\/([^/]+)$/);
  if (playMatch) return { page: "play", projectId: decodeURIComponent(playMatch[1]) };

  const filmMatch = path.match(/^film\/([^/]+)$/);
  if (filmMatch) return { page: "film", projectId: decodeURIComponent(filmMatch[1]) };

  const flowMatch = path.match(/^flow\/([^/]+)$/);
  if (flowMatch) return { page: "flow", projectId: decodeURIComponent(flowMatch[1]) };

  const filmAuthorMatch = path.match(/^film-author\/([^/]+)$/);
  if (filmAuthorMatch) return { page: "film-author", projectId: decodeURIComponent(filmAuthorMatch[1]) };

  const studioFilmMatch = path.match(/^studio\/film\/([^/]+)$/);
  if (studioFilmMatch) return { page: "film-studio", projectId: decodeURIComponent(studioFilmMatch[1]) };

  const relationsMatch = path.match(/^relations\/([^/]+)$/);
  if (relationsMatch) return { page: "relations", bookId: decodeURIComponent(relationsMatch[1]) };

  const timelineMatch = path.match(/^timeline\/([^/]+)$/);
  if (timelineMatch) return { page: "timeline", bookId: decodeURIComponent(timelineMatch[1]) };

  const worldInheritMatch = path.match(/^worlds\/([^/]+)\/inherit$/);
  if (worldInheritMatch) return { page: "world-inheritance", worldId: decodeURIComponent(worldInheritMatch[1]) };
  const worldMapMatch = path.match(/^worlds\/([^/]+)\/map$/);
  if (worldMapMatch) return { page: "world-map", worldId: decodeURIComponent(worldMapMatch[1]) };

  const worldGeoVizMatch = path.match(/^worlds\/([^/]+)\/geoviz$/);
  if (worldGeoVizMatch) return { page: "world-geoviz", worldId: decodeURIComponent(worldGeoVizMatch[1]) };

  const worldDetailMatch = path.match(/^worlds\/([^/]+)$/);
  if (worldDetailMatch) return { page: "world-detail", worldId: decodeURIComponent(worldDetailMatch[1]) };

  const publishMatch = path.match(/^publish\/([^/]+)$/);
  if (publishMatch) return { page: "publish", bookId: decodeURIComponent(publishMatch[1]) };

  const editDashboardMatch = path.match(/^edit-dashboard\/([^/]+)$/);
  if (editDashboardMatch) return { page: "edit-dashboard", bookId: decodeURIComponent(editDashboardMatch[1]) };

  const chapterWizardMatch = path.match(/^chapter-wizard\/([^\/]+)$/);
  if (chapterWizardMatch) return { page: "chapter-wizard", bookId: decodeURIComponent(chapterWizardMatch[1]) };

  const consistencyMatch = path.match(/^consistency\/([^\/]+)$/);
  if (consistencyMatch) return { page: "consistency", bookId: decodeURIComponent(consistencyMatch[1]) };

  const volMgmtMatch = path.match(/^book\/([^\/]+)\/volumes$/);
  if (volMgmtMatch) return { page: "volume-management", bookId: decodeURIComponent(volMgmtMatch[1]) };

  const charTierMatch = path.match(/^characters\/([^\/]+)\/tiers$/);
  if (charTierMatch) return { page: "character-tiering", bookId: decodeURIComponent(charTierMatch[1]) };

  const bookStyleMatch = path.match(/^book\/([^\/]+)\/style$/);
  if (bookStyleMatch) return { page: "book-style", bookId: decodeURIComponent(bookStyleMatch[1]) };

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "chat": return "#/chat";
    case "book": return `#/book/${encodeURIComponent(route.bookId)}`;
    case "book-settings": return `#/book/${encodeURIComponent(route.bookId)}/settings`;
    case "book-create": return "#/book/new";
    case "services": return "#/services";
    case "project-settings": return "#/settings";
    case "import": return route.tab ? `#/import/${route.tab}` : "#/import";
    case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
    case "play": return `#/play/${encodeURIComponent(route.projectId)}`;
    case "film": return `#/film/${encodeURIComponent(route.projectId)}`;
    case "flow": return `#/flow/${encodeURIComponent(route.projectId)}`;
    case "film-author": return `#/film-author/${encodeURIComponent(route.projectId)}`;
    case "film-studio": return `#/studio/film/${encodeURIComponent(route.projectId)}`;
    case "relations": return `#/relations/${encodeURIComponent(route.bookId)}`;
    case "timeline": return `#/timeline/${encodeURIComponent(route.bookId)}`;
    case "agents": return "#/agents";
    case "archive": return "#/archive";
    case "skills": return "#/skills";
    case "foreshadowing": return `#/foreshadowing/${encodeURIComponent(route.bookId)}`;
    case "worlds": return "#/worlds";
    case "world-create": return route.bookId ? `#/worlds/new/${encodeURIComponent(route.bookId)}` : "#/worlds/new";
    case "world-detail": return `#/worlds/${encodeURIComponent(route.worldId)}`;
    case "world-geoviz": return `#/worlds/${encodeURIComponent(route.worldId)}/geoviz`;
    case "world-map": return `#/worlds/${encodeURIComponent(route.worldId)}/map`;
    case "world-inheritance": return `#/worlds/${encodeURIComponent(route.worldId)}/inherit`;
    case "world-map": return `#/worlds/${encodeURIComponent(route.worldId)}/map`;
    case "publish": return `#/publish/${encodeURIComponent(route.bookId)}`;
    case "edit-dashboard": return `#/edit-dashboard/${encodeURIComponent(route.bookId)}`;
    case "style-consistency": return "#/style-consistency";
    case "chapter-wizard": return `#/chapter-wizard/${encodeURIComponent(route.bookId)}`;
    case "consistency": return `#/consistency/${encodeURIComponent(route.bookId)}`;
    case "volume-management": return `#/book/${encodeURIComponent(route.bookId)}/volumes`;
    case "character-tiering": return `#/characters/${encodeURIComponent(route.bookId)}/tiers`;
    case "book-style": return `#/book/${encodeURIComponent(route.bookId)}/style`;
    default: return "";
  }
}

export { parseHash, routeToHash }; // for testing

const HASH_PAGES = new Set(["dashboard", "chat", "book", "book-settings", "book-create", "services", "project-settings", "service-detail", "style", "style-consistency", "import", "play", "film", "flow", "film-author", "film-studio", "relations", "timeline", "agents", "archive", "skills", "foreshadowing", "foreshadowing/*", "worlds", "world-detail", "world-create", "world-geoviz", "world-map", "world-inheritance", "publish", "edit-dashboard", "chapter-wizard", "consistency", "volume-management", "character-tiering", "book-style"]);

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    // 先同步 React state：无论目标页面是否写 URL，保证页面立刻切换。
    // 之前只在非 hash 页面才 setRouteState，hash 页面完全靠 hashchange 事件回调触发。
    // 但当 URL 没有实际变化时（比如从 services → logs → services，中间的 logs
    // 不写 URL，URL 一直停在 #/services），再次赋值同一个 hash 不会触发 hashchange，
    // React state 就永远停留在 logs，表现为"点不动"。
    setRouteState(newRoute);
    if (HASH_PAGES.has(newRoute.page)) {
      const hash = routeToHash(newRoute);
      if (hash && window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }
  }, []);

  const nav = {
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
  };

  return { route, setRoute, nav };
}
