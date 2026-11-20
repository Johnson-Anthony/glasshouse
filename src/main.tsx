import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/themes.css";
import "./styles/app.css";
import { applySavedLook } from "./useLook";

// Before the first render, so the window doesn't flash the wrong theme.
applySavedLook();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
