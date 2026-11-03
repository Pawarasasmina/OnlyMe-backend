Manual bank review
==================

Bank payout setup is now handled in the app and reviewed by an admin. Stripe redirects and bank webhooks are not used.

User: Verification / Monetization > Add a bank for payouts > Add > bank details > Submit for admin review. Pending applications cannot be changed until reviewed. Changes requested and rejected applications can be corrected and resubmitted. Editing an approved bank requires a new review and immediately removes payout readiness after submission.

Admin: Commerce > Bank reviews. Lists show only masked account numbers. Opening full details requires admin authorization and creates a DETAILS_VIEWED audit record. Approval, rejection and requests for changes require an explicit review confirmation. A version check prevents stale or duplicate decisions; administrators cannot approve their own bank details. Only an admin-approved identity can have a bank approved.

BANK_DETAILS_ENCRYPTION_KEY must contain 64 hexadecimal characters (32 random bytes). Account numbers and routing/SWIFT data use AES-256-GCM encryption at rest. Keep this key in deployment secrets and retain it when deploying; replacing it without migrating records makes previous details unreadable. No full account number is returned by normal user endpoints or saved in browser persistent storage. The local key is stored only in the ignored backend .env.

An approved bank means it is accepted for manual payouts by the team. Bank approval itself never sends money. The monthly setting records the user's payout preference for manual processing.
