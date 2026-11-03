Account ownership and control
=============================

Settings groups Deactivate and Delete under Account ownership and control. UI copy and sheets follow web.html v113 and the Oct 20–26 change document. The prototype's sample amounts are replaced with the wallet's earned bucket, including clearing funds. Unused purchased/bonus coins are not advertised as refundable.

GET /api/auth/account/ownership returns unwithdrawnUsd and graceDays. POST /api/auth/account/deactivate hides the account and revokes existing HTTP, refresh and socket sessions. DELETE /api/auth/account schedules deletion for 30 days later, requiring acknowledgeEarningsLoss=true when earnings remain. Both actions stop membership renewals while retaining the existing paid period. Balances remain intact during deactivation and the deletion grace period.

Password login restores a deactivated account or cancels a deletion request before its deadline. Admin suspension and expired deletion requests cannot be restored this way. Existing sessions stay revoked after restoration.

The Account deletion maintenance worker finalizes due requests, cleans owned assets identified by the account's storage path, removes authored content and role profiles, and replaces the user with an unverified tombstone. Financial ledgers, receipts and moderation/audit records retain their references. Shared assets belonging to other users are preserved. Cleanup retries on subsequent passes after a storage failure; the expired account cannot log in during cleanup.

Verification: OWNERSHIP_INTEGRATION=1 node --test src/services/accountOwnershipService.test.js src/services/accountOwnership.integration.test.js (uses a disposable MongoDB instance). Frontend: playwright test --config playwright.ownership.config.js.
