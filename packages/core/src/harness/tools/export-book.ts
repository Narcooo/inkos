import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@sinclair/typebox";
import { writeExportArtifact, type ExportStateLike } from "../../interaction/export-artifact.js";

const ExportBookParameters = Type.Object({
  format: Type.Optional(Type.Union([
    Type.Literal("txt"),
    Type.Literal("md"),
    Type.Literal("epub"),
  ])),
});

type ExportBookInput = Static<typeof ExportBookParameters>;

export function createExportBookTool(
  state: ExportStateLike,
  bookId: string,
  options: { readonly outputPath?: string } = {},
): AgentTool<typeof ExportBookParameters> {
  return {
    name: "export_book",
    label: "Export Work",
    description: "Export this long-form Work as Markdown, text, or EPUB.",
    parameters: ExportBookParameters,
    async execute(_toolCallId, input: ExportBookInput) {
      const details = await writeExportArtifact(state, bookId, {
        format: input.format ?? "txt",
        ...(options.outputPath ? { outputPath: options.outputPath } : {}),
      });
      return {
        content: [{
          type: "text",
          text: `Exported "${bookId}": ${details.chaptersExported} chapters, ${details.totalWords} counted units to ${details.outputPath}. Delivery checks: ${details.delivery.status}.`,
        }],
        details,
      };
    },
  };
}
