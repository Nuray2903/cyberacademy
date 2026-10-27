// Seeds the labs table. Run after importing schema.sql:  node seed.js
require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const labs = require('./labs-data');

require('./generate-artifacts');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cyberacademy'
  });

  for (const lab of labs) {
    const flagHash = crypto.createHash('sha256').update(lab.flag).digest('hex');
    await conn.execute(
      `INSERT INTO labs (slug, title, category, difficulty, description, instructions, target_port, flag_hash, points)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), category=VALUES(category), difficulty=VALUES(difficulty),
         description=VALUES(description), instructions=VALUES(instructions), flag_hash=VALUES(flag_hash), points=VALUES(points)`,
      [lab.slug, lab.title, lab.category, lab.difficulty, lab.description, lab.instructions, flagHash, lab.points]
    );
  }

  console.log(`Seeded ${labs.length} labs.`);
  await conn.end();
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
