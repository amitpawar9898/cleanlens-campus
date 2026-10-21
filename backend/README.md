# SIT CleanLens Campus — Backend API

Node.js 18+ · Express · PostgreSQL · JWT auth · provider-based vision AI · private local image uploads.
The API workflow suite is `npm run smoke`; run it against a migrated, seeded PostgreSQL database.

## 1. Quick start

```bash
npm install
cp .env.example .env            # set DATABASE_URL, JWT_SECRET, SEED_ADMIN_EMAIL and a unique SEED_ADMIN_PASSWORD
createdb cleanlens              # or use docker compose (below)
npm run migrate                 # creates all tables
npm run seed                    # departments and configured admin only; no sample accounts, locations or complaints
npm start                       # API + web app at http://localhost:4000
npm run smoke                   # API workflow and authorization tests; server and PostgreSQL must be running
npm run test:ui                 # drives every screen; creates and cleans up isolated test records
```
Docker: `docker compose up --build` (runs Postgres + API, migrates automatically; then `docker compose exec api node db/seed.js`).

The configured `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` create the first administrator account. Choose a unique password with at least 12 characters. No fixed sample logins or fictional records are created. Student self-registration is on by default and accepts any valid email address with a password of at least 8 characters. Set `PUBLIC_REGISTRATION=false` to turn it off. Public registration always creates a student account; admin accounts come from the seed settings, and admins create staff and cleaner accounts. Do not use placeholder settings from `.env.example` as production credentials.

An existing database may already contain rows created by the old demo seeder. Back up that database, then remove matching legacy sample complaints, unused old starter buildings and unused legacy demo accounts with `npm run clean:demo -- --confirm`. The cleanup command uses an explicit confirmation flag, preserves the configured bootstrap admin, and retains any account/building with other complaints, tasks or inspections.

## 1b. The web app
`public/index.html` is the finished front end, served by the same server at `http://localhost:4000/`. The responsive forest-green interface gives admins, cleaners, staff and students distinct dashboards and navigation; the top-bar search filters the current page's rows and task cards. All 9 screens plus Notifications, Profile and Admin read and write through this API (no browser-only data). It works on phones (bottom tab bar). Open it from another device with `http://<your-computer-ip>:4000`, or host it over HTTPS for camera and GPS.
- Students see Dashboard, Report Issue, Complaints, Inspections, Map, Notifications and Profile. Cleaners have a dedicated Dashboard, Cleaning Tasks, Notifications and Profile navigation. Staff see department-scoped complaints and verification; admins manage users, locations, assignments, analytics and reports.
- A new database has no campus locations until the admin configures them. Add buildings and spots before students submit location-specific complaints.
- Photo analysis calls `POST /ai/analyze`. Configure `AI_PROVIDER` and a provider key for server-side OpenAI, Gemini, or Claude vision. Optional Ollama uses a configured local vision model. If no server provider is configured, the student report flow can fall back to the on-device YOLO11 model (limited to 80 everyday objects).
- Cleaner task details show the student description and private complaint photo. The cleaner records all five checklist items and uploads required BEFORE and AFTER photos before submitting work for review. Supervisors/admins approve or return work with a correction reason.
- Google and Microsoft sign-in buttons are not connected; use email and password or OTP.

## 1c. Mobile app and browser
- **Browser:** open the server address on any computer or phone.
- **Phone app (PWA, recommended):** open the HTTPS address on the phone. Android Chrome shows an **Install app** button (top bar) or the browser's install prompt. On iPhone use Safari → Share → **Add to Home Screen**. It then opens full screen with its own icon, like a normal app. The app shell works offline; reports, photos and data still need a connection (nothing private is cached).
- **Store app (optional):** `mobile/` contains a ready Capacitor project that wraps the hosted site as an Android APK or iOS app. Steps are in `mobile/README.md`.
- HTTPS is required for install, camera and GPS (localhost counts as secure for testing).

## 1d. Detection model and licence
`public/models/yolo11n.onnx` is the YOLO11n object-detection model (80 everyday objects) served by your own server, so the browser never downloads it from a third party. It is released by Ultralytics under **AGPL-3.0** (see `public/models/LICENSE-YOLO11-AGPL3.txt`). That is fine for a college project; check the licence before publishing the app commercially. To use a model trained on waste photos, replace the file (or set a model URL and class names in Admin → AI settings).

## 1e. Login campus photos and deep-learning report
The login page includes official SIT Pune campus-life photos and links to `public/deep-learning-report.html`. The report describes the currently bundled COCO YOLO model, browser inference, optional Gemini fallback, limitations, and the training/evaluation workflow. It does not claim project-specific metrics because no labeled dataset or evaluation results are included.

## 1e. Login background photo
Save your wide, high-resolution college photo as `public/campus.jpg` to show it on the login screen for everyone. Admin → Appearance can also set one for a single browser.

## 1f. Complaint-to-cleaner workflow
- A student submits a description, location and at least one photo. The database generates a `CLN-…` complaint ID and records the initial status **Submitted**. The student and authorized admin/department staff receive database-backed notifications.
- Admin/staff review the report (and its private photos), then mark it **Reviewed** before creating a task. Task assignment, complaint status, task history, audit entry and notifications are committed together. The assignment can include instructions and a deadline.
- Cleaners only see their own tasks. A task includes complaint details/photos, location, priority, deadline and a five-item checklist. `PATCH /tasks/:id/start` starts work; `PATCH /tasks/:id/checklist` saves checklist progress.
- `POST /tasks/:id/complete` requires every checklist item plus both `before_photo` and `after_photo`. The task becomes **Submitted for Verification** and the complaint **Pending Verification**. A cleaner cannot approve work.
- Admin or staff in the complaint's department verifies with `POST /tasks/:id/verify` and `{approve:true}` or `{approve:false, reason}`. Approval marks the task **Verified**, resolves the complaint and notifies the student. A correction request marks the task **Correction Required**, keeps the complaint in progress, and notifies the cleaner with the review note so work can be resubmitted.
- Deadline reminders notify cleaners within 24 hours of a deadline; overdue tasks notify active admins. The backend checks reminders every 15 minutes while it is running.
- Task transitions and checklist changes are persisted in `task_events`; the assignment, submission, notifications and verification decision use database transactions.
- Photos are never public. Complaint, task and inspection responses contain short-lived signed links (`/files/<name>?exp=…&sig=…`, valid 15 minutes). `/uploads/…` returns 404.
- `GET /api/admin/audit` lists admin and verification actions (admin only).

## 2. Project layout
```
db/schema.sql      tables · db/migrate.js · db/seed.js
src/server.js      app, security headers, CORS, rate limits, route mounting
src/config.js      env settings         src/db.js         pg pool
src/middleware/    auth (JWT + roles) · upload (multer) · error (uniform errors)
src/services/      provider adapters (OpenAI/Gemini/Claude/Ollama) · sms · notify · scoring
src/routes/        auth users locations complaints tasks inspections ai notifications analytics admin
public/            index.html (the complete web app, mobile friendly) · api-client.js (standalone client)
test/smoke.js      end-to-end test
```

## 3. Concepts

**Roles:** `student` (reports and tracks own complaints) · `cleaner` (does assigned tasks) · `staff` (department staff: sees and manages complaints of their department) · `admin` (everything).

**Department routing (automatic):** Cleaning → Housekeeping · Maintenance → Maintenance · Waste → Waste Management · Pest → Pest Control · Other → Admin Office. Changing a complaint's category re-routes it. Admins and staff of that department are notified when a complaint arrives.

**Complaint status flow** (invalid jumps return 400):
`Submitted → Reviewed → Assigned → In Progress → Pending Verification → Resolved` · `Resolved/Closed → Reopened`.
Authorized reviewers can reject a complaint with a reason. Invalid status jumps return 400. Task submission does not resolve a complaint: only supervisor/admin verification does.

**Visibility:** student = own complaints · cleaner = assigned to them · staff = their department · admin = all.

**Cleanliness score:** each building starts at 100. Open complaints subtract Low 3, Medium 6, High 10, Critical 15 (minimum 30). Levels: ≥85 Good · ≥70 Needs Attention · ≥55 Poor · else Critical. Campus score = average of buildings.

**Auth:** short-lived access token (15 min, `Authorization: Bearer <token>`) + rotating refresh token (30 days). Refresh tokens are stored hashed and become invalid after one use.

## 4. Conventions
- JSON requests (`Content-Type: application/json`) except uploads (`multipart/form-data`). Images: JPG/PNG/WEBP, max 5 MB, max 5 per request.
- Lists are paginated: `?page=1&limit=20` → `{ page, limit, total, items }`.
- Errors always: `{ "error": "message" }`; validation errors add `"details":[{"field","message"}]`.
- Status codes: 200/201 ok · 400 validation · 401 not logged in · 403 wrong role · 404 not found · 409 duplicate · 429 rate limit · 502/503 AI provider.
- Uploaded files are served at `/uploads/<file>`.

## 5. API reference
Base URL `http://localhost:4000/api`. "Auth" column: **—** public, **any** logged-in, or the roles allowed.

### 5.1 Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | — | `{ok, ai, ai_provider, registration_enabled, time}`. No secret values are returned. |

### 5.2 Auth  (rate limited to 20 requests/min)
| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | /auth/register | — | `{name, email, password(min 8), phone?}` → 201 tokens. Always creates a **student**. |
| POST | /auth/login | — | `{email, password}` → `{access_token, refresh_token, token_type, user}` |
| POST | /auth/forgot-password | — | `{email}`; generic response prevents account enumeration; sends a one-use 30 minute reset link when configured |
| POST | /auth/reset-password | — | `{token,new_password}`; consumes token and revokes active refresh sessions |
| POST | /auth/refresh | — | `{refresh_token}` → new token pair (old one is revoked) |
| POST | /auth/logout | — | `{refresh_token}` → `{ok:true}` |
| POST | /auth/otp/request | — | `{phone}` → `{ok, expires_in:300}`. Sends a 6-digit SMS (max 3 per 10 min). Always answers ok, so it does not reveal which phones exist. With `SMS_PROVIDER=console` in development the response also includes `dev_code`. |
| POST | /auth/otp/verify | — | `{phone, code}` → token pair. 5 wrong attempts invalidate the code. |
| GET | /auth/me | any | current user |
| PATCH | /auth/me | any | `{name?, phone?}` |
| POST | /auth/change-password | any | `{current_password, new_password}`; revokes all refresh tokens |

```bash
curl -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"your-registered-account@example.edu","password":"your-password"}'
```

### 5.3 Users & departments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /users/departments | any | list departments |
| POST | /users/departments | admin | create a department from `{name}` |
| PATCH | /users/departments/:id | admin | rename a department |
| DELETE | /users/departments/:id | admin | delete only when it has no users or complaints |
| GET | /users/cleaners | admin, staff | active cleaners (for assignment dropdowns) |
| GET | /users | admin | `?role=&q=&page=&limit=` |
| POST | /users | admin | `{name,email,password,role,phone?,department_id?}` create any role |
| PATCH | /users/:id | admin | `{name?,phone?,role?,department_id?,is_active?,password?}` |
| DELETE | /users/:id | admin | disables the account (soft delete) and revokes its tokens |

### 5.4 Locations & map
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /locations/buildings | any | buildings with assigned department and `spots:[{id,floor,name,location_type,is_active}]` (feeds the report form dropdowns) |
| GET | /locations/map | any | `[{id,name,lat,lng,open_complaints,score,level}]` for the campus map |
| POST | /locations/buildings | admin | `{name, lat?, lng?, department_id?}` |
| PATCH | /locations/buildings/:id | admin | `{name?, lat?, lng?, department_id?}` |
| PATCH | /locations/buildings/:id/active | admin | toggle active state |
| DELETE | /locations/buildings/:id | admin | deactivate building, preserving complaint history |
| POST | /locations/buildings/:id/spots | admin | `{floor?, name, location_type?}` |
| PATCH | /locations/spots/:id | admin | edit name, floor, type or active state |
| DELETE | /locations/spots/:id | admin | deactivate spot |

### 5.5 Complaints
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /complaints | student | **multipart**: `photos` (at least one; up to 5 files) + `description` (5–2000 chars) and fields `title?, category?, priority?, building_id?, spot_id?, lat?, lng?, ai?`. Returns a **Submitted** complaint with its `code` (CLN-0001…). |
| GET | /complaints | any | filters `status, category, priority, building_id, q, assigned_to_me=true, sort=oldest` + pagination. Role-scoped (see Visibility). |
| GET | /complaints/:id | any | full detail: `photos`, `events` (timeline), latest `task` |
| PATCH | /complaints/:id | admin, staff | `{status?, priority?, category?, note?}` — reviews/rejects/reopens a complaint; task states are changed through the task workflow |
| POST | /complaints/:id/comments | any | `{note}` adds a timeline comment and notifies the other party |
| POST | /complaints/:id/feedback | student | `{rating 1-5, comment?}` only after Resolved/Closed |
| DELETE | /complaints/:id | admin | |

```bash
curl -X POST localhost:4000/api/complaints -H "Authorization: Bearer $TOKEN" \
  -F description="Overflowing bin" -F category=Waste -F priority=High \
  -F building_id=4 -F spot_id=8 -F lat=18.5979 -F lng=73.7392 -F photos=@bin.jpg
```

### 5.6 Cleaning tasks
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /tasks | admin, staff | `{complaint_id, cleaner_id, instructions?, due_at?(ISO)}` creates a task only after review, sets the complaint to Assigned, and transactionally records history and notifications |
| GET | /tasks | cleaner, staff, admin | Cleaners see only their own; staff are limited to their department. Returns assignment details, signed complaint photos, checklist, status and counts. |
| GET | /tasks/:id | cleaner (own), staff (own department), admin | Full task details, signed evidence and task transition history. |
| PATCH | /tasks/:id | staff (own department), admin | Update cleaner, instructions or deadline; records history and notifies the cleaner. |
| PATCH | /tasks/:id/start | cleaner (own task) | Assigned / Correction Required → In Progress; complaint becomes In Progress. |
| PATCH | /tasks/:id/checklist | cleaner (own task) | `{checklist:[{id,completed}]}` saves the five-item checklist while work is in progress. |
| POST | /tasks/:id/complete | cleaner (own task) | **multipart**: required `before_photo` and `after_photo`, plus `notes?`. Requires all checklist items complete; sets **Submitted for Verification**, not resolved. |
| POST | /tasks/:id/verify | staff (own department), admin | `{approve:true}` or `{approve:false,reason}`. Approval resolves the complaint; rejection returns the task to **Correction Required**. |

### 5.7 AI (server-side provider adapters; 15 requests/min)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /ai/analyze | any | **multipart** `image`. Returns `{relevant, condition, confidence, issues[{name,severity,confidence}], category, priority, title, description, building, floor, spot, building_id, spot_id, mode}`. It only reports what is visible and says `relevant:false` for non-campus photos. Without a key: **503**. |
| POST | /ai/compare | any | **multipart** `before` + `after` → `{before_score, after_score, improvement, notes}` |
| GET | /ai/providers/status | any | configured provider names, models and capability status; never returns credentials |

Typical flow in the app: user takes a photo → `POST /ai/analyze` → form is pre-filled → user edits → `POST /complaints` with the same photo and `ai=<json>`.

### 5.8 Inspections (admin, staff, cleaner)
| Method | Path | Description |
|---|---|---|
| POST | /inspections | **multipart** `image`, `building_id?`, `spot_id?` — saves the photo, runs AI when configured, stores condition/confidence |
| GET | /inspections | history (paginated) |
| GET | /inspections/:id | one inspection with full AI JSON |
| PATCH | /inspections/:id/checklist | admin/staff save the five inspection checks and calculate a score |
| POST | /inspections/:id/feedback | admin/staff save confirmed, corrected or rejected AI findings |

### 5.9 Notifications (own only)
| Method | Path | Description |
|---|---|---|
| GET | /notifications | `?unread=true&page=&limit=` → `{unread, items}` (drives the bell badge) |
| PATCH | /notifications/:id/read | |
| POST | /notifications/read-all | |
| DELETE | /notifications/:id | |

Created automatically for: complaint submission (student, admin and department staff), review/status changes and assignment (reporter), new/reassigned task and approaching deadline (cleaner), correction/approval (cleaner), resolution (student), and overdue tasks (admin).

### 5.10 Analytics (admin, staff)
| Method | Path | Returns |
|---|---|---|
| GET | /analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD | `{total, open, in_progress, resolved, avg_resolution_hours, avg_rating, campus_score, campus_level, locations_requiring_attention, locations_monitored}` |
| GET | /analytics/by-category?from=…&to=… | `[{category,count}]` |
| GET | /analytics/by-priority?from=…&to=… | `[{priority,count}]` |
| GET | /analytics/timeseries?days=7 or `?from=…&to=…` | `[{day,submitted,resolved}]` |
| GET | /analytics/locations | active campus areas ranked by configured score |
| GET | /analytics/cleaners | tasks, completed and average quality improvement per cleaner |
| GET | /analytics/scoring | admin only; read active version and factors |
| PUT | /analytics/scoring | admin only; create and activate a validated scoring version |

### 5.11 Admin
| Method | Path | Description |
|---|---|---|
| GET | /admin/export/complaints.csv?from=…&to=… | date-filtered complaints as CSV |

## 6. Screen → API mapping
| Screen | Calls |
|---|---|
| Login / Register | `POST /auth/login`, `/auth/register`, `/auth/otp/*` |
| Dashboard | `GET /analytics/summary`, `GET /complaints?limit=5` |
| Report Issue | `GET /locations/buildings`, `POST /ai/analyze`, `POST /complaints` |
| Complaints | `GET /complaints`, `PATCH /complaints/:id`, `POST /tasks` |
| AI Inspection | `POST /inspections` (or `/ai/analyze`) |
| Campus Map | `GET /locations/map` |
| Cleaner tasks | `GET /tasks`, `PATCH /tasks/:id/start`, `POST /tasks/:id/complete` |
| Before / After | `GET /complaints/:id` (photos kind `before`/`after`), `POST /ai/compare` |
| Analytics | `/analytics/*` |
| Notifications | `GET /notifications`, `POST /notifications/read-all` |
| Admin | `/users`, `/locations/*`, `/admin/export/complaints.csv` |

Use `public/api-client.js` in the front end: it adds the token, refreshes it on 401 and wraps uploads.

## 7. Configuration (.env)
`DATABASE_URL`, `JWT_SECRET` (required in production), `ACCESS_TTL`, `REFRESH_DAYS`, `PUBLIC_REGISTRATION` (defaults false), `CORS_ORIGIN` (comma list, or `*` in development), `UPLOAD_DIR`, `AI_PROVIDER` (`auto|openai|google|anthropic|ollama`), `OPENAI_API_KEY` / `OPENAI_MODEL`, `GOOGLE_API_KEY` / `GEMINI_MODEL`, `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, `OLLAMA_BASE_URL` / `OLLAMA_MODEL`, `EMAIL_PROVIDER` (`console|resend`), `EMAIL_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL`, and `SMS_PROVIDER` (`console|twilio|fast2sms`) with `TWILIO_*` or `FAST2SMS_KEY`. Configure Resend email for production password resets; console mode returns a reset token only in development.
Fast2SMS in India needs DLT-approved templates for transactional messages; adjust `src/services/sms.js` to your approved route.

## 8. Going live checklist
1. Strong `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN=https://your-app-domain`.
2. Change or delete all seeded passwords.
3. HTTPS (Nginx/Caddy/Render/Railway). Camera and GPS in the phone browser only work over HTTPS.
4. Back up PostgreSQL. Move uploads to S3/Cloudinary if you run more than one server (`src/middleware/upload.js` is the only place that writes files).
5. Run behind a process manager (PM2, systemd) or use the Dockerfile.
6. Tell users photos are stored, and don't upload images of people.

## 9. Known limits (honest list)
- AI quality depends on the configured vision model; results are suggestions that a human confirms. It never judges health or disease. Without a server AI provider, student reporting can use a limited on-device object model.
- Local file storage is for development; use private object storage and backups for production deployments.
- No email sending or WebSocket push; notifications are persisted and pulled with `GET /notifications`.
- Roles `staff`/`cleaner` are created by an admin; there is no self-service role change.
# Recent API additions

- Analytics endpoints accept optional `from=YYYY-MM-DD` and `to=YYYY-MM-DD` query parameters: `/api/analytics/summary`, `/api/analytics/by-category`, `/api/analytics/by-priority`, `/api/analytics/timeseries`. Ranges are validated; timeseries ranges are limited to 366 days.
- Admin complaint export accepts the same date parameters: `/api/admin/export/complaints.csv?from=2026-01-01&to=2026-01-31`.
- Campus spots now store `location_type` (`Classroom`, `Laboratory`, `Washroom`, `Hostel`, `Canteen`, `Library`, `Office`, `Outdoor`, `Other`) and active state. `PATCH /api/locations/spots/:id` edits them; DELETE deactivates. `PATCH /api/locations/buildings/:id/active` toggles building active state; DELETE deactivates.

