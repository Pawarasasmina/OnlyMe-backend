const routes = new Set("api admin dashboard analytics users finance financial identity-verifications creator-verifications business-verifications verified-creators governance audit-log reports message-reports user-reports post-reports safety staff support-inbox bank-reviews gifts profile security auth login logout register refresh me feed posts stories seen seens worlds world wallet ledger income payouts health ready live discover messages conversations calls notifications creator verification settings restore create worker watchdog search library recommendations wall home permissions access roles publications comments financials assets static src node_modules".split(" "));

export function monitoringRoute(value = "/") {
  let path;
  try { path = new URL(String(value), "https://monitor.invalid").pathname; } catch { return "/:unknown"; }
  return path.split("/").map((part) => !part || routes.has(part) ? part : ":id").join("/");
}
