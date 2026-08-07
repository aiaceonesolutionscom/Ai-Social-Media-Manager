with open('src/store.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix: Remove the incorrectly nested support_tickets SQL
old_broken = """      UNIQUE(category, key)

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
    );
    CREATE INDEX IF NOT EXISTS idx_meta_config_category ON meta_config(category);
  `)"""

new_fixed = """      UNIQUE(category, key)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_config_category ON meta_config(category);

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
  `)"""

if old_broken in content:
    content = content.replace(old_broken, new_fixed)
    with open('src/store.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed: SQL structure corrected')
else:
    print('Pattern not found - checking...')
    # Show the area
    idx = content.find('support_tickets')
    if idx > 0:
        print(content[idx-200:idx+300])
