import type { ChatState } from "./types";
import { initialMessageState } from "./slices/message/initialState";
import { initialCreateState } from "./slices/create/initialState";

export const initialChatState: ChatState = {
  ...initialMessageState,
  ...initialCreateState,
};
