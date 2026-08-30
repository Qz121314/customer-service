import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminPortal } from "./AdminPortal";

async function loadAdminStyles() {
  await import("./styles.css");
  await import("./product-assignment.css");
  await import("./agent-statistics.css");
  await import("./month-picker.css");
  await import("./cloud-service-ui.css");
  await import("./agent-editor.css");
  await import("./agent-avatar.css");
  await import("./admin-commercial.css");
  await import("./admin-agents.css");
  await import("./admin-statistics.css");
  await import("./admin-layout.css");
  await import("./commercial-polish.css");
  await import("./admin-design-system.css");
  await import("./no-agent-message.css");
}

export async function bootstrap() {
  await loadAdminStyles();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AdminPortal />
    </StrictMode>,
  );
}
