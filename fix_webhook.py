with open('src/store.ts', 'rb') as f:
    content = f.read()

# Add webhookEvents import
content = content.replace(
    b"metaConfig, supportTickets, auditLogs } from './db/schema.js'",
    b"metaConfig, supportTickets, auditLogs, webhookEvents } from './db/schema.js'"
)

# Add webhook_events SQL after audit_logs
pattern = b"CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);\r\n  `)"
replacement = b"""CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      headers JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'received',
      response_code INTEGER,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_source ON webhook_events(source);
    CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events(created_at);
  `)"""

content = content.replace(pattern, replacement)

# Add webhook_events to resetStore
content = content.replace(
    b"await pool.query('DELETE FROM support_tickets')",
    b"await pool.query('DELETE FROM support_tickets')\n  await pool.query('DELETE FROM webhook_events')"
)

with open('src/store.ts', 'wb') as f:
    f.write(content)

print('Added webhook_events table + SQL + import + resetStore')
