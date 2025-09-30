// server.js — Export (TXT/PDF/DOCX) + Comments + Profile + Upload all lengths + Audio patch + Avatar Upload + Static /uploads + Timeout & Mock
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { v4 as uuidv4 } from 'uuid';
import { toFile } from 'openai/uploads';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
// ➜ ใช้แบบนี้แทน
import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(_execFile);

import ffprobeInstaller from '@ffprobe-installer/ffprobe'; // ← ติดตั้งเพิ่ม: npm i @ffprobe-installer/ffprobe

const FFMPEG_BIN  = process.env.FFMPEG_PATH  || ffmpegPath;
const FFPROBE_BIN = process.env.FFPROBE_PATH || ffprobeInstaller.path;

ffmpeg.setFfmpegPath(FFMPEG_BIN);
ffmpeg.setFfprobePath(FFPROBE_BIN);

// ===== __dirname / ฟอนต์ =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== __dirname / ฟอนต์ =====
const FONTS_DIR = path.join(__dirname, 'fonts');

// ใช้ TH Sarabun **New** (ไฟล์ที่คุณส่งมา)
const SARABUN_REG        = path.join(FONTS_DIR, 'THSarabunNew.ttf');
const SARABUN_BOLD       = path.join(FONTS_DIR, 'THSarabunNew Bold.ttf');
const SARABUN_ITALIC     = path.join(FONTS_DIR, 'THSarabunNew Italic.ttf');
const SARABUN_BOLDITALIC = path.join(FONTS_DIR, 'THSarabunNew BoldItalic.ttf');

// ====== วางไว้บนๆ ไกล้ ๆ const app = express();
const PROCESS_TIMEOUT_MS     = 30 * 60 * 1000; // 30 นาที
const TRANSCRIBE_TIMEOUT_MS  = 30 * 60 * 1000; // 30 นาที
const SUMMARIZE_TIMEOUT_MS   = 2  * 60 * 1000; // 2 นาทีพอ

function withTimeout(promise, ms, label='operation') {
  let timer;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), t]);
}

// ===== App / OpenAI =====
const app = express();
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID || undefined,
  project: process.env.OPENAI_PROJECT_ID || undefined,
});
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ===== DB =====
const db = new Database(path.join(__dirname, 'mimi.sqlite'));
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  filename TEXT,
  model TEXT,
  status TEXT,
  duration_ms INTEGER,
  tokens INTEGER,
  transcript TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  export_format TEXT DEFAULT 'txt',
  include_transcript INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY,
  full_name TEXT,
  birthday TEXT,
  language TEXT DEFAULT 'th',
  complaint TEXT,
  avatar_url TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// ---- safe migration: คอลัมน์ใหม่ของ comments
try { db.prepare(`ALTER TABLE comments ADD COLUMN show_name INTEGER DEFAULT 0`).run(); } catch {}
try { db.prepare(`ALTER TABLE comments ADD COLUMN username_snapshot TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE users ADD COLUMN reset_code TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE users ADD COLUMN reset_expires TEXT`).run(); } catch {}


// ---- backfill snapshot จาก users.username สำหรับของเก่า
try {
  db.prepare(`
    UPDATE comments
       SET username_snapshot = (
         SELECT username FROM users WHERE users.id = comments.user_id
       )
     WHERE (username_snapshot IS NULL OR username_snapshot = '')
       AND user_id IS NOT NULL
  `).run();
} catch (e) { console.warn('backfill username_snapshot skipped:', String(e)); }

// ---- safe migration profiles.avatar_url
try { db.prepare(`ALTER TABLE profiles ADD COLUMN avatar_url TEXT`).run(); } catch {}

// ===== Basic Auth (site-wide gate) =====
import crypto from 'crypto';

const BASIC_USER = process.env.BASIC_USER || '';   // ตั้งใน Railway
const BASIC_PASS = process.env.BASIC_PASS || '';

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

function safeEqual(a, b) {
  const A = Buffer.from(a || '');
  const B = Buffer.from(b || '');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// ยกเว้น health probe และไฟล์สาธารณะบางอย่างได้ถ้าต้องการ
const allowlist = new Set(['/api/health', '/favicon.ico']);

app.use((req, res, next) => {
  return next(); // 🚀 ข้ามการเช็ค Basic Auth ไปเลย
});



// ===== Middlewares =====
app.use(cors());
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));
app.use(express.static(__dirname));  // เสิร์ฟ index.html / assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // รูป/ไฟล์อัปโหลด

// favicon fallback
app.get('/favicon.ico', (req, res) => {
  const fav = path.join(__dirname, 'favicon.ico');
  if (fs.existsSync(fav)) return res.sendFile(fav);
  const logo = path.join(__dirname, 'logo.png');
  if (fs.existsSync(logo)) return res.sendFile(logo);
  res.status(204).end(); // ไม่มีไฟล์ก็จบเงียบ ๆ
});


// uploads/
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
});

// โฟลเดอร์อวตาร
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
const avatarUpload = multer({
  dest: avatarsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ===== Utils =====
function nowISO() { return new Date().toISOString(); }

// ให้ไฟล์ temp ของ multer มีนามสกุลเดียวกับไฟล์จริง
function withOriginalExt(tmpPath, originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!ext) return { path: tmpPath, extraToCleanup: null };
  if (path.extname(tmpPath)) return { path: tmpPath, extraToCleanup: null };
  const newPath = tmpPath + ext;
  fs.copyFileSync(tmpPath, newPath);
  return { path: newPath, extraToCleanup: newPath };
}

// language normalizer (รับเฉพาะ ISO-639-1 พร้อม region ได้)
function normalizeLang(raw) {
  const s = (raw || '').trim();
  const ok = /^[a-z]{2}(-[A-Z]{2})?$/.test(s);
  return ok ? s : undefined;
}

// wrap upload: รับ 'audio' หรือ 'file' + ตอบ error เป็น JSON
function wrapUpload(handler) {
  return (req, res) => {
    const run = (field) =>
      new Promise((resolve) =>
        upload.single(field)(req, res, (err) => resolve({ err, field }))
      );

    (async () => {
      let r = await run('audio');
      if (r.err || !req.file) r = await run('file');

      if (r.err) {
        if (r.err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'file_too_large', max: '300MB' });
        }
        return res.status(400).json({ error: 'upload_failed', detail: String(r.err) });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'no_file', detail: 'missing multipart field "audio" or "file"' });
      }

      try { await handler(req, res); }
      catch (e) {
        console.error('HANDLER_ERROR', e);
        if (!res.headersSent) res.status(500).json({ error: 'internal_error', detail: String(e) });
      }
    })();
  };
}

app.use(helmet({
  contentSecurityPolicy: false,   // ปิด CSP ถ้า dev
  crossOriginEmbedderPolicy: false
}));

// ✅ Helmet: security headers
import helmet from 'helmet';
app.use(helmet());

// ===== Auth middlewares =====
function authOptional(req, _res, next) {
  const hdr = req.headers.authorization;
  if (hdr && hdr.startsWith('Bearer ')) {
    try { req.user = jwt.verify(hdr.slice(7), JWT_SECRET); } catch {}
  }
  next();
}
function authRequired(req, res, next) {
  if (!req.user) {
    const hdr = req.headers.authorization;
    if (hdr && hdr.startsWith('Bearer ')) {
      try { req.user = jwt.verify(hdr.slice(7), JWT_SECRET); } catch {}
    }
  }
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ===== Auth =====
app.post('/api/auth/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hash, nowISO());
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    res.status(500).json({ error: 'signup_failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });
  if (!bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  const token = jwt.sign({ id: row.id, username: row.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: row.id, username: row.username } });
});

app.get('/api/auth/me', authOptional, (req, res) => res.json({ user: req.user || null }));
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

// ขอรหัสรีเซ็ต
app.post('/api/auth/forgot', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'missing_username' });

  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!row) {
    // เพื่อลดการเดา user: ตอบสำเร็จเสมอ
    return res.json({ ok: true, hint: 'if exists, code generated' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 หลัก
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 นาที

  db.prepare(`
    UPDATE users SET reset_code = ?, reset_expires = ? WHERE id = ?
  `).run(code, expires, row.id);

  // DEV: log โค้ดไว้ (โปรดลบทิ้งถ้าโปรดักชันจริง)
  console.log(`[RESET_CODE] user=${username} code=${code} exp=${expires}`);

  return res.json({ ok: true, code }); // โชว์โค้ดกลับไปเลย (โหมดไม่มีอีเมล)
});

// ยืนยันโค้ด + ตั้งรหัสใหม่
app.post('/api/auth/reset', (req, res) => {
  const { username, code, new_password } = req.body || {};
  if (!username || !code || !new_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const row = db.prepare('SELECT id, reset_code, reset_expires FROM users WHERE username = ?').get(username);
  if (!row || !row.reset_code || !row.reset_expires) {
    return res.status(400).json({ error: 'invalid_or_expired' });
  }

  const now = new Date();
  const exp = new Date(row.reset_expires);
  if (row.reset_code !== code || isNaN(exp.getTime()) || now > exp) {
    return res.status(400).json({ error: 'invalid_or_expired' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare(`
    UPDATE users
       SET password_hash = ?, reset_code = NULL, reset_expires = NULL
     WHERE id = ?
  `).run(hash, row.id);

  return res.json({ ok: true });
});

app.get('/api/status', async (_req, res) => {
  const status = { ok: true, checks: {} };

  // OpenAI ping (คงเดิม)
  try {
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
      temperature: 0
    });
    status.checks.openai_api = { ok: true, sample: r.choices?.[0]?.message?.content || 'ok' };
  } catch (e) {
    status.checks.openai_api = { ok: false, error: String(e?.message || e) };
  }

  // ✅ ffmpeg via execFile (no shell, กัน path ช่องว่าง/ไทย)
  try {
    const { stdout } = await execFileAsync(FFMPEG_BIN, ['-version']);
    status.checks.ffmpeg = { ok: true, path: FFMPEG_BIN, version: stdout.split('\n')[0] || 'ok' };
  } catch (e) {
    status.checks.ffmpeg = { ok: false, path: FFMPEG_BIN, error: String(e?.stderr || e?.message || e) };
  }

  // ✅ ffprobe via execFile
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, ['-version']);
    status.checks.ffprobe = { ok: true, path: FFPROBE_BIN, version: stdout.split('\n')[0] || 'ok' };
  } catch (e) {
    status.checks.ffprobe = { ok: false, path: FFPROBE_BIN, error: String(e?.stderr || e?.message || e) };
  }

  // disk & limits (คงเดิมได้)
  try {
    fs.statSync(__dirname);
    status.checks.disk_usage = { ok: true, basePath: __dirname, note: 'path accessible' };
  } catch (e) {
    status.checks.disk_usage = { ok: false, error: String(e?.message || e) };
  }

  status.checks.limits = {
    upload_limit_mb: 300,
    process_timeout_ms: PROCESS_TIMEOUT_MS,
    transcribe_timeout_ms: TRANSCRIBE_TIMEOUT_MS,
    summarize_timeout_ms: SUMMARIZE_TIMEOUT_MS
  };
  status.checks.uptime = { seconds: Math.floor(process.uptime()) };

  status.ok = Object.values(status.checks).every(c => c?.ok !== false);
  res.json(status);
});

// ==== Long audio helpers (top-level) ====

// โฟลเดอร์ชั่วคราวสำหรับไฟล์ segment
function makeTmpDir(prefix='seg') {
  const id = uuidv4().slice(0,8);
  const dir = path.join(__dirname, 'uploads', `${prefix}_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ตัดไฟล์เป็นช่วงละ N วินาที + แปลงเป็น mono 16k wav เพื่อให้ถอดเสียงเสถียร
async function segmentAudio(inputPath, segmentSec = 600) { // 10 นาที/ไฟล์
  const outDir = makeTmpDir('segments');
  const outPattern = path.join(outDir, 'part_%03d.wav');

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .outputOptions([
        '-f segment',
        `-segment_time ${segmentSec}`,
        '-reset_timestamps 1'
      ])
      .output(outPattern)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const files = fs.readdirSync(outDir)
    .filter(f => /^part_\d{3}\.wav$/.test(f))
    .sort()
    .map(f => path.join(outDir, f));

  return { outDir, files };
}

// ถอดเสียงไฟล์ยาว: ตัดเป็นช่วง -> เรียก fallback ทีละช่วง -> รวมข้อความ
async function transcribeLongAudio(inputPath, language) {
  const { outDir, files } = await segmentAudio(inputPath, 600);

  const parts = files.length ? files : [inputPath];
  let full = '';

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const text = await transcribeFallback(p, language);
    const header = parts.length > 1 ? `\n\n----- [ส่วนที่ ${i+1}/${parts.length}] -----\n` : '';
    full += header + (text || '');
  }

  // เก็บกวาดไฟล์ชั่วคราว
  try {
    if (files.length) {
      for (const f of files) { try { fs.unlinkSync(f); } catch {} }
      try { fs.rmdirSync(outDir); } catch {}
    }
  } catch {}

  return full.trim();
}


// ===== STT + Summary =====
async function transcribeFallback(filePath, language) {
  const ext = path.extname(filePath).toLowerCase();
  const allowed = new Set(['.flac','.m4a','.mp3','.mp4','.mpeg','.mpga','.oga','.ogg','.wav','.webm']);
  const safeName = allowed.has(ext) ? ('audio' + ext) : 'audio.mp3';
  const uploadFile = await toFile(fs.createReadStream(filePath), safeName);

  const lang = normalizeLang(language);

  try {
    const resp = await withTimeout(
      client.audio.transcriptions.create({
        file: uploadFile,
        model: 'whisper-1',
        ...(lang ? { language: lang } : {}),
      }),
      TRANSCRIBE_TIMEOUT_MS,
      'transcription'
    );

    return typeof resp === 'string' ? resp : (resp?.text ?? String(resp || ''));
  } catch (e) {
    console.error('OPENAI_TRANSCRIBE_400+', { status: e?.status, data: e?.response?.data });
    throw e;
  }
}



async function summarizeText(text) {
  const SYSTEM = `
คุณคือผู้ช่วยสรุปการประชุมมืออาชีพ
สรุปภาษาไทย กระชับ ชัดเจน แบบ executive summary
**ตอบกลับเป็น Markdown เท่านั้น**
- ใช้หัวข้อ H2 (##) ตามลำดับ
- bullet สั้น กระชับ
- Action Items ระบุ [Assignee] งาน — Due: YYYY-MM-DD หรือ "-"
`.trim();

  const USER = `
โปรดสรุปด้วยหัวข้อ:

## ภาพรวมการประชุม
- วัตถุประสงค์หลัก 1–2 ข้อ
- สรุปผลลัพธ์/ความคืบหน้า 1–3 ข้อ

## หัวข้อที่หารือ
- bullet 3–8 ข้อ

## การตัดสินใจ (Decisions)
- 1–5 ข้อ (ถ้ามี)

## Action Items
- [Assignee] งาน — Due: YYYY-MM-DD
- [Assignee] งาน — Due: YYYY-MM-DD

## ประเด็นค้าง/คำถาม
- 1–5 ข้อ

## ความเสี่ยง & ทางแก้ (ถ้ามี)
- ความเสี่ยง + ทางบรรเทา

## ขั้นตอนถัดไป (Next Steps)
- 3–5 ข้อ

เนื้อหาที่ต้องสรุป:
---------------------
${text}
---------------------
`.trim();

  try {
    // ✅ ใช้ chat.completions (ปลอดภัยกว่า responses)
    const r = await withTimeout(
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER },
        ],
      }),
      SUMMARIZE_TIMEOUT_MS,
      'summarize'
    );

    return r?.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('SUMMARIZE_ERROR', e);
    return '';
  }
}


// ===== Upload (แปลงเสียงอย่างเดียว) =====
app.post('/api/transcribe', authOptional, wrapUpload(async (req, res) => {
  const tmpPath  = req.file ? path.resolve(req.file.path) : null;
  const filename = req.file?.originalname || 'unknown';
  const userId   = req.user?.id || null;
  const jobId    = uuidv4();

  if (!tmpPath) return res.status(400).json({ error: 'no_file' });
  const { path: audioPath, extraToCleanup } = withOriginalExt(tmpPath, filename);

  const started = Date.now();
  try {
    // บังคับไทยเป็นค่าเริ่มต้น แต่ถ้า API ไม่รับ เรากรองใน transcribeFallback แล้ว
    const transcript = await transcribeFallback(audioPath, 'th');
    const duration = Date.now() - started;

    db.prepare(`
      INSERT INTO jobs (id, user_id, filename, model, status, duration_ms, tokens, transcript, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, userId, filename, 'whisper-1', 'transcribed', duration, null, transcript, '', nowISO());

    res.json({ jobId, text: transcript });
  } catch (e) {
    console.error('TRANSCRIBE_ERROR', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
    try { if (extraToCleanup && extraToCleanup !== tmpPath) fs.unlinkSync(extraToCleanup); } catch {}
  }
}));

// ===== Upload + Process (Transcribe + Summarize) =====
app.post('/api/process', authOptional, wrapUpload(async (req, res) => {
  const tmpPath  = req.file ? path.resolve(req.file.path) : null;
  const language = (req.body?.language || '').trim() || 'th';
  const filename = req.file?.originalname || 'unknown';
  const userId   = req.user?.id || null;
  const jobId    = uuidv4();

  if (!tmpPath) return res.status(400).json({ error: 'no_file' });

  const { path: audioPath, extraToCleanup } = withOriginalExt(tmpPath, filename);

  const started = Date.now();
  try {
    const transcript = await withTimeout(
  transcribeLongAudio(audioPath, language === 'auto' ? undefined : language),
  PROCESS_TIMEOUT_MS,
  'transcription'
    );

    const summary = await withTimeout(
      summarizeText(transcript || ''),
      SUMMARIZE_TIMEOUT_MS,
      'summarization'
    );

    const duration = Date.now() - started;

    db.prepare(`
      INSERT INTO jobs (id, user_id, filename, model, status, duration_ms, tokens, transcript, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, userId, filename, 'auto', 'completed', duration, null, transcript, summary, nowISO());

    res.json({ jobId, transcription: transcript, summary });
  } catch (e) {
    const msg = String(e?.message || e);
    const isTimeout = /timeout/i.test(msg);
    console.error('PROCESS_ERROR', msg);
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'timeout' : 'internal_error',
      detail: msg
    });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
    try { if (extraToCleanup && extraToCleanup !== tmpPath) fs.unlinkSync(extraToCleanup); } catch {}
  }
}));


// ===== Jobs =====
app.get('/api/jobs', authOptional, (req, res) => {
  const uid = req.user?.id || null;
  const rows = uid
    ? db.prepare('SELECT id, filename, status, created_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC').all(uid)
    : db.prepare('SELECT id, filename, status, created_at FROM jobs ORDER BY created_at DESC LIMIT 50').all();
  res.json({ jobs: rows });
});

app.get('/api/jobs/:id', authOptional, (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

// ===== Comments =====
app.get('/api/jobs/:id/comments', authOptional, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
           COALESCE(NULLIF(c.username_snapshot,''), u.username, 'ผู้ใช้') AS username
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
     WHERE job_id = ?
     ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.json({ comments: rows });
});

app.post('/api/jobs/:id/comments', authOptional, (req, res) => {
  const { content, show_name } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'no_content' });

  const uid = req.user?.id || null;

  let currentUsername = '';
  if (uid) {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
    currentUsername = u?.username || '';
  }

  const snapshot = show_name ? (currentUsername || 'ผู้ใช้') : '';

  db.prepare(`
    INSERT INTO comments (job_id, user_id, content, created_at, show_name, username_snapshot)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, uid, content.trim(), nowISO(), show_name ? 1 : 0, snapshot);

  res.json({ ok: true });
});

// ===== Comments feed (paged) =====
function listComments(offset = 0, limit = 10) {
  return db.prepare(`
    SELECT
      c.content, c.created_at, j.filename,
      COALESCE(NULLIF(c.username_snapshot,''), u.username, 'ผู้ใช้') AS username
    FROM comments c
    LEFT JOIN jobs j ON j.id = c.job_id
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

app.get('/api/comments', (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10));
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '10', 10)));

  const rows = db.prepare(`
    SELECT
      c.content, c.created_at, j.filename,
      COALESCE(NULLIF(c.username_snapshot,''), u.username, 'ผู้ใช้') AS username
    FROM comments c
    LEFT JOIN jobs j ON j.id = c.job_id
    LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit + 1, offset);

  const has_more = rows.length > limit;
  const comments = has_more ? rows.slice(0, limit) : rows;
  res.json({ comments, has_more, next_offset: offset + comments.length });
});

app.get('/api/comments/recent', (_req, res) => {
  const comments = listComments(0, 20);
  res.json({ comments, has_more: comments.length === 20, next_offset: 20 });
});

/* ========== Export helpers (สวยขึ้น) ========== */

// จัดวันที่ให้อ่านง่าย
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('th-TH'); } catch { return iso; }
}

// แปลง Markdown ง่าย ๆ เป็นบรรทัดพร้อมชนิด (สำหรับ PDF/DOCX)
function parseSimpleMD(mdText = '') {
  const lines = (mdText || '').split(/\r?\n/);
  const blocks = [];
  for (let raw of lines) {
    const line = raw.replace(/\s+$/,'');
    if (!line.trim()) { blocks.push({ type:'blank' }); continue; }
    if (/^#{2,6}\s+/.test(line)) {       // ## Heading
      blocks.push({ type:'h2', text: line.replace(/^#{2,6}\s+/, '') });
      continue;
    }
    if (/^\-\s+/.test(line)) {           // - bullet
      blocks.push({ type:'li', text: line.replace(/^\-\s+/, '') });
      continue;
    }
    blocks.push({ type:'p', text: line });
  }
  return blocks;
}

/* ---------- TXT: จัดหัว, คั่นบรรทัด, bullet ---------- */
function buildTxt(row, includeTranscript) {
  const L = [];
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  L.push('        MimiNote.AI — Summary Report');
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  L.push(`ไฟล์: ${row.filename}`);
  L.push(`รหัสงาน: ${row.id}`);
  L.push(`วันที่: ${fmtDate(row.created_at)}`);
  L.push('');

  if (includeTranscript) {
    L.push('■ Transcript');
    L.push('────────────────────────────────────────');
    L.push((row.transcript || '-').trim());
    L.push('');
  }

  L.push('■ Summary');
  L.push('────────────────────────────────────────');
  // ปล่อย Markdown แต่เพิ่มหัวกระสุนสวย ๆ
  const md = (row.summary || '').replace(/^\-\s+/gm, '• ');
  L.push(md.trim() || '-');

  L.push('');
  L.push('— สร้างโดย MimiNote.AI —');
  return L.join('\n');
}


/* ---------- PDF: ฟอนต์ไทย, สีหัวเรื่อง, bullet, ระยะขอบ ---------- */
function buildPDF(res, row, includeTranscript) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="summary_${row.id}.pdf"`);

  const doc = new PDFDocument({ margin: 56 }); // ~2cm
  doc.pipe(res);

  // ฟอนต์ไทย (เช็คว่ามีหรือไม่)
// ฟอนต์ไทย (ถ้ามี)
let hasThai = false;
try {
  if (fs.existsSync(SARABUN_REG)) {
    doc.registerFont('TH_REG',  SARABUN_REG);
    if (fs.existsSync(SARABUN_BOLD))       doc.registerFont('TH_BOLD',       SARABUN_BOLD);
    if (fs.existsSync(SARABUN_ITALIC))     doc.registerFont('TH_ITALIC',     SARABUN_ITALIC);
    if (fs.existsSync(SARABUN_BOLDITALIC)) doc.registerFont('TH_BOLDITALIC', SARABUN_BOLDITALIC);
    hasThai = true;
  }
} catch (e) {
  console.error('Font load error:', e);
}

const F_REG  = hasThai ? 'TH_REG'  : 'Helvetica';
const F_BOLD = hasThai ? 'TH_BOLD' : 'Helvetica-Bold';


  // ✅ หัวรายงาน
  doc.font(F_BOLD).fillColor('#e91e63').fontSize(22).text('MimiNote.AI — Summary Report', { align: 'center' });
  doc.moveDown(0.7);

  doc.font(F_REG).fillColor('#444').fontSize(12)
    .text(`ไฟล์: ${row.filename}`)
    .text(`รหัสงาน: ${row.id}`)
    .text(`วันที่: ${fmtDate(row.created_at)}`);

  doc.moveDown();

  // เส้นคั่น
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#f48fb1').lineWidth(1).stroke();
  doc.moveDown();

  // helper: วาดหัวข้อ
  function sectionTitle(txt) {
    doc.moveDown(0.6);
    doc.font(F_BOLD).fillColor('#000').fontSize(14).text(txt);
    doc.moveDown(0.2);
  }

  // helper: render markdown
  function renderSimpleMD(mdText) {
    const blocks = parseSimpleMD(mdText);
    for (const b of blocks) {
      if (b.type === 'blank') { doc.moveDown(0.3); continue; }
      if (b.type === 'h2') {
        doc.font(F_BOLD).fillColor('#1f2937').fontSize(13).text(b.text);
        continue;
      }
      if (b.type === 'li') {
        doc.font(F_REG).fillColor('#333').fontSize(12).text(`• ${b.text}`, { indent: 14 });
        continue;
      }
      doc.font(F_REG).fillColor('#444').fontSize(12).text(b.text, { lineGap: 3 });
    }
  }

  if (includeTranscript) {
    sectionTitle('Transcript');
    doc.font(F_REG).fontSize(12).fillColor('#444')
      .text((row.transcript || '-'), { lineGap: 3 });
    doc.moveDown();
  }

  sectionTitle('Summary');
  renderSimpleMD(row.summary || '-');

  // footer
  doc.moveDown(1.2);
  doc.font(F_REG).fontSize(10).fillColor('#777')
     .text('— สร้างโดย MimiNote.AI —', { align: 'center' });
  doc.end();
}


/* ---------- DOCX: แปลงหัวข้อ ## เป็น Heading 2, bullet, เว้นบรรทัด ---------- */
async function buildDOCX(row, includeTranscript) {
  const children = [];

  // ชื่อเรื่อง
  children.push(new Paragraph({ text: 'MimiNote.AI — Summary Report', heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ text: `ไฟล์: ${row.filename}` }));
  children.push(new Paragraph({ text: `รหัสงาน: ${row.id}` }));
  children.push(new Paragraph({ text: `วันที่: ${fmtDate(row.created_at)}` }));
  children.push(new Paragraph({ text: '' }));

  // helper: แปลง markdown ง่าย ๆ เป็นพารากราฟของ docx
  function mdToDocx(mdText = '') {
    const blocks = parseSimpleMD(mdText);
    const paras = [];
    for (const b of blocks) {
      if (b.type === 'blank') { paras.push(new Paragraph({ text: '' })); continue; }
      if (b.type === 'h2') {
        paras.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }));
        continue;
      }
      if (b.type === 'li') {
        paras.push(new Paragraph({ text: b.text, bullet: { level: 0 } }));
        continue;
      }
      paras.push(new Paragraph({ text: b.text }));
    }
    return paras;
  }

  if (includeTranscript) {
    children.push(new Paragraph({ text: 'Transcript', heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text: (row.transcript || '-') }));
    children.push(new Paragraph({ text: '' }));
  }

  children.push(new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }));
  children.push(...mdToDocx(row.summary || '-'));

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBuffer(doc);
}

app.get('/api/export/:id', authOptional, async (req, res) => {
  const format = (req.query.format || 'txt').toString().toLowerCase();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);

  if (!row) return res.status(404).json({ error: 'not_found' });

  let includeTranscript = true;
  if (req.user) {
    const s = db.prepare('SELECT include_transcript FROM settings WHERE user_id = ?')
                .get(req.user.id);
    if (s) includeTranscript = !!s.include_transcript;
  }

  try {
    if (format === 'txt') {
      const body = buildTxt(row, includeTranscript);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="summary_${row.id}.txt"`);
      return res.send(body);
    } else if (format === 'pdf') {
      return buildPDF(res, row, includeTranscript); // buildPDF จะ pipe แล้ว end ให้เอง
    } else if (format === 'docx') {
      const buf = await buildDOCX(row, includeTranscript);
      res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="summary_${row.id}.docx"`);
      return res.send(buf);
    } else {
      return res.status(400).json({ error: 'invalid_format' });
    }
  } catch (e) {
    console.error('EXPORT_ERROR', e);
    return res.status(500).json({ error: 'export_failed', detail: String(e?.message || e) });
  }
});



// ===== Settings: profile (GET) — ส่ง display_name ด้วย =====
app.get('/api/settings/profile', authOptional, (req, res) => {
  if (!req.user) {
    return res.json({
      full_name: '', birthday: '', language: 'th', complaint: '', avatar_url: '', display_name: ''
    });
  }

  const prof = db.prepare(`
    SELECT full_name, birthday, language, complaint, avatar_url
      FROM profiles
     WHERE user_id = ?
  `).get(req.user.id);

  const user = db.prepare(`SELECT username FROM users WHERE id = ?`).get(req.user.id);
  const full = (prof?.full_name || '').trim();
  const display_name = full || user?.username || '';

  res.json({
    full_name: prof?.full_name || '',
    birthday: prof?.birthday || '',
    language: prof?.language || 'th',
    complaint: prof?.complaint || '',
    avatar_url: prof?.avatar_url || '',
    display_name
  });
});

// ===== Settings: profile (update + cascade comments) =====
app.post('/api/settings/profile', authRequired, (req, res) => {
  const { full_name = '', birthday = '', language = 'th', complaint = '' } = req.body || {};
  const now = nowISO();
  const newName = (full_name || '').trim();
  let updated = 0;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO profiles (user_id, full_name, birthday, language, complaint, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        full_name   = excluded.full_name,
        birthday    = excluded.birthday,
        language    = excluded.language,
        complaint   = excluded.complaint,
        updated_at  = excluded.updated_at
    `).run(req.user.id, full_name, birthday, language, complaint, now);

    if (newName) {
      const r = db.prepare(`
        UPDATE comments
           SET username_snapshot = ?
         WHERE user_id = ? AND show_name = 1
      `).run(newName, req.user.id);
      updated = r?.changes || 0;
    } else {
      const r = db.prepare(`
        UPDATE comments
           SET username_snapshot = NULL
         WHERE user_id = ? AND show_name = 1
      `).run(req.user.id);
      updated = r?.changes || 0;
    }
  });

  try {
    tx();
    const user = db.prepare(`SELECT username FROM users WHERE id = ?`).get(req.user.id);
    const display_name = newName || user?.username || '';
    res.json({ ok: true, display_name, updated_comments: updated });
  } catch (e) {
    console.error('UPDATE_PROFILE_ERROR', e);
    res.status(500).json({ error: 'profile_update_failed', detail: String(e) });
  }
});

// ===== Avatar upload =====
app.post('/api/settings/profile/avatar', authOptional, authRequired, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'upload_failed', detail: String(err) });
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.png';
    const finalName = `avatar_user_${req.user.id}${safeExt}`;
    const finalPath = path.join(avatarsDir, finalName);

    try { fs.renameSync(req.file.path, finalPath); }
    catch {
      fs.copyFileSync(req.file.path, finalPath);
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    const publicUrl = `/uploads/avatars/${finalName}`;

    db.prepare(`
      INSERT INTO profiles (user_id, avatar_url, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at
    `).run(req.user.id, publicUrl, nowISO());

    res.json({ ok: true, avatar_url: publicUrl });
  });
});

// ===== Settings: export (compat) =====
app.get('/api/settings/export', authOptional, (req, res) => {
  if (!req.user) return res.json({ export_format: 'txt', include_transcript: true });
  const row = db.prepare('SELECT export_format, include_transcript FROM settings WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ export_format: 'txt', include_transcript: true });
  res.json({ export_format: row.export_format, include_transcript: !!row.include_transcript });
});
app.post('/api/settings/export', authRequired, (req, res) => {
  const { export_format = 'txt', include_transcript = true } = req.body || {};
  const now = nowISO();
  db.prepare(`
    INSERT INTO settings (user_id, export_format, include_transcript, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      export_format      = excluded.export_format,
      include_transcript = excluded.include_transcript,
      updated_at         = excluded.updated_at
  `).run(req.user.id, export_format, include_transcript ? 1 : 0, now, now);
  res.json({ ok: true });
});

// ===== Multer error handler =====
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file_too_large', max: '300MB' });
  }
  return next(err);
});

// ===== Debug =====
const PORT = process.env.PORT || 5051;
app.get('/api/debug/openai', async (_req, res) => {
  try {
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }]
    });
    res.json({ ok: true, sample: r.choices?.[0]?.message?.content?.slice(0,50) || 'ok' });
  } catch (e) {
    console.error('DEBUG_OPENAI error:', e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// ===== Global error =====
app.use((err, req, res, _next) => {
  console.error('UNCAUGHT', { name: err?.name, message: err?.message, stack: err?.stack });
  if (!res.headersSent) {
    res.status(500).json({
      error: 'uncaught',
      name: err?.name || 'Error',
      message: err?.message || String(err),
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
      path: req.originalUrl,
      method: req.method
    });
  }
});

app.listen(PORT, () => console.log(`MimiNote.AI backend running on http://localhost:${PORT}`));
