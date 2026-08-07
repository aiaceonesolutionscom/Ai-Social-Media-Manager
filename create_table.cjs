const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/ai_instagram' });

async function main() {
  try {
    const check = await pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'support_tickets')");
    console.log('Table exists:', check.rows[0].exists);
    
    if (!check.rows[0].exists) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id TEXT PRIMARY KEY,
          phone TEXT NOT NULL,
          subject TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          priority TEXT NOT NULL DEFAULT 'normal',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_support_phone ON support_tickets(phone)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status)');
      console.log('Table created successfully!');
    }
    
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    console.log('\nAll tables:');
    tables.rows.forEach(r => console.log(' -', r.table_name));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
main();
