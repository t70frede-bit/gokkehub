import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "@gokkehub/ui";
import App from "./App.tsx";
import { AuthProvider } from "@/context/AuthContext";

// Theme: poker (warm charcoal + amber, felt-tinted bg) → tokens → base.
import "@gokkehub/config/themes/games/poker.css";
import "@gokkehub/config/themes/tokens.css";
import "@gokkehub/config/themes/base.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
