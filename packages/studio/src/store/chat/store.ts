import { create } from "zustand";
import type { ChatStore } from "./types";
import { initialChatState } from "./initialState";
import { createMessageSlice } from "./slices/message/action";
import { createCreateSlice } from "./slices/create/action";

export const useChatStore = create<ChatStore>()((...a) => ({
  ...initialChatState,
  ...createMessageSlice(...a),
  ...createCreateSlice(...a),
}));
