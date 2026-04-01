/**
 * Main Chat Application using Ink (React-like terminal UI).
 * Provides rich interactivity including Tab autocomplete.
 */

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { ChatSession } from "./session.js";
import { ChatHistoryManager } from "./history.js";
import {
  type ChatMessage,
  type ExecutionMetadata,
} from "./types.js";
import { SLASH_COMMANDS, getAutocompleteInput } from "./commands.js";
import { loadConfig, buildPipelineConfig } from "../utils.js";

export interface ChatAppConfig {
  maxMessages?: number;
}

function formatDuration(ms: number): string {
  const totalTenths = Math.floor(Math.max(0, ms) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function getElapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function summarizeExecutionTarget(input: string): string {
  if (input.startsWith("/")) {
    const command = input.split(/\s+/, 1)[0];
    return command ?? input;
  }

  return "natural language request";
}

function formatExecutionMetadata(metadata: ExecutionMetadata | null): {
  worker: string;
  toolName?: string;
  model?: string;
  provider?: string;
} | null {
  if (!metadata) {
    return null;
  }

  return {
    worker: metadata.label,
    toolName: metadata.toolName,
    model: metadata.model,
    provider: metadata.provider,
  };
}

const MetadataTag: React.FC<{
  label: string;
  value: string;
  color: "cyan" | "green" | "magenta" | "blue";
}> = ({ label, value, color }) => (
  <Box marginRight={1}>
    <Text dimColor>[</Text>
    <Text dimColor>{label}: </Text>
    <Text color={color}>{value}</Text>
    <Text dimColor>]</Text>
  </Box>
);

async function createChatSession(bookId: string, config: ChatAppConfig): Promise<ChatSession> {
  const projectConfig = await loadConfig({ requireApiKey: false });
  const pipelineConfig = buildPipelineConfig(projectConfig, process.cwd(), { quiet: true });
  const historyManager = new ChatHistoryManager({
    maxMessages: config.maxMessages ?? 50,
  });

  const session = new ChatSession(pipelineConfig, bookId, historyManager);
  await session.initialize();
  return session;
}

// Main Chat Component
const ChatInterface: React.FC<{
  initialSession: ChatSession;
}> = ({ initialSession }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // State
  const [session] = useState(initialSession);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [terminalWidth, setTerminalWidth] = useState(stdout.columns || 80);
  const [inputResetKey, setInputResetKey] = useState(0);
  const [executionStartedAt, setExecutionStartedAt] = useState<number | null>(null);
  const [executionElapsedMs, setExecutionElapsedMs] = useState(0);
  const [activeExecutionTarget, setActiveExecutionTarget] = useState<string | null>(null);
  const [lastExecutionSummary, setLastExecutionSummary] = useState<{
    target: string;
    durationMs: number;
  } | null>(null);
  const [activeExecutionMetadata, setActiveExecutionMetadata] = useState<ExecutionMetadata | null>(null);
  const [forceExitArmed, setForceExitArmed] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

  // Track terminal width changes
  useEffect(() => {
    const handleResize = () => {
      setTerminalWidth(stdout.columns || 80);
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  // Get matching commands for autocomplete
  const getMatchingCommands = useCallback((inputText: string) => {
    if (!inputText.startsWith("/")) return [];

    const commands = Object.keys(SLASH_COMMANDS) as Array<keyof typeof SLASH_COMMANDS>;
    const partial = inputText.slice(1).toLowerCase();
    return commands.filter(cmd => cmd.toLowerCase().startsWith(partial));
  }, []);

  const matchingCommands = getMatchingCommands(input);

  const setInputAndResetCursor = (nextInput: string) => {
    setInput(nextInput);
    setInputResetKey((current) => current + 1);
  };

  // Handle keyboard input
  useInput((_inputKey, key) => {
    if (key.escape) {
      if (isProcessing) {
        if (forceExitArmed) {
          process.stderr.write("[WARN] Force quitting chat while a request is still running.\n");
          exit();
          process.exit(130);
          return;
        }

        setForceExitArmed(true);
        setStatus("命令仍在执行，再按一次 Esc 强制退出");
        return;
      }

      exit();
      return;
    }

    // Tab: autocomplete (only when suggestions are shown)
    if (key.tab && matchingCommands.length > 0) {
      const selected = matchingCommands[selectedSuggestionIndex];
      if (selected) {
        setInputAndResetCursor(getAutocompleteInput(selected));
        setShowCommandSuggestions(false);
      }
      return;
    }

    // Up/Down: navigate suggestions (only when suggestions are shown)
    if (key.upArrow && showCommandSuggestions) {
      setSelectedSuggestionIndex(i =>
        i > 0 ? i - 1 : matchingCommands.length - 1
      );
      return;
    }

    if (key.downArrow && showCommandSuggestions) {
      setSelectedSuggestionIndex(i =>
        i < matchingCommands.length - 1 ? i + 1 : 0
      );
      return;
    }
  });

  // Show/hide suggestions based on input
  useEffect(() => {
    setShowCommandSuggestions(input.startsWith("/") && matchingCommands.length > 0);
    setSelectedSuggestionIndex(0);
  }, [input, matchingCommands.length]);

  useEffect(() => {
    if (!isProcessing || executionStartedAt === null) {
      return;
    }

    setExecutionElapsedMs(getElapsedMs(executionStartedAt));
    const timer = setInterval(() => {
      setExecutionElapsedMs(getElapsedMs(executionStartedAt));
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [executionStartedAt, isProcessing]);

  useEffect(() => {
    if (!forceExitArmed) {
      return;
    }

    const timer = setTimeout(() => {
      setForceExitArmed(false);
    }, 3000);

    return () => {
      clearTimeout(timer);
    };
  }, [forceExitArmed]);

  useEffect(() => {
    if (!isProcessing) {
      setForceExitArmed(false);
    }
  }, [isProcessing]);

  const beginExecution = (inputText: string) => {
    const startedAt = performance.now();
    setExecutionStartedAt(startedAt);
    setExecutionElapsedMs(0);
    setActiveExecutionTarget(summarizeExecutionTarget(inputText));
    setActiveExecutionMetadata(null);
    setIsProcessing(true);
    return startedAt;
  };

  const finishExecution = (startedAt: number | null, inputText: string) => {
    if (startedAt === null) {
      return;
    }

    const durationMs = getElapsedMs(startedAt);
    setExecutionElapsedMs(durationMs);
    setLastExecutionSummary({
      target: summarizeExecutionTarget(inputText),
      durationMs,
    });
    setExecutionStartedAt(null);
    setActiveExecutionTarget(null);
    setActiveExecutionMetadata(null);
    setIsProcessing(false);
    setStreamingContent(null); // Clear streaming content when execution finishes
  };

  // Handle message submission
  const handleSubmit = async (submittedInput: string) => {
    if (isProcessing || !submittedInput.trim()) return;
    const normalizedInput = submittedInput.trim();

    // Clear input immediately after submission for better UX
    setInputAndResetCursor("");

    const startedAt = beginExecution(normalizedInput);
    setStatus("Processing...");

    try {
      const result = await session.processInput(normalizedInput, {
        onToolStart: (toolName) => {
          setStatus(`Executing: ${toolName}`);
        },
        onToolComplete: () => {
          setStatus("Processing...");
        },
        onStatusChange: (newStatus) => {
          setStatus(newStatus);
        },
        onExecutionMetadataChange: (metadata) => {
          setActiveExecutionMetadata(metadata);
        },
        onStreamChunk: (chunk) => {
          setStreamingContent(chunk);
        },
      });

      if (result.shouldExit) {
        setStatus("再见！正在退出...");
        setTimeout(() => exit(), 500);
        return;
      }

      if (result.clearConversation) {
        setStatus("✓ 对话历史已清空");
      } else if (result.success) {
        setStatus("✓ Done");
      } else {
        setStatus(`✗ ${result.message.split("\n")[0]}`);
      }
    } catch (error) {
      setStatus(`Error: ${error}`);
    } finally {
      finishExecution(startedAt, normalizedInput);
    }
  };

  // Render recent messages
  const activeBook = session.getCurrentBook();
  const history = session.getHistory();
  const recentMessages = history?.messages.slice(-10) ?? [];
  const isErrorStatus =
    status.startsWith("Error") ||
    status.startsWith("✗") ||
    status.startsWith("错误");
  const isSuccessStatus =
    status.startsWith("✓") ||
    status.startsWith("已清空") ||
    status.startsWith("完成") ||
    status.startsWith("再见");
  const statusColor = isErrorStatus ? "red" : isSuccessStatus ? "green" : "gray";
  const executionDisplay = formatExecutionMetadata(activeExecutionMetadata);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          InkOS Chat - {activeBook}
        </Text>
      </Box>

      {/* Message history */}
      <Box flexDirection="column" marginBottom={1}>
        {recentMessages.map((msg, idx) => (
          <MessageDisplay key={`${msg.timestamp}:${idx}`} message={msg} />
        ))}
        {/* Streaming assistant message */}
        {streamingContent && (
          <Box flexDirection="column">
            <Text dimColor color="yellow">
              [Streaming...] InkOS:
            </Text>
            <Text>{streamingContent}</Text>
          </Box>
        )}
      </Box>

      {/* Command suggestions */}
      {showCommandSuggestions && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>━━ Commands ━━</Text>
          {(() => {
            const VISIBLE_COMMAND_COUNT = 5;
            const totalCommands = matchingCommands.length;
            if (totalCommands === 0) {
              return null;
            }
            const maxStartIndex = Math.max(0, totalCommands - VISIBLE_COMMAND_COUNT);
            const startIndex = Math.max(
              0,
              Math.min(selectedSuggestionIndex, maxStartIndex)
            );
            const visibleCommands = matchingCommands.slice(
              startIndex,
              startIndex + VISIBLE_COMMAND_COUNT
            );
            return visibleCommands.map((cmd, idx) => {
              const globalIndex = startIndex + idx;
              const isSelected = globalIndex === selectedSuggestionIndex;
              return (
                <Box key={cmd}>
                  <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                    {isSelected ? "▶ " : "  "}
                    /{cmd} - {SLASH_COMMANDS[cmd].description}
                  </Text>
                </Box>
              );
            });
          })()}
          <Text dimColor>Tab: autocomplete | ↑↓: navigate</Text>
        </Box>
      )}

      {/* Input with separator lines */}
      <Box flexDirection="column" marginTop={1}>
        {/* Progress / timing panel */}
        <Box marginBottom={1}>
          {isProcessing ? (
            <Box flexDirection="column">
              <Box>
                <Text color={statusColor}>{status}</Text>
                <Text dimColor> · </Text>
                <Text dimColor>{activeExecutionTarget ?? "request"}</Text>
                <Text dimColor> · </Text>
                <Text color="yellow">elapsed {formatDuration(executionElapsedMs)}</Text>
                <Box marginLeft={1}>
                  <Spinner type="dots" />
                </Box>
              </Box>
              {executionDisplay && (
                <Box flexWrap="wrap">
                  <MetadataTag label="worker" value={executionDisplay.worker} color="cyan" />
                  {executionDisplay.toolName && (
                    <MetadataTag label="tool" value={executionDisplay.toolName} color="green" />
                  )}
                  {executionDisplay.model && (
                    <MetadataTag label="model" value={executionDisplay.model} color="magenta" />
                  )}
                  {executionDisplay.provider && (
                    <MetadataTag label="provider" value={executionDisplay.provider} color="blue" />
                  )}
                </Box>
              )}
            </Box>
          ) : (
            <>
              <Text color={statusColor}>{status}</Text>
              {lastExecutionSummary && (
                <>
                  <Text dimColor> · last </Text>
                  <Text dimColor>{lastExecutionSummary.target}</Text>
                  <Text dimColor>: </Text>
                  <Text color="yellow">{formatDuration(lastExecutionSummary.durationMs)}</Text>
                </>
              )}
            </>
          )}
        </Box>

        {/* Upper separator */}
        <Box width="100%">
          <Text dimColor>{"─".repeat(Math.max(terminalWidth - 2, 10))}</Text>
        </Box>

        {/* Input field */}
        <Box width="100%">
          <Text bold color="green">
            {">"}
          </Text>
          <Box flexGrow={1} marginLeft={1}>
            <TextInput
              key={inputResetKey}
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Type / to show commands (Tab to autocomplete)..."
            />
          </Box>
        </Box>

        {/* Lower separator */}
        <Box width="100%">
          <Text dimColor>{"─".repeat(Math.max(terminalWidth - 2, 10))}</Text>
        </Box>
      </Box>

      {/* Help text */}
      {!input && recentMessages.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Type /help for commands, or just start chatting naturally.
          </Text>
        </Box>
      )}
    </Box>
  );
};

// Message display component
const MessageDisplay: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const timestamp = new Date(message.timestamp).toLocaleTimeString();
  const isUser = message.role === "user";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={isUser ? "green" : "blue"}>
          {isUser ? "👤 You" : "🤖 InkOS"}
        </Text>
        <Text dimColor> [{timestamp}]</Text>
      </Box>
      <Box marginLeft={2}>
        <Text>{message.content}</Text>
      </Box>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>Tools: {message.toolCalls.join(", ")}</Text>
        </Box>
      )}
    </Box>
  );
};

// Main export function
export async function startChat(bookId: string, config: ChatAppConfig): Promise<void> {
  const session = await createChatSession(bookId, config);
  render(<ChatInterface initialSession={session} />);
}
