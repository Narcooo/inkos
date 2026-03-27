// InkOS Studio — Theme Toggle
export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

export function getStyle() {
  return document.documentElement.getAttribute("data-style") || "ink";
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("inkos-theme", theme);
  updateThemeIcon(theme);
}

export function setStyle(style) {
  document.documentElement.setAttribute("data-style", style);
  localStorage.setItem("inkos-style", style);
  updateStyleLabel(style);
  document.dispatchEvent(new CustomEvent("inkos:stylechange", { detail: { style } }));
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

export function toggleStyle() {
  setStyle(getStyle() === "ink" ? "modern" : "ink");
}

export function updateThemeIcon(theme) {
  const sun = document.getElementById("theme-icon-sun");
  const moon = document.getElementById("theme-icon-moon");
  if (!sun || !moon) return;
  if (theme === "dark") {
    sun.style.display = "none";
    moon.style.display = "";
  } else {
    sun.style.display = "";
    moon.style.display = "none";
  }
}

export function updateStyleLabel(style) {
  const label = document.getElementById("style-toggle-label");
  const toggle = document.getElementById("style-toggle");
  if (label) label.textContent = style === "ink" ? "墨韵" : "Modern";
  if (toggle) toggle.setAttribute("title", style === "ink" ? "切换到 Modern 风格" : "切换到墨韵风格");
}
