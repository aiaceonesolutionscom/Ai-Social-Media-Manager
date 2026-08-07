with open('src/store.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add import for supportTickets
content = content.replace(
    "aiProviders, aiUsageLogs, aiProviderCosts, metaConfig } from './db/schema.js'",
    "aiProviders, aiUsageLogs, aiProviderCosts, metaConfig, supportTickets } from './db/schema.js'"
)

# Add SQL for support_tickets in initStore (after meta_config SQL)
old_meta_sql = """    CREATE INDEX IF NOT EXISTS idx_meta_config_category ON meta_config(category);
  */)"""

new_meta_sql = """    CREATE INDEX IF NOT EXISTS idx_meta_config_category ON meta_config(category);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_phone ON support_tickets(phone);
    CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status);
  */)"""

content = content.replace(old_meta_sql, new_meta_sql)

# Add support_tickets to resetStore (after meta_config)
content = content.replace(
    "await pool.query('DELETE FROM meta_config')",
    "await pool.query('DELETE FROM meta_config')\n  await pool.query('DELETE FROM support_tickets')"
)

with open('src/store.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added supportTickets table + SQL + resetStore')
