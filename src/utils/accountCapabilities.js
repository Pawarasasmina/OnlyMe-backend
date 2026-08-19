export const isAdminAccount = (user) => user?.role === "admin";

// `creator` remains accepted while legacy records are migrated to the unified
// consumer role. New non-admin accounts are always stored as `fan`.
export const isConsumerAccount = (user) => ["fan", "creator"].includes(user?.role);

export const hasCreatorAccess = (user) => (
  isConsumerAccount(user) && user?.creatorApprovalStatus === "approved"
);

export const hasCreatorApplication = (user) => (
  isConsumerAccount(user) && user?.creatorApprovalStatus != null
);
