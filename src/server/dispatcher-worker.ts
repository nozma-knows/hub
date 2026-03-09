import "dotenv/config";

import { startDispatcher } from "@/server/dispatcher";

// Keep this as a dedicated long-lived process.
// The dispatcher itself sets an interval; this file just bootstraps it.
process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("[dispatcher-worker] unhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[dispatcher-worker] uncaughtException", err);
  process.exit(1);
});

// eslint-disable-next-line no-console
console.log("[dispatcher-worker] starting…");
startDispatcher();
