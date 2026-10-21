# SIT CleanLens Campus — Project package

Smart campus cleanliness and complaint platform for Symbiosis Institute of Technology, Pune.
Report a problem with a photo → AI detects the issue and fills the form → admin reviews and assigns a cleaner → cleaner completes the checklist and uploads before/after photos → admin verifies the work → student is notified.

## What is inside
| Folder | What it is | When to use it |
|---|---|---|
| `standalone/SIT_CleanLens.html` | A lightweight launcher that connects to the live backend and opens its portal. It contains no complaint or account dataset. | Launch the backend-connected app from a file or static host. |
| `backend/` | The real system: Node.js + Express + PostgreSQL API, the same web app wired to it, phone-install support (PWA), Docker files, tests, full API docs. | Real use with shared data for many students, cleaners and admins. |

## Run the backend-connected system
```
cd backend
npm install
Copy-Item .env.example .env  # PowerShell; set PostgreSQL URL, JWT_SECRET and your admin credentials
npm run migrate
npm run seed                 # adds departments and one configured admin; no sample complaints/users/locations
npm start                    # open http://localhost:4000
```
Set `SEED_ADMIN_EMAIL` and a unique `SEED_ADMIN_PASSWORD` (at least 12 characters) in `.env` before seeding. Student self-registration is enabled by default: students can create accounts with any valid email address and a password of at least 8 characters. `PUBLIC_REGISTRATION=false` disables it. Admin accounts are never created through public registration; create the first one through the seed settings, then admins can create staff and cleaner accounts. Add campus buildings, assign departments and configure areas under Admin → Locations. No fixed demo passwords or sample complaints are created.

To use Docker, start Docker Desktop and run `docker compose up --build`, then seed the database with `docker compose exec api node db/seed.js`. The standalone launcher asks for a backend address (by default `http://localhost:4000`) and opens that server's live portal.

Tests: `npm run test:ai`, `npm run test:detection`, and `npm run test:syntax` run without credentials or a database. `npm run smoke` and `npm run test:ui` require a running, migrated PostgreSQL backend and a configured admin account. To remove legacy sample records from an existing database, back it up and explicitly run `npm run clean:demo -- --confirm`. Full setup and API reference: `backend/README.md`.
For Gemini inspection fallback, set `GEMINI_API_KEY` in `backend/.env`, keep `ENABLE_GEMINI_FALLBACK=true`, and enable cloud assistance on the inspection page. The uploaded image is sent to Gemini only when cloud assistance is enabled (unless `GEMINI_VERIFY_ALL=true`) and local detection is incomplete. Keys stay on the server. For other provider based photo analysis set `AI_PROVIDER` and the matching server credential in `.env` (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, or `ANTHROPIC_API_KEY`). Optional local Ollama support is available with a vision capable model. Without a configured server provider, the student report flow can use the on-device YOLO11 model.

The stock on-device model uses COCO classes and is not trained for campus dirt or every fruit type. An administrator can set a compatible custom YOLO ONNX model URL and its comma-separated class names under **Admin → AI settings**; these settings stay in that browser. Custom models must accept 640 × 640 input and return `[1, 4 + classes, 8400]`. To recognize additional fruit reliably, train/export a YOLO detection model using labeled images first; adding class names alone does not train the model. Inspection AI findings are now stored with the inspection, and students can view their own inspection history. Add buildings and areas in **Admin → Locations**; enter each building's latitude and longitude for accurate map positioning.

The backend complaint workflow starts at **Submitted**. An admin or department staff member reviews each report before assigning a cleaner, instructions and an optional deadline. Cleaners complete the persisted checklist and upload both before- and after-cleaning photos; only an authorized reviewer can verify the work or return it for correction. Notifications and task/complaint history are stored in PostgreSQL. Run the updated API and UI tests against a running, migrated and seeded database.

## Phone app
Host the backend over HTTPS. Android Chrome then offers **Install app**; on iPhone use Safari → Share → Add to Home Screen. A native Android/iOS wrapper is in `backend/mobile/` (see its README). Camera and GPS need HTTPS.

## Honest status
See `STATUS.md` for the module-by-module checklist (Implemented / Tested / Not implemented).

- The standalone launcher is not a data demo; the PostgreSQL-backed app is the source of truth for accounts, reports and tasks.
- Implemented: role-scoped complaint and task workflows, inspections with review checklists, department and location administration, live analytics and filters, saved AI feedback, password recovery, provider-based image analysis and private signed photo links.
- Remaining: run the database-backed suites against PostgreSQL, configure production services and HTTPS, configure private S3-compatible object storage, and test any chosen live AI/email/SMS provider credentials.
- On-device YOLO detections are a limited fallback; they are not trained specifically for campus waste.
