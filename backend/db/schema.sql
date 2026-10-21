CREATE TABLE IF NOT EXISTS departments(id serial PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users(
  id serial PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, phone text UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student','staff','cleaner','admin')),
  department_id int REFERENCES departments(id), is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS refresh_tokens(
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS password_resets(
  id serial PRIMARY KEY,user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id,expires_at);
CREATE TABLE IF NOT EXISTS otp_codes(
  id serial PRIMARY KEY, phone text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS buildings(id serial PRIMARY KEY, name text UNIQUE NOT NULL, lat double precision, lng double precision, is_active boolean NOT NULL DEFAULT true, department_id int REFERENCES departments(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS spots(
  id serial PRIMARY KEY, building_id int NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor text NOT NULL DEFAULT 'Ground Floor', name text NOT NULL, location_type text NOT NULL DEFAULT 'Other', is_active boolean NOT NULL DEFAULT true, UNIQUE(building_id, floor, name));
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS department_id int REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'Other';
ALTER TABLE spots ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE SEQUENCE IF NOT EXISTS complaint_code_seq;
CREATE TABLE IF NOT EXISTS complaints(
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL DEFAULT ('CLN-' || lpad(nextval('complaint_code_seq')::text, 4, '0')),
  title text NOT NULL, description text,
  category text NOT NULL DEFAULT 'Other' CHECK (category IN ('Cleaning','Maintenance','Waste','Pest','Other')),
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Assigned','In Progress','Resolved','Closed')),
  building_id int REFERENCES buildings(id) ON DELETE SET NULL, spot_id int REFERENCES spots(id) ON DELETE SET NULL,
  lat double precision, lng double precision,
  department_id int REFERENCES departments(id), reporter_id int NOT NULL REFERENCES users(id),
  assigned_to int REFERENCES users(id), ai jsonb,
  feedback_rating int CHECK (feedback_rating BETWEEN 1 AND 5), feedback_comment text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz);
CREATE INDEX IF NOT EXISTS idx_c_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_c_reporter ON complaints(reporter_id);
CREATE INDEX IF NOT EXISTS idx_c_assigned ON complaints(assigned_to);
CREATE INDEX IF NOT EXISTS idx_c_building ON complaints(building_id);
CREATE INDEX IF NOT EXISTS idx_c_created ON complaints(created_at);
CREATE TABLE IF NOT EXISTS complaint_photos(
  id serial PRIMARY KEY, complaint_id int NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  url text NOT NULL, kind text NOT NULL DEFAULT 'report', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS complaint_events(
  id serial PRIMARY KEY, complaint_id int NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id int REFERENCES users(id), type text NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks(
  id serial PRIMARY KEY, complaint_id int NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  cleaner_id int NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned','In Progress','Completed')),
  instructions text, due_at timestamptz, started_at timestamptz, completed_at timestamptz,
  before_url text, after_url text, before_score int, after_score int, notes text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_t_cleaner ON tasks(cleaner_id, status);
CREATE TABLE IF NOT EXISTS notifications(
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, body text, data jsonb, is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_n_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS inspections(
  id serial PRIMARY KEY, inspector_id int NOT NULL REFERENCES users(id),
  building_id int REFERENCES buildings(id) ON DELETE SET NULL, spot_id int REFERENCES spots(id) ON DELETE SET NULL,
  image_url text, ai jsonb, condition text, confidence int, score int CHECK(score BETWEEN 0 AND 100), checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by int REFERENCES users(id), review_note text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS score int CHECK(score BETWEEN 0 AND 100);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS reviewed_by int REFERENCES users(id);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS review_note text;
CREATE TABLE IF NOT EXISTS scoring_configs(
  id serial PRIMARY KEY, version int NOT NULL UNIQUE, factors jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false, created_by int REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO scoring_configs(version,factors,active) VALUES(1,'{"Low":3,"Medium":6,"High":10,"Critical":15,"floor":30}',true)
ON CONFLICT(version) DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_feedback(
  id serial PRIMARY KEY, inspection_id int NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users(id), decision text NOT NULL CHECK(decision IN ('confirmed','corrected','rejected')),
  original jsonb, corrected jsonb, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_inspections_spot_created ON inspections(spot_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_score ON inspections(score);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('Assigned','In Progress','Submitted for Verification','Verified','Correction Required','Rejected','Completed'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by int REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_status_check CHECK (status IN ('Submitted','Open','Reviewed','Assigned','In Progress','Pending Verification','Resolved','Closed','Rejected','Reopened'));
ALTER TABLE complaints ALTER COLUMN status SET DEFAULT 'Submitted';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS task_events(
  id serial PRIMARY KEY, task_id int NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id int REFERENCES users(id), from_status text, to_status text, note text,
  detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id);
UPDATE tasks SET checklist='[
  {"id":"inspect","label":"Inspect the reported area","completed":false},
  {"id":"debris","label":"Remove waste and visible debris","completed":false},
  {"id":"surfaces","label":"Clean and disinfect affected surfaces","completed":false},
  {"id":"supplies","label":"Restock supplies where needed","completed":false},
  {"id":"safety","label":"Check the area is safe and ready to use","completed":false}
]'::jsonb WHERE checklist='[]'::jsonb AND status IN ('Assigned','In Progress','Rejected','Correction Required');
INSERT INTO task_events(task_id,to_status,note)
  SELECT t.id,t.status,'Task recorded before task-history support was added' FROM tasks t
  WHERE NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id=t.id);
CREATE TABLE IF NOT EXISTS audit_log(id serial PRIMARY KEY, actor_id int REFERENCES users(id), action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
