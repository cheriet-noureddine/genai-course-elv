/**
 * Backend for "الذكاء الاصطناعي في حياتي اليومية" course.
 *
 * What lives on the server (and never gets sent to the browser in full):
 *   - The course password (COURSE_PASSWORD env var, falls back to a default).
 *   - Quiz correct answers + explanations (data/answer-key.json).
 *   - The full course content (data/lessons/*.json) — only the ONE lesson
 *     the student is currently viewing is ever sent over the wire.
 *
 * What the browser gets:
 *   - /api/structure   -> menu only: titles/times, no lesson bodies, no answers.
 *   - /api/lesson/:mi/:li -> the single requested lesson's content.
 *   - /api/quiz/:mi   -> question text + options only (no `correct`/`explain`).
 *   - the submit endpoints -> the server grades the answer and returns the result.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;
const COURSE_PASSWORD = process.env.COURSE_PASSWORD || 'selouani-school';

// ---------------------------------------------------------------------------
// Load reference data once at startup. These files stay on the server;
// only sanitized slices of them are ever sent to a client.
// ---------------------------------------------------------------------------
const structure = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'structure.json'), 'utf8'));
const answerKey = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'answer-key.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Very small auth layer: password -> opaque session token kept in memory.
// Good enough for a single-classroom course; swap for real sessions/DB-backed
// auth if this ever needs to support many concurrent cohorts.
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> { createdAt }
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// naive brute-force throttle per IP
const loginAttempts = new Map(); // ip -> { count, first }
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() - rec.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const rec = token && sessions.get(token);
  if (!rec || Date.now() - rec.createdAt > SESSION_TTL_MS) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'too_many_attempts', message: 'حاولت كثيراً، يرجى الانتظار قليلاً قبل إعادة المحاولة.' });
  }
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'missing_password', message: 'يرجى إدخال كلمة المرور.' });
  }
  if (password.trim().toLowerCase() !== COURSE_PASSWORD.trim().toLowerCase()) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'invalid_password', message: 'كلمة المرور غير صحيحة.' });
  }
  const token = issueToken();
  res.json({ token });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Course content routes (all require a valid session)
// ---------------------------------------------------------------------------

// Menu / sidebar data only — no lesson bodies, no quiz answers.
app.get('/api/structure', requireAuth, (req, res) => {
  res.json(structure);
});

const ID_RE = /^\d+$/;

function loadModule(mi) {
  if (!ID_RE.test(mi)) return null;
  const idx = Number(mi);
  return structure.modules[idx] ? idx : null;
}

// Serve exactly one lesson — never the whole course.
app.get('/api/lesson/:mi/:li', requireAuth, (req, res) => {
  const { mi, li } = req.params;
  if (!ID_RE.test(mi) || !ID_RE.test(li)) return res.status(400).json({ error: 'bad_request' });
  const mod = structure.modules[Number(mi)];
  if (!mod || !mod.lessons[Number(li)]) return res.status(404).json({ error: 'not_found' });

  const file = path.join(DATA_DIR, 'lessons', `${Number(mi)}-${Number(li)}.json`);
  fs.readFile(file, 'utf8', (err, raw) => {
    if (err) return res.status(404).json({ error: 'not_found' });
    res.type('application/json').send(raw);
  });
});

// Module quiz — question text + options only.
app.get('/api/quiz/:mi', requireAuth, (req, res) => {
  const { mi } = req.params;
  if (!ID_RE.test(mi) || !answerKey.moduleQuizzes[mi]) return res.status(404).json({ error: 'not_found' });
  const full = answerKey.moduleQuizzes[mi];
  res.json({
    title: full.title,
    questions: full.questions.map(q => ({ q: q.q, opts: q.opts })),
  });
});

// Grade a module quiz submission server-side.
app.post('/api/quiz/:mi/submit', requireAuth, (req, res) => {
  const { mi } = req.params;
  if (!ID_RE.test(mi) || !answerKey.moduleQuizzes[mi]) return res.status(404).json({ error: 'not_found' });
  const full = answerKey.moduleQuizzes[mi];
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

  let score = 0;
  const results = full.questions.map((q, i) => {
    const chosen = answers[i];
    const isCorrect = chosen === q.correct;
    if (isCorrect) score += 1;
    return { isCorrect, chosen, correctIndex: q.correct, explain: q.explain };
  });

  res.json({ score, total: full.questions.length, results });
});

// Mini quiz shown at the end of a lesson — question text + options only.
app.get('/api/lesson-quiz/:mi/:li', requireAuth, (req, res) => {
  const key = `${req.params.mi}-${req.params.li}`;
  const lq = answerKey.lessonQuizzes[key];
  if (!lq) return res.status(404).json({ error: 'not_found' });
  res.json({ q: lq.q, opts: lq.opts });
});

// Grade a mini quiz submission server-side.
app.post('/api/lesson-quiz/:mi/:li/submit', requireAuth, (req, res) => {
  const key = `${req.params.mi}-${req.params.li}`;
  const lq = answerKey.lessonQuizzes[key];
  if (!lq) return res.status(404).json({ error: 'not_found' });
  const chosen = req.body?.answer;
  const isCorrect = chosen === lq.correct;
  res.json({ isCorrect, chosen, correctIndex: lq.correct, explain: lq.explain });
});

// Final project brief.
app.get('/api/final-project', requireAuth, (req, res) => {
  res.json(answerKey.finalProject);
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`Course server running on http://localhost:${PORT}`);
});
