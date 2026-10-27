import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startUpdates } from "./lib/appUpdate";
import { pruneCaches } from "./lib/cache";
import { noteRejected, noteSynced } from "./lib/diagnostics";
import { initMonitoring, reportRejectedWrite } from "./lib/monitoring";
import { onCommitted, onRejected } from "./lib/queue";
import "./styles.css";

initMonitoring();
startUpdates();
pruneCaches();

// A rejected write is kept for the diagnostics screen and reported, since
// it usually means the UI and a database rule disagree.
onRejected((entry, _message, code) => {
  noteRejected(entry.mutation, code);
  reportRejectedWrite(entry.mutation, code);
});
onCommitted(() => noteSynced());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
