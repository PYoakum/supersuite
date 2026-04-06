const Import = {
  init() {
    document.getElementById("import-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById("import-json").value = ev.target.result;
      };
      reader.readAsText(file);
    });

    document.getElementById("btn-import").addEventListener("click", () => this.run());
  },

  async run() {
    const raw = document.getElementById("import-json").value.trim();
    const resultEl = document.getElementById("import-result");

    if (!raw) {
      this.showResult("Paste JSON or upload a file first", true);
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      this.showResult("Invalid JSON", true);
      return;
    }

    const res = await API.importTasks(body);
    if (res.ok) {
      this.showResult(`Imported ${res.imported} task${res.imported === 1 ? "" : "s"} successfully`, false);
      document.getElementById("import-json").value = "";
    } else {
      this.showResult("Errors:\n" + (res.errors || ["Import failed"]).join("\n"), true);
    }
  },

  showResult(msg, isError) {
    const el = document.getElementById("import-result");
    el.textContent = msg;
    el.classList.remove("hidden", "success", "error");
    el.classList.add(isError ? "error" : "success");
  },
};
