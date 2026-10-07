# Animal.ua

Static frontend with a Node.js API that proxies authentication and data access to Supabase. The browser never receives database credentials; API requests use the signed-in user's Supabase access token so Row Level Security remains active.

## Local run

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
2. Run `supabase/schema.sql` in the Supabase SQL Editor. It creates profile and pet tables, RLS policies, and a private `animal-photos` Storage bucket.
3. In Supabase Authentication settings, enable Email sign-in. Disable email confirmation if users should be able to sign in immediately after registration.
4. Run `npm start` and open `http://localhost:3000` (not the `file:///` page).

## API

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- `GET` / `PATCH /api/profile`
- `GET` / `POST /api/pets`
- `PATCH` / `DELETE /api/pets/:id`
- `POST /api/photos`, `POST /api/photos/signed-url`

Set `PORT`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` on the server to configure deployment. Keep `.env` private and use HTTPS in production.
