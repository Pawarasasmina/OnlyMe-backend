const write = (level, event) => console[level](JSON.stringify({ scope: "financial", timestamp: new Date().toISOString(), ...event }));

export function logFinancialCommand(event) {
  write(event.resultStatus === "FAILED" ? "warn" : "info", event);
}

export function logReconciliationDrift(event) {
  write("warn", { event: "WALLET_RECONCILIATION_DRIFT", ...event });
}
