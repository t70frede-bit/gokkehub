import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// Theme: web (purple/pink) → base
import "@gokkehub/config/themes/games/web.css";
import "@gokkehub/config/themes/tokens.css";
import "@gokkehub/config/themes/base.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
