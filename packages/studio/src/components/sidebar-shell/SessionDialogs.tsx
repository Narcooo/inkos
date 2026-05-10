import { ConfirmDialog } from "../ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { DeleteTarget, RenameTarget } from "./types";

interface SessionDialogsProps {
  readonly deleteTarget: DeleteTarget | null;
  readonly onCancelDelete: () => void;
  readonly onCancelRename: () => void;
  readonly onConfirmDelete: () => void;
  readonly onConfirmRename: () => void;
  readonly renameTarget: RenameTarget | null;
  readonly renameValue: string;
  readonly setRenameValue: (value: string) => void;
}

export function SessionDialogs({
  deleteTarget,
  onCancelDelete,
  onCancelRename,
  onConfirmDelete,
  onConfirmRename,
  renameTarget,
  renameValue,
  setRenameValue,
}: SessionDialogsProps) {
  return (
    <>
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) onCancelRename();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-[360px] p-4 gap-3"
        >
          <DialogHeader className="space-y-0 gap-0">
            <DialogTitle className="font-sans text-sm font-medium">重命名会话</DialogTitle>
          </DialogHeader>
          <input
            id="session-rename-input"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirmRename();
              }
            }}
            placeholder="输入新标题"
            className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-border"
          />
          <DialogFooter className="gap-1 sm:gap-1">
            <button
              type="button"
              onClick={onCancelRename}
              className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirmRename}
              disabled={!renameValue.trim()}
              className="px-3 py-1 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30"
            >
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除会话"
        message={`确认删除“${deleteTarget?.title ?? ""}”吗？该操作只删除这条会话，不影响书籍内容。`}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}
