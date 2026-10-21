# SIT CleanLens implementation status

This describes the checked-in code and checks run during the current implementation pass. It does not claim the application has been deployed or that database-backed flows passed without a running PostgreSQL instance.

## Implemented

- Existing Express, PostgreSQL and single-page web app retained.
- Administrator, staff/supervisor, cleaner and student roles with server-side endpoint checks.
- Student reports with validated private image uploads, location selection, history, comments, notifications and feedback.
- Review, assignment, cleaner checklist, before/after evidence and supervisor verification workflow.
- Admin departments and area assignments, typed/active campus locations, audit history and role-specific dashboards.
- Saved inspections with five-point checklists, location scores, versioned configurable scoring, cleanliness rankings and human review of AI findings.
- Analytics pages use API data and support date-filtered reports and CSV exports.
- Password reset uses expiring, one-use tokens; student self-registration is enabled by default and can be disabled with `PUBLIC_REGISTRATION=false`. Public registration cannot create an admin account.
- Vision adapters for Anthropic, OpenAI, Gemini and Ollama. Credentials stay on the server. Provider configuration is shown without exposing secrets.
- Sensitive API groups have route-level rate limits. Photo links are private and time-limited.
- Docker, seed and setup files remain in the repository.

## Checks run

- JavaScript syntax checks passed for changed route, service, test and web workflow files.
- Inline JavaScript in `public/index.html` parses successfully.
- `npm run test:ai` passed with mocked Anthropic, OpenAI, Gemini and Ollama responses, plus the missing-configuration case.
- The UI test setup provisions its student through the admin API and derives its app origin from `API`.
- `npm run smoke`, `npm run test:ui` and `npm run migrate` still require PostgreSQL and a seeded administrator. PostgreSQL was not listening on localhost:5432, and Docker Desktop's engine was inaccessible in this session, so database-backed workflows have not been verified here.

## Remaining deployment work

- Start PostgreSQL, run migrations and seed a configured administrator; then run `npm run smoke` and `npm run test:ui` against this checkout.
- Configure and live-test the selected AI provider, email reset delivery, SMS delivery, HTTPS and production secrets.
- Production S3-compatible storage is not implemented; this package currently uses private local disk storage.
- Choose and train a cleanliness-specific vision model if the limited stock on-device YOLO model is not sufficient.
