import type { MessageState } from "../../types";

export const initialMessageState: MessageState = {
  messages: [],
  input: "",
  loading: false,
  currentSessionId: null,
  selectedModel: null,
  selectedService: null,
  _activeStream: null,
};
