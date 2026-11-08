import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n, LANGUAGE_KEY } from "./i18n";
import { applyPlatformAttribute } from "./lib/platform";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";

applyPlatformAttribute();

void initI18n(localStorage.getItem(LANGUAGE_KEY)).then(() =>
  ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  ),
);
