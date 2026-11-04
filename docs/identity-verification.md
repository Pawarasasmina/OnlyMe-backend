# In-app identity verification

The current user journey uses manual review by the @seen team. It does not require Stripe credentials, the Stripe CLI, a Stripe webhook, social-media handles, or an external identity page.

## User journey

Settings -> Verification -> Start verification -> legal name, birthday, country, document type and issuing country -> ID front (and back for a national ID or driving licence) -> photo holding the ID -> age, accuracy and review consent -> Send for review.

Drafts can be saved. Pending applications cannot be edited. The status screen polls while under review and survives reloads. Rejected or changes-requested applications show the reviewer message and can be corrected and resubmitted. Approval activates the public blue seal without approving creator tools or setting up a payout account. Platform and World member numbers remain independent.

## Review

Open `/admin/identity-verifications` (or the existing `/admin/creator-verifications`). Review opens the full identity-details page with protected ID and selfie previews, a review checklist, Approve, Reject, Request changes, and audit history. Only authenticated admins can retrieve another user's application or documents and make decisions. The API requires explicit manual-review confirmation for approval and validates the completed application again. Concurrent conflicting decisions return a conflict rather than overwriting each other.

Manual applications use `CreatorVerification.purpose = IDENTITY`. The backend grants `User.isVerified` only after admin approval. It preserves the badge across profile reloads, authentication, and the historical paid-badge reconciliation worker. User-provided status and badge flags are ignored. Existing creator applications keep their original purpose and behavior.

## Private uploads

Uploads reuse the existing authenticated Cloudinary document storage and protected streaming endpoints. Configure the backend Cloudinary credentials already used by the app. These files must not be converted into public media URLs or served from `/uploads`. Supported files are JPEG, PNG, WebP and PDF up to the configured limit; selfies must be images. File signatures, types and sizes are checked on the server. The app does not collect a document number, full address, or bank details for this identity flow.

No real personal documents were submitted during development tests. Browser tests use fixtures; API tests use private-file metadata to exercise state transitions and authorization without sending a person's ID to storage.

Documents remain in private storage for review. This change does not claim automatic deletion after review; choose and enforce a retention policy before production launch.

## Separate bank and payment setup

Admin approval confirms identity for the @seen public seal. It does not satisfy a bank or payment provider's independent payout requirements. Existing bank setup still uses Stripe Connect and is separate from this manual verification journey; no financial account is marked ready by an admin identity decision.

Legacy Stripe identity records and signed-webhook handlers remain available for historical integrations, but the current Verification UI neither starts a Stripe session nor depends on `/identity` availability. New manual applications take precedence in identity-status responses. The former paid-seal purchase endpoint remains retired.

The pre-existing withdrawal engine is still a prototype ledger debit, not a live funds transfer. No live payout is enabled by this change. The financial transfer worker and full settlement/trust-level policy remain separate work.
