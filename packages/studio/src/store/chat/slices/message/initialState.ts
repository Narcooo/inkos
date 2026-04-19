import type { MessageState } from "../../types";

export const initialMessageState: MessageState = {
  sessions: {},
  sessionIdsByBook: {},
  activeSessionId: null,
  input: "",
  selectedModel: null,
  selectedService: null,
};
