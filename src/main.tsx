import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./CrashScreen";
import { logUncaught } from "./log";
import "./styles/themes.css";
import "./styles/app.css";
import { applySavedLook } from "./useLook";

// Before the first render, so the window doesn't flash the wrong theme.
applySavedLook();
logUncaught();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
