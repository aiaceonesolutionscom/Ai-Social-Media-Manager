with open('src/store.ts', 'rb') as f:
    content = f.read()

# Add scheduledPosts import
content = content.replace(
    b"metaConfig, supportTickets, auditLogs, webhookEvents } from './db/schema.js'",
    b"metaConfig, supportTickets, auditLogs, webhookEvents, scheduledPosts } from './db/schema.js'"
)

# Add scheduled_posts SQL after webhook_events
pattern = b"CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events(created_at);\r\n  `)"
replacement = b"""CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events(created_at);

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      publish_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_publish_at ON scheduled_posts(publish_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_posts(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_phone ON scheduled_posts(phone);
  `)"""

content = content.replace(pattern, replacement)

# Add scheduled_posts to resetStore
content = content.replace(
    b"await pool.query('DELETE FROM webhook_events')",
    b"await pool.query('DELETE FROM webhook_events')\n  await pool.query('DELETE FROM scheduled_posts')"
)

with open('src/store.ts', 'wb') as f:
    f.write(content)

print('Added scheduled_posts table + SQL + import + resetStore')
