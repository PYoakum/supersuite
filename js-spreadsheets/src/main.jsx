import { createRoot } from "react-dom/client";
import SpreadsheetApp from "../index.jsx";

// Provide a localStorage-backed storage API expected by the app (window.storage)
window.storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value !== null ? { value } : null;
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
  async delete(key) {
    localStorage.removeItem(key);
  },
};

createRoot(document.getElementById("root")).render(<SpreadsheetApp />);
