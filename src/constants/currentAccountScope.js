export const CURRENT_ACCOUNT_FILTER = Object.freeze({ deletionRequestedAt: null });
export function withCurrentAccounts(filter = {}) { return { ...filter, ...CURRENT_ACCOUNT_FILTER }; }
