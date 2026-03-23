// InkOS Studio — Theme Toggle
export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("inkos-theme", theme);
  updateThemeIcon(theme);
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
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
