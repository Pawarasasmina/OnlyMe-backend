Monetization settings
=====================

The Settings → Monetization page uses GET/PUT /api/settings/monetization for eligibility and tool availability. It reuses /api/wallet for dollar amounts (including TEST isolation), the admin exchange rate and the admin gift catalog. No prototype balances, coin prices, country or verified status are seeded.

Admins configure enabled state, confirmed payout-country names and the monetization terms version under Financial operations → Monetization eligibility. These use GET/PUT /api/admin/monetization-policy with the existing admin authorization and financial mutation limiter. With an empty country list, users can complete their details and submit a bank application; country eligibility stays pending until an admin approves the bank. A configured list remains an explicit country restriction. Changes take effect on subsequent server checks.

Users with missing eligibility details can supply a birthday once, choose an admin-supported country and accept the current terms. An approved identity application's birthday overrides self-reported data. Unverified identities and missing bank connections remain distinct. Standing reflects actual active account restrictions; no simulated 90-day strike history is presented.

Immediate creator earnings are checked before ledger posting; a failed eligibility check aborts the financial transaction. New Direct Access windows and paid-call offers are checked before purchase. Settlement/refund of an existing paid question or call continues to honor its original payment. Existing price configuration and ledger conversion remain authoritative.

The page opens existing gift preferences, Dream editing, paid Seen creation, World/profile navigation, Direct Access settings, account-type switching, verification, payouts and holds/refunds. Monetization setup does not fabricate provider bank setup or execute withdrawals.

Validation: MONETIZATION_INTEGRATION=1 node --test src/services/monetizationService.test.js src/services/monetization.integration.test.js. Frontend: playwright test --config playwright.monetization.config.js.
