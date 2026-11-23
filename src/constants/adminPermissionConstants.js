export const ADMIN_PERMISSION_CATALOG = Object.freeze([
  { key: "dashboard.view", group: "Overview", label: "View dashboard", description: "See operational totals, queues, and platform health." },
  { key: "analytics.view", group: "Overview", label: "View analytics", description: "Open analytics reports and download analytics exports." },
  { key: "users.view", group: "People", label: "View users", description: "Search accounts and open user details." },
  { key: "users.manage", group: "People", label: "Manage users", description: "Suspend accounts, update status, and change creator approval." },
  { key: "verification.view", group: "People", label: "View verification", description: "See identity, creator, and verified-creator applications." },
  { key: "verification.manage", group: "People", label: "Decide verification", description: "Approve, reject, or request changes on applications." },
  { key: "moderation.view", group: "Trust & safety", label: "View moderation", description: "Open safety queues, reports, appeals, and content reviews." },
  { key: "moderation.manage", group: "Trust & safety", label: "Take moderation action", description: "Resolve reports, enforce outcomes, and review appeals." },
  { key: "finance.view", group: "Commerce", label: "View finance", description: "See wallets, payouts, revenue, bank reviews, and user money history." },
  { key: "finance.manage", group: "Commerce", label: "Manage finance", description: "Credit wallets, change payout status, holds, and financial settings." },
  { key: "gifts.manage", group: "Commerce", label: "Manage gift catalog", description: "Create, edit, reorder, and remove gifts and categories." },
  { key: "announcements.view", group: "Communication", label: "View announcements", description: "See announcement history and delivery results." },
  { key: "announcements.manage", group: "Communication", label: "Send announcements", description: "Preview audiences, schedule campaigns, repeat, and cancel them." },
  { key: "welcome_email.manage", group: "Communication", label: "Manage welcome email", description: "View and edit the welcome email template." },
  { key: "recommendations.manage", group: "Platform", label: "Manage recommendations", description: "Edit, activate, and reset recommendation configurations." },
  { key: "governance.view", group: "Platform", label: "View governance", description: "See audit events, legal holds, and governance targets." },
  { key: "governance.manage", group: "Platform", label: "Manage governance", description: "Create and release legal holds and update moderation policy." },
  { key: "exports.manage", group: "Platform", label: "Export platform data", description: "Create content and user data export packages." },
]);

export const ADMIN_PERMISSION_KEYS = Object.freeze(ADMIN_PERMISSION_CATALOG.map((item) => item.key));
export const DEFAULT_ADMIN_ROLE_PERMISSIONS = Object.freeze({
  MAIN_ADMIN: ADMIN_PERMISSION_KEYS,
  MODERATOR: ["dashboard.view", "analytics.view", "users.view", "users.manage", "verification.view", "verification.manage", "moderation.view", "moderation.manage", "announcements.view", "announcements.manage"],
  FINANCE: ["dashboard.view", "users.view", "finance.view", "finance.manage"],
});
