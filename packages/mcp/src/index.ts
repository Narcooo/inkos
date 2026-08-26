#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runStdioServer } from "./server.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdioServer().catch((error) => {
    process.stderr.write(`[inkos-mcp] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}

export { createInkosMcpServer, runStdioServer } from "./server.js";
export { createInkosMcpService } from "./mcp-service.js";
export type {
  AgentCommitBookInput,
  AgentCommitBookResult,
  AgentCommitChapterInput,
  AgentCommitChapterResult,
  AgentContinuePlanInput,
  AgentContinuePlanResult,
  AgentCreateBookPlanInput,
  AgentCreateBookPlanResult,
  AgentFoundationFileName,
  AgentImportPlanInput,
  AgentImportPlanResult,
  AgentTask,
  AgentTruthFileName,
  ContextBundleInput,
  ContextBundleResult,
  DiagnoseImportResult,
  ExportBookInput,
  ExportBookResult,
  ImportCommitInput,
  ImportCommitResult,
  ImportPreviewInput,
  ImportPreviewResult,
  InkosMcpService,
  InspectBookResult,
  ListBooksResult,
  ProjectStatus,
  RepairProjectIndexResult,
  UpdateControlDocInput,
  UpdateControlDocResult,
  WriteAgentChapterInput,
  WriteAgentChapterResult,
} from "./types.js";
