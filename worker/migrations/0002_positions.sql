-- Positions replace the four fixed roles as the source of permissions. users.role stays as a display label.
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  perms TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO positions (id, name, is_admin, perms, created_at, updated_at) VALUES
  ('pos_admin', 'Admin', 1,
   '{"tasks":"all","registers":{"leads":"manage","bookings":"manage","trips":"manage","finance":"manage","partners":"manage","content":"manage","access":"manage"},"leave":"all","people":"full","addPeople":true}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('pos_manager', 'Manager', 0,
   '{"tasks":"team","registers":{"leads":"manage","bookings":"manage","trips":"manage","finance":"none","partners":"manage","content":"manage","access":"none"},"leave":"team","people":"basic","addPeople":false}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('pos_hr', 'HR', 0,
   '{"tasks":"own","registers":{"leads":"none","bookings":"none","trips":"none","finance":"none","partners":"none","content":"none","access":"none"},"leave":"all","people":"full","addPeople":true}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('pos_employee', 'Employee', 0,
   '{"tasks":"own","registers":{"leads":"edit","bookings":"edit","trips":"edit","finance":"none","partners":"edit","content":"edit","access":"none"},"leave":"own","people":"basic","addPeople":false}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE users ADD COLUMN position_id TEXT REFERENCES positions(id);

UPDATE users SET position_id = CASE role
  WHEN 'admin' THEN 'pos_admin'
  WHEN 'manager' THEN 'pos_manager'
  WHEN 'hr' THEN 'pos_hr'
  ELSE 'pos_employee'
END;

CREATE INDEX idx_users_position ON users(position_id);
