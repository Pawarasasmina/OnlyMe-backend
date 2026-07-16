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
Profile uploads use a temporary local `uploads/` file before Cloudinary storage; verification documents use separate private local storage. Content media uses Cloudinary directly.

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
