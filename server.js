require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const labDefs = require('./labs-data');

const app = express();
const PORT = process.env.PORT || 3000;
const LAB_HOST = process.env.LAB_HOST || 'localhost';

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

const artifactBySlug = Object.fromEntries(labDefs.map((l) => [l.slug, l.artifact]));
const allowedFiles = new Set(labDefs.map((l) => l.artifact));

// Tiny in-memory rate limiter for flag submissions (per user+lab)
const attempts = new Map();
function submissionAllowed(userId, labId) {
  const key = `${userId}:${labId}`;
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 8) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

// ---------- auth ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username))
      return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, underscore)' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.execute('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [
      username,
      email.toLowerCase(),
      hash
    ]);
    req.session.userId = result.insertId;
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username or email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const [rows] = await db.execute('SELECT id, password_hash FROM users WHERE username = ? OR email = ?', [
      username,
      username.toLowerCase()
    ]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      req.session.userId = user.id;
      res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- dashboard ----------
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const [[user]] = await db.execute('SELECT id, username, email, points, created_at FROM users WHERE id = ?', [
      req.session.userId
    ]);
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    const [[totals]] = await db.execute('SELECT COUNT(*) AS total FROM labs');
    const [[solved]] = await db.execute(
      'SELECT COUNT(DISTINCT lab_id) AS solved FROM submissions WHERE user_id = ? AND is_correct = 1',
      [user.id]
    );
    const [[rank]] = await db.execute('SELECT COUNT(*) + 1 AS rank_pos FROM users WHERE points > ?', [user.points]);
    const [recent] = await db.execute(
      `SELECT l.title, l.slug, s.is_correct, s.submitted_at
       FROM submissions s JOIN labs l ON l.id = s.lab_id
       WHERE s.user_id = ? ORDER BY s.submitted_at DESC LIMIT 8`,
      [user.id]
    );
    const [byCategory] = await db.execute(
      `SELECT l.category,
              COUNT(*) AS total,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM submissions s WHERE s.lab_id = l.id AND s.user_id = ? AND s.is_correct = 1) THEN 1 ELSE 0 END) AS solved
       FROM labs l GROUP BY l.category`,
      [user.id]
    );

    res.json({
      user,
      totalLabs: totals.total,
      solvedLabs: solved.solved,
      rank: rank.rank_pos,
      recent,
      byCategory
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- labs ----------
app.get('/api/labs', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT l.slug, l.title, l.category, l.difficulty, l.description, l.points,
              EXISTS (SELECT 1 FROM submissions s WHERE s.lab_id = l.id AND s.user_id = ? AND s.is_correct = 1) AS solved
       FROM labs l ORDER BY l.id`,
      [req.session.userId]
    );
    res.json(rows.map((r) => ({ ...r, solved: !!r.solved })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/labs/:slug', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT l.id, l.slug, l.title, l.category, l.difficulty, l.description, l.instructions, l.points,
              EXISTS (SELECT 1 FROM submissions s WHERE s.lab_id = l.id AND s.user_id = ? AND s.is_correct = 1) AS solved
       FROM labs l WHERE l.slug = ?`,
      [req.session.userId, req.params.slug]
    );
    const lab = rows[0];
    if (!lab) return res.status(404).json({ error: 'Lab not found' });

    const artifact = artifactBySlug[lab.slug];
    const instructions = lab.instructions
      .replace(/\{\{LAB_HOST\}\}/g, LAB_HOST)
      .replace(/\{\{PORT\}\}/g, String(PORT));

    res.json({
      slug: lab.slug,
      title: lab.title,
      category: lab.category,
      difficulty: lab.difficulty,
      description: lab.description,
      points: lab.points,
      solved: !!lab.solved,
      instructions,
      artifact: artifact || null,
      artifactUrl: artifact ? `http://${LAB_HOST}:${PORT}/lab-files/${artifact}` : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/labs/:slug/submit', requireAuth, async (req, res) => {
  try {
    const flag = String((req.body || {}).flag || '').trim();
    if (!flag) return res.status(400).json({ error: 'Enter a flag' });

    const [rows] = await db.execute('SELECT id, flag_hash, points FROM labs WHERE slug = ?', [req.params.slug]);
    const lab = rows[0];
    if (!lab) return res.status(404).json({ error: 'Lab not found' });

    const userId = req.session.userId;
    if (!submissionAllowed(userId, lab.id))
      return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });

    const [[already]] = await db.execute(
      'SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND lab_id = ? AND is_correct = 1',
      [userId, lab.id]
    );
    if (already.c > 0) return res.json({ correct: true, alreadySolved: true, message: 'You already solved this lab.' });

    const submitted = crypto.createHash('sha256').update(flag).digest('hex');
    const correct = submitted === lab.flag_hash;

    await db.execute('INSERT INTO submissions (user_id, lab_id, is_correct) VALUES (?, ?, ?)', [
      userId,
      lab.id,
      correct ? 1 : 0
    ]);
    if (correct) {
      await db.execute('UPDATE users SET points = points + ? WHERE id = ?', [lab.points, userId]);
      return res.json({ correct: true, message: `Correct! +${lab.points} points`, points: lab.points });
    }
    res.json({ correct: false, message: 'Incorrect flag. Keep digging.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT username, points FROM users ORDER BY points DESC, id ASC LIMIT 20');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- lab artifacts (for download from the user's Kali VM) ----------
// Authenticated: from Kali use the "download" command shown on the lab page,
// which passes your session cookie, or a personal lab token (see /api/lab-token).
const labTokens = new Map(); // token -> userId

app.get('/api/lab-token', requireAuth, (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  labTokens.set(token, { userId: req.session.userId, expires: Date.now() + 1000 * 60 * 60 * 4 });
  res.json({ token });
});

app.get('/lab-files/:file', (req, res) => {
  const file = req.params.file;
  if (!allowedFiles.has(file)) return res.status(404).send('Not found');

  let authed = !!(req.session && req.session.userId);
  const token = req.query.token;
  if (!authed && token) {
    const entry = labTokens.get(String(token));
    if (entry && entry.expires > Date.now()) authed = true;
  }
  if (!authed) return res.status(401).send('Login required. Generate a lab token from your dashboard.');

  res.download(path.join(__dirname, 'lab-files', file), file);
});

// ---------- start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CyberAcademy running on http://localhost:${PORT}`);
  console.log(`Labs reachable from VMs at http://${LAB_HOST}:${PORT}`);
});
