// InkOS Studio — View Switching
import { state } from "./state.js";
import { $ } from "./utils.js";

export function setView(name) {
  state.currentView = name;
  const main = $("main-area");
  main.querySelectorAll(":scope > section").forEach(s => s.classList.remove("active-view"));
  const target = $(name + "-view");
  if (target) target.classList.add("active-view");
}
