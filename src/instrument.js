import { recordException, flushMonitoring } from "./services/internalMonitoringService.js";
import { errorFrames } from "./utils/internalMonitoringPayload.js";
process.on("uncaughtExceptionMonitor", (error) => {
  recordException(error);
  // Preserve a redacted local crash record even if MongoDB is unavailable.
  console.error(JSON.stringify({ monitoring: "fatal_process_error", errorType: error?.name || "Error", frames: errorFrames(error), at: new Date().toISOString() }));
});
export { recordException, flushMonitoring };