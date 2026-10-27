# Animal.ua

Static frontend with a Node.js API backed by PostgreSQL. User accounts, profiles, pets, and care records are stored in PostgreSQL. Uploaded photos and documents are stored in the local `uploads/` directory and served through temporary signed links.

## Local run

1. PostgreSQL must be running and `DATABASE_URL` and `AUTH_SECRET` must be set in `.env`.
2. Run `npm install` to install the PostgreSQL driver.
3. Run `npm start` and open `http://localhost:3000` (not the `file:///` page). The server applies `postgres/schema.sql` and any unapplied files in `postgres/migrations/` at startup. Migration versions are recorded in `schema_migrations`.

The local database and role are named `animalua`. Keep `.env` private. Back up both the PostgreSQL database and `uploads/` directory.

## API

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- `GET` / `PATCH /api/profile`
- `GET` / `POST /api/pets`
- `PATCH` / `DELETE /api/pets/:id`
- `POST /api/photos`, `POST /api/photos/signed-url`, `POST /api/photos/delete`
- `POST /api/documents`, `POST /api/documents/signed-url`
- `GET /api/health` (includes PostgreSQL connectivity status)
