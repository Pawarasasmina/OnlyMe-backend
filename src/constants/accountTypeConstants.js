export const ACCOUNT_TYPES = ["REAL", "SEED", "TEST"];
export const DEFAULT_ACCOUNT_TYPE = "SEED";

export const normalizeAccountType = (value) => ACCOUNT_TYPES.includes(String(value || "").toUpperCase())
  ? String(value).toUpperCase()
  : DEFAULT_ACCOUNT_TYPE;

export const financialModeForAccountType = (value) => normalizeAccountType(value) === "TEST" ? "TEST" : "REAL_SEED";
