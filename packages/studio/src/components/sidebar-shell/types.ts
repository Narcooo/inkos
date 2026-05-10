import type { ReactNode } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import type { SessionRuntime } from "../../store/chat/types";

export interface SidebarBookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

export interface SidebarNav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
}

export interface SidebarProps {
  nav: SidebarNav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}

export interface SidebarItemSpec {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly badge?: string;
  readonly badgeColor?: string;
}

export type SidebarSession = SessionRuntime;

export interface RenameTarget {
  readonly sessionId: string;
  readonly currentTitle: string;
}

export interface DeleteTarget {
  readonly sessionId: string;
  readonly title: string;
}
