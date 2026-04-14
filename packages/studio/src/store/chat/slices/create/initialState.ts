import type { CreateState } from "../../types";

export const initialCreateState: CreateState = {
  pendingBookArgs: null,
  bookCreating: false,
  createProgress: "",
  bookDataVersion: 0,
  sidebarView: "panel",
  artifactFile: null,
  bookSummary: null,
};
