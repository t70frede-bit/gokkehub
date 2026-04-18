import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "@gokkehub/ui";
import App from "./App.tsx";

// Theme: account (indigo/rose) → base
import "@gokkehub/config/themes/games/account.css";
import "@gokkehub/config/themes/tokens.css";
import "@gokkehub/config/themes/base.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
