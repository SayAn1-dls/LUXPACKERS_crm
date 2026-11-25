CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','hr','employee')),
  dept TEXT NOT NULL,
  manager_id TEXT REFERENCES users(id),
  title TEXT,
  phone TEXT,
  kind TEXT CHECK (kind IN ('Full-time','Intern','Freelancer')),
  joined_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','onboarding','left')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  dept TEXT,
  assignee_id TEXT REFERENCES users(id),
  assigned_by_id TEXT REFERENCES users(id),
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'To do'
    CHECK (status IN ('To do','In progress','Waiting','Blocked','Submitted','Done')),
  due TEXT,
  waiting_on TEXT,
  links TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_dept_status ON tasks(dept, status);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','sent_back','approved')),
  created_at TEXT NOT NULL
);

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  dept TEXT,
  owner_id TEXT REFERENCES users(id),
  title TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_records_collection ON records(collection, deleted_at);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('Casual','Sick','Earned','Unpaid')),
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  days REAL NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  note TEXT
);

CREATE TABLE onboarding (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  step TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_by TEXT REFERENCES users(id),
  done_at TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  title TEXT,
  detail TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_attempts (
  email TEXT,
  at TEXT
);

INSERT INTO settings (key, value) VALUES
  ('leave_allowances', '{"Casual":12,"Sick":6,"Earned":15}'),
  ('holidays', '[]');
