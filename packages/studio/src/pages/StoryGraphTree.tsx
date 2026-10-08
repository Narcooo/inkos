import { useState } from "react";
import { useApi, fetchJson, buildApiUrl } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { tr } from "../lib/app-language";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { StoryGraph, StoryNode } from "@actalk/inkos-core/interactive-film/graph-schema";
import { AnalysisPanel } from "../components/film/AnalysisPanel";

interface Nav {
  toDashboard: () => void;
  toPlay: (id: string) => void;
  toFlow: (id: string) => void;
  toFilmAuthor: (id: string) => void;
}

export function buildProjectExportDownloadUrl(projectId: string): string | null {
  return buildApiUrl(`/projects/${encodeURIComponent(projectId)}/export`);
}

export function StoryGraphTree({
  projectId,
  nav,
  theme,
  t,
  embedded = false,
}: {
  projectId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  embedded?: boolean;
}) {
  const c = useColors(theme);
  const { data: graph, loading, error, refetch } = useApi<StoryGraph>(`/projects/${projectId}/story-graph`);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-destructive">{t("common.error")}: {error}</div>;
  if (!graph) return null;
  const exportUrl = buildProjectExportDownloadUrl(projectId);

  const genImage = async (nodeId: string) => {
    setGeneratingId(nodeId);
    setSaveError(null);
    try {
      await fetchJson(`/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/image`, { method: "POST" });
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingId(null);
    }
  };

  const saveNode = async (node: StoryNode) => {
    setSavingId(node.id);
    setSaveError(null);
    try {
      await fetchJson(`/projects/${projectId}/story-graph/delta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: { nodes: { upsert: [node] } } }),
      });
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="film-tree">
      {!embedded && (
        <div className="flex items-center gap-3 text-sm">
          <button onClick={nav.toDashboard} className={c.link} data-testid="film-back">
            ← {t("bread.books")}
          </button>
          <span className={c.muted}>/</span>
          <span data-testid="film-title">{graph.title || projectId}</span>
          <button
            onClick={() => nav.toPlay(projectId)}
            className={`ml-auto px-3 py-1 rounded ${c.btnPrimary}`}
            data-testid="film-play"
          >
            {tr("试玩", "Play")} →
          </button>
          <button
            onClick={() => nav.toFlow(projectId)}
            className={`px-3 py-1 rounded ${c.btnSecondary}`}
            data-testid="open-flow"
          >
            {tr("流程图", "Flow")} →
          </button>
          <button
            onClick={() => nav.toFilmAuthor(projectId)}
            className={`px-3 py-1 rounded ${c.btnSecondary}`}
            data-testid="open-authoring"
          >
            {tr("AI 对话创作", "AI chat authoring")} →
          </button>
          {exportUrl && (
            <a
              href={exportUrl}
              download
              className={`px-3 py-1 rounded ${c.btnSecondary}`}
              data-testid="film-export-package"
            >
              {tr("导出整包", "Export package")}
            </a>
          )}
        </div>
      )}

      <AnalysisPanel projectId={projectId} theme={theme} />

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="film-save-error">
          {tr("保存失败：", "Save failed: ")}{saveError}
        </div>
      )}

      {graph.worldAnchor && (
        <div className="border rounded p-3 text-sm" data-testid="film-world">
          <div className={c.muted}>{tr("世界锚点", "World anchor")}</div>
          <div>{tr("核心：", "Core: ")}{graph.worldAnchor.storyCore}</div>
          <div>{tr("主题：", "Theme: ")}{graph.worldAnchor.theme} · {tr("题材：", "Genre: ")}{graph.worldAnchor.genre}</div>
        </div>
      )}

      <div className="space-y-3" data-testid="film-nodes">
        {graph.nodes.map((node) => (
          <NodeEditor
            key={node.id}
            node={node}
            characters={graph.characters}
            saving={savingId === node.id}
            onSave={saveNode}
            generating={generatingId === node.id}
            onGenerateImage={genImage}
            colors={c}
          />
        ))}
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  characters,
  saving,
  onSave,
  generating,
  onGenerateImage,
  colors,
}: {
  node: StoryNode;
  characters: StoryGraph['characters'];
  saving: boolean;
  onSave: (n: StoryNode) => void;
  generating: boolean;
  onGenerateImage: (nodeId: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [scene, setScene] = useState(node.sceneDesc);
  const dirty = scene !== node.sceneDesc;

  return (
    <div className="border rounded p-3" data-testid={`film-node-${node.id}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs">{node.type}</span>
        <span>{node.title || node.id}</span>
      </div>
      {node.imageSlot?.assetRef && (
        <img
          data-testid={`node-image-${node.id}`}
          src={buildApiUrl('/project/files/' + node.imageSlot.assetRef.split('/').map(encodeURIComponent).join('/')) ?? undefined}
          alt=""
          className="w-32 rounded mb-2"
          loading="lazy"
        />
      )}
      <textarea
        data-testid={`film-scene-${node.id}`}
        className="mt-2 w-full text-sm border rounded p-2"
        value={scene}
        onChange={(e) => setScene(e.target.value)}
      />
      {node.dialogue.length > 0 && (
        <div className="mt-2 space-y-1">
          {node.dialogue.map((l, i) => (
            <div key={i} className="text-xs">
              <span className={colors.accent}>{characters.find(character=>character.id===l.speaker)?.name || l.speaker}{tr("：", ": ")}</span>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          data-testid={`film-save-${node.id}`}
          disabled={!dirty || saving}
          onClick={() => onSave({ ...node, sceneDesc: scene })}
          className={`px-3 py-1 text-xs rounded ${colors.btnPrimary} disabled:opacity-40`}
        >
          {saving ? tr("保存中…", "Saving…") : tr("保存", "Save")}
        </button>
        <button
          data-testid={`gen-image-${node.id}`}
          disabled={generating}
          onClick={() => onGenerateImage(node.id)}
          className={`px-3 py-1 text-xs rounded ${colors.btnSecondary} disabled:opacity-40`}
        >
          {generating ? tr("生成中…", "Generating…") : tr("生成配图", "Generate image")}
        </button>
      </div>
    </div>
  );
}
