with open('src/store.ts', 'rb') as f:
    content = f.read()

# Find the end of support_tickets SQL and add audit_logs after it
pattern = b"CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status);\r\n  `)"
replacement = b"""CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      action TEXT NOT NULL,
      target TEXT,
      target_type TEXT,
      details JSONB NOT NULL DEFAULT '{}',
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `)"""

if pattern in content:
    content = content.replace(pattern, replacement)
    with open('src/store.ts', 'wb') as f:
        f.write(content)
    print('Added audit_logs CREATE TABLE SQL')
else:
    print('Pattern not found')
    # Try to find what's there
    idx = content.find(b'idx_support_status')
    if idx > 0:
        print(content[idx:idx+100])
