(function () {
  const STORAGE_KEY = "homelab-theme";
  const MODES = ["system", "light", "dark"];

  function getStored() {
    return localStorage.getItem(STORAGE_KEY) || "system";
  }

  function getEffective(mode) {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return mode;
  }

  function apply(mode) {
    const effective = getEffective(mode);
    document.documentElement.setAttribute("data-theme", effective);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const labels = { system: "SYS", light: "LHT", dark: "DRK" };
      btn.textContent = labels[mode];
      btn.title = `Theme: ${mode}`;
    }
  }

  function cycle() {
    const current = getStored();
    const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  // Apply on load (before paint)
  apply(getStored());

  // Listen for system changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getStored() === "system") apply("system");
  });

  // Expose
  window.cycleTheme = cycle;
})();
