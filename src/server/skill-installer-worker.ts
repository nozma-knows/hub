import "dotenv/config";

import { startSkillInstaller } from "@/server/skill-installer";

// Keep this as a dedicated long-lived process.
process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("[skill-installer-worker] unhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[skill-installer-worker] uncaughtException", err);
  process.exit(1);
});

// eslint-disable-next-line no-console
console.log("[skill-installer-worker] starting…");
startSkillInstaller();
