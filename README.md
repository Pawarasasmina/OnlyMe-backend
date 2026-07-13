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
Uploaded files are stored in the existing local `uploads/` directory and exposed through `/uploads/:filename`.
