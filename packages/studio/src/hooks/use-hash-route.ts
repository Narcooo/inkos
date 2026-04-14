import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "services" }
  | { page: "service-detail"; serviceId: string }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "config" || path === "services") return { page: "services" };
  if (path === "book/new") return { page: "book-create" };

  const serviceMatch = path.match(/^services\/([^/]+)$/);
  if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };

  const bookMatch = path.match(/^book\/([^/]+)$/);
  if (bookMatch) return { page: "book", bookId: decodeURIComponent(bookMatch[1]) };

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "book": return `#/book/${encodeURIComponent(route.bookId)}`;
    case "book-create": return "#/book/new";
    case "services": return "#/services";
    case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
    default: return "";
  }
}

export { parseHash, routeToHash }; // for testing

const HASH_PAGES = new Set(["dashboard", "book", "book-create", "services", "service-detail"]);

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    if (HASH_PAGES.has(newRoute.page)) {
      const hash = routeToHash(newRoute);
      if (hash) {
        window.location.hash = hash;
        return;
      }
    }
    setRouteState(newRoute);
  }, []);

  const nav = {
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
  };

  return { route, setRoute, nav };
}
