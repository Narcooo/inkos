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
  type ChatHistory,
  type ChatMessage,
  type ClackCallbacks,
} from "./types.js";
import { SLASH_COMMANDS } from "./commands.js";
import type { PipelineConfig } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig } from "../utils.js";

export interface ChatAppConfig {
  language?: "zh" | "en";
  maxMessages?: number;
}

// Main Chat Component
const ChatInterface: React.FC<{
  bookId: string;
  config: ChatAppConfig;
}> = ({ bookId, config }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // State
  const [session, setSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Initializing...");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [terminalWidth, setTerminalWidth] = useState(stdout.columns || 80);

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

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        const projectConfig = await loadConfig();
        const pipelineConfig = buildPipelineConfig(projectConfig, process.cwd(), { quiet: true });
        const historyManager = new ChatHistoryManager({
          maxMessages: config.maxMessages ?? 50,
        });

        const newSession = new ChatSession(pipelineConfig, bookId, historyManager);
        await newSession.initialize();

        setSession(newSession);
        setStatus("Ready");
      } catch (error) {
        setStatus(`Error: ${error}`);
      }
    };

    initSession();
  }, [bookId]);

  // Get matching commands for autocomplete
  const getMatchingCommands = useCallback((inputText: string) => {
    if (!inputText.startsWith("/")) return [];

    const commands = Object.keys(SLASH_COMMANDS) as Array<keyof typeof SLASH_COMMANDS>;
    const partial = inputText.slice(1).toLowerCase();
    return commands.filter(cmd => cmd.toLowerCase().startsWith(partial));
  }, []);

  const matchingCommands = getMatchingCommands(input);

  // Handle keyboard input
  useInput((_inputKey, key) => {
    // Tab: autocomplete
    if (key.tab && matchingCommands.length > 0) {
      const selected = matchingCommands[selectedSuggestionIndex];
      if (selected) {
        setInput(`/${selected} `);
        setShowCommandSuggestions(false);
      }
    }

    // Up/Down: navigate suggestions
    if (key.upArrow && showCommandSuggestions) {
      setSelectedSuggestionIndex(i =>
        i > 0 ? i - 1 : matchingCommands.length - 1
      );
    }

    if (key.downArrow && showCommandSuggestions) {
      setSelectedSuggestionIndex(i =>
        i < matchingCommands.length - 1 ? i + 1 : 0
      );
    }

    // Escape: exit
    if (key.escape) {
      exit();
    }
  }, {
    isActive: showCommandSuggestions || matchingCommands.length > 0,
  });

  // Show/hide suggestions based on input
  useEffect(() => {
    setShowCommandSuggestions(input.startsWith("/") && matchingCommands.length > 0);
    setSelectedSuggestionIndex(0);
  }, [input, matchingCommands.length]);

  // Handle message submission
  const handleSubmit = async (submittedInput: string) => {
    if (!session || isProcessing || !submittedInput.trim()) return;

    // Clear input immediately after submission for better UX
    setInput("");

    // Handle special commands
    if (submittedInput === "/exit" || submittedInput === "/quit") {
      exit();
      return;
    }

    if (submittedInput === "/clear") {
      await session.clearHistory();
      setStatus("History cleared");
      return;
    }

    if (submittedInput === "/help") {
      // Help is shown in the history display
      setStatus("Showing help");
      return;
    }

    setIsProcessing(true);
    setStatus("Processing...");

    try {
      const result = await session.processInput(submittedInput, {
        onToolStart: (toolName) => {
          setStatus(`Executing: ${toolName}`);
        },
        onToolComplete: () => {
          setStatus("Processing...");
        },
        onStatusChange: (newStatus) => {
          setStatus(newStatus);
        },
      });

      setStatus(result.success ? "✓ Done" : "✗ Failed");
    } catch (error) {
      setStatus(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Render recent messages
  const history = session?.getHistory();
  const recentMessages = history?.messages.slice(-10) ?? [];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Status bar */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          InkOS Chat - {bookId}
        </Text>
        <Text> | </Text>
        <Text color="gray">{status}</Text>
        {isProcessing && (
          <Box marginLeft={1}>
            <Spinner type="dots" />
          </Box>
        )}
      </Box>

      {/* Message history */}
      <Box flexDirection="column" marginBottom={1}>
        {recentMessages.map((msg, idx) => (
          <MessageDisplay key={idx} message={msg} />
        ))}
      </Box>

      {/* Command suggestions */}
      {showCommandSuggestions && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>━━ Commands ━━</Text>
          {matchingCommands.slice(0, 5).map((cmd, idx) => (
            <Box key={cmd}>
              <Text
                color={idx === selectedSuggestionIndex ? "cyan" : "white"}
                bold={idx === selectedSuggestionIndex}
              >
                {idx === selectedSuggestionIndex ? "▶ " : "  "}
                /{cmd} - {SLASH_COMMANDS[cmd].description}
              </Text>
            </Box>
          ))}
          <Text dimColor>Tab: autocomplete | ↑↓: navigate</Text>
        </Box>
      )}

      {/* Input with separator lines */}
      <Box flexDirection="column" marginTop={1}>
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
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Type / for commands (Tab to autocomplete)..."
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
  render(<ChatInterface bookId={bookId} config={config} />);
}