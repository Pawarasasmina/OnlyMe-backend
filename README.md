# OnlyMe Backend

Express API starter for the OnlyMe platform.

## Scripts

- `npm run dev`
- `npm start`
- `npm run lint`

## Endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Voice transcript translation

Voice note transcription remains handled by Deepgram. Transcript translation uses Lara Translate API through the backend only; React never calls Lara directly and no provider credentials are exposed to the browser.

Configure the backend with Lara credentials:

```env
LARA_ACCESS_KEY_ID=
LARA_ACCESS_KEY_SECRET=
```

Do not add `VITE_LARA_*` variables. Lara credentials belong only in the backend runtime environment. In Vercel, add `LARA_ACCESS_KEY_ID` and `LARA_ACCESS_KEY_SECRET` to the backend project environment variables.

The backend keeps the existing `GET /api/voice/translation-languages` and `POST /api/voice/translate` endpoints. Languages are Lara locale codes such as `fr-FR`, `es-ES`, `si-LK`, and `ta-IN`; older saved short codes such as `fr`, `es`, and `de` continue to render with friendly labels.

## Profile API

- `GET /api/profile/me` - fetch the authenticated user's role-based profile.
- `PATCH /api/profile/me` - update allow-listed editable profile fields for the authenticated user's role.
- `GET /api/profile/me/completion` - fetch profile completion progress.
- `GET /api/profile/username-availability?username=value` - check normalized username availability.
- `POST /api/profile/me/avatar` - upload a JPEG, PNG, or WebP profile photo with form field `avatar`; max 5 MB.
- `DELETE /api/profile/me/avatar` - remove the current profile photo.
- `POST /api/profile/me/cover` - creators only; upload a JPEG, PNG, or WebP cover photo with form field `cover`; max 8 MB.
- `DELETE /api/profile/me/cover` - creators only; remove the current cover photo.
- `GET /api/creators/:username` - fetch a public creator profile. Private or inactive creators return 404.
- `GET /api/fans/:username` - fetch a public fan profile when the fan has enabled public visibility.

Profile updates never accept role, status, verification approval, wallet, earnings, password, or system timestamps from clients.

## Internal Stars financial foundation

Phase 6A uses immutable `StarsLedgerEntry` records as the source of truth and `Wallet.balance` as a transactionally updated integer-Stars projection. Legacy `Transaction` and `Subscription` collections remain read-only compatibility data. Financial commands require a transaction-capable MongoDB deployment (replica set or managed cluster) and fail with `TRANSACTIONS_REQUIRED` on standalone MongoDB; they never use transaction fallback. Admin test credits are disabled unless `ENABLE_ADMIN_STAR_CREDITS=true` and are never automatic.

Read-only audits: `npm run analyze:financial-migration` and `npm run analyze:wallet-reconciliation`. These commands never create opening balances or change records. Resolve duplicate wallets, unsupported currency values, fractions, negatives, and projection mismatches manually before any approved migration.

## Internal account classification

Accounts are classified internally as `REAL`, `SEED`, or `TEST`; the default is `SEED`. The classification is admin-only and must not be exposed by public profile or creator APIs. REAL and SEED activity contributes to public counters and real financial reporting. TEST activity remains available for product and financial QA but uses isolated test wallet/ledger balances and is excluded from creator-facing earnings.

Inspect legacy users without writing: `npm run migrate:account-types:dry-run`. After a verified backup, apply the additive migration with `npm run migrate:account-types`. It only assigns `SEED` where `accountType` is missing or null and never changes an existing classification.
Profile uploads use a temporary local `uploads/` file before Cloudinary storage. Verification documents use authenticated Cloudinary assets and are streamed through authorized API endpoints. Content media uses Cloudinary directly.

## Content workflow

New content uses an explicit `DRAFT -> PENDING_REVIEW -> PUBLISHED | CHANGES_REQUESTED | REJECTED` workflow. Direct publishing is disabled. Creator mutations require an approved creator account; admin decisions use `/api/admin/content-moderation` and require a pending-review record. Subscriber-only and pay-per-view public responses are locked and omit protected media identifiers and URLs.

Content uploads use Cloudinary authenticated delivery and draft-specific signed uploads. Set `CONTENT_MAX_FILE_SIZE_BYTES`; protected delivery must remain configured as authenticated in Cloudinary. No subscription or PPV entitlement is granted in this phase.

Inspect legacy content without writing: `npm run migrate:content:dry-run`. Apply manually after review and backup: `npm run migrate:content`. The migration is never run during application startup.
# Structured publications (Phase 3)

The structured publication domain is separate from legacy `Content` and supports `SEEN`, `WORLD`, and `PREMIUM_WORLD` aggregates with ordered chapters. Submitted aggregates are frozen in an embedded snapshot and moderated as one container. Published editing is intentionally unavailable until a future revision workflow is implemented.

Creator APIs are mounted at `/api/publications`; admin moderation is mounted at `/api/admin/publication-moderation`. Paid kinds return preview-only public responses with `paymentAvailable: false`; no payment or entitlement behavior is simulated.

Legacy classification is analysis-only:

```sh
npm run analyze:publications -- --output=reports/publication-analysis.json
```

The report is written with create-only semantics and the command has no apply mode. Existing `Content` records are never modified.


## Wall need picker

`GET /api/posts/need-counts` requires the normal authenticated session. It accepts
`scope` and `location` (or `near` for nearby scope), using the same text-based area
matching as the Wall feed. With no area, counts are worldwide.

The response `data.counts` contains `need_help`, `looking_for`, `offering`,
`buy_sell`, `question`, `recommendation`, and `event`. Active means published,
public, not deleted, and unresolved. Hidden notes and blocked authors are excluded;
shares do not increase counts. Buy / Sell topic notes belong to `buy_sell` and are
excluded from `offering`. Legacy context categories remain supported.

Posting continues through `POST /api/posts`. New Buy & Sell notes use post type
`Buy & Sell`; topic remains independent. Existing Offering notes are not reclassified.

### Wall publication deployment and safeguards

Before deploying, run `node src/scripts/ensureWallCreationIndexes.js` in the backend
with its normal database configuration, then deploy/restart the API and frontend.
This creates the partial unique author/request-key index and the publication ledger
collection. It does not rewrite existing notes. Existing notes without request keys
remain valid. Ambiguous historical Offering + Buy / Sell records remain Offering;
any deliberate reclassification requires a separately reviewed backfill.

New Wall publications permit three images, one voice note (server-measured maximum
30 seconds), 2,000 text characters and one link. Text or voice is required. Other
upload limits and existing four-image records are unchanged.

`Idempotency-Key` accepts 8?100 letters, digits, underscores or hyphens. Repeating the
same key/payload returns the existing note; a changed payload is rejected. The UI
retains the key for an unchanged failed submission. An atomic per-user ledger reserves
at most five publications in a rolling 24 hours and rejects simultaneous duplicate
trimmed, case-insensitive text. Archived/deleted publications still consume quota.
Existing publications seed the ledger on first use. In-flight reservations count;
known failures release them. A process crash conservatively retains its reservation
until the 24-hour window ends; investigate the request key before manually releasing
such a reservation. Do not delete ledger entries to bypass quotas.

Active counts exclude resolved notes, Right now notes after 24 hours, and Events
after seven days, as well as hidden, blocked, archived and deleted notes. Closed notes
remain visible below active notes; they do not accept new replies. Expiry is computed
from the original publication timestamp, not from a share.

Draft text, topic, place, flags and File attachments are retained in memory across
route changes for the current account and cleared on logout, account switch, explicit
discard or publication. Browser refresh closes that in-memory session; this is not a
claim of durable draft persistence.

Tests: `node --test src/services/wallCreationService.test.js src/services/wallVoiceLimit.test.js
src/services/wallFeedFilterService.test.js src/controllers/wallNeedCounts.test.js
src/controllers/wallFeedController.test.js` (pass these paths on one command line).
The isolated database test uses mongodb-memory-server, never the application DB:
set `WALL_MONGO_INTEGRATION=1` and run
`node --test src/services/wallCreationConcurrency.integration.test.js`.
