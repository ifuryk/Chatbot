import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Telegraf, Markup } from 'telegraf';
import OpenAI from 'openai';

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID ? String(process.env.ADMIN_TELEGRAM_ID) : null;

// --------------------
// Access control (optional)
// --------------------
bot.use(async (ctx, next) => {
  try {
    if (!ADMIN_TELEGRAM_ID) return next();
    const uid = ctx?.from?.id ? String(ctx.from.id) : '';
    if (uid !== ADMIN_TELEGRAM_ID) return;
    return next();
  } catch {
    return;
  }
});

// --------------------
// JSON persistence
// --------------------
const DATA_FILE = path.resolve('./data.json');

let store = new Map();

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
      console.log('data.json created');
    }
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    store = new Map(Object.entries(raw));
    console.log('Data loaded from data.json');
  } catch (e) {
    console.error('Failed to load data.json:', e?.message || e);
    store = new Map();
  }
}

function saveStore() {
  try {
    const obj = Object.fromEntries(store);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Failed to save data.json:', e?.message || e);
  }
}

loadStore();

// --------------------
// Helpers
// --------------------
function now() {
  return Date.now();
}

function cleanText(s) {
  return (s || '')
    .replace(/\r/g, '')
    .replace(/^[\s\-–—•\d\)\.]+/, '')
    .trim();
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// parse “1) best 2) alts …”
function parseSuggestions(text) {
  const t = (text || '').replace(/\r/g, '');

  let best = '';
  const mBest = t.match(/(?:^|\n)\s*1\)\s*([\s\S]*?)(?=(?:\n\s*2\)|$))/i);
  if (mBest && mBest[1]) best = cleanText((mBest[1].split('\n')[0] || mBest[1]).trim());

  let alts = [];
  const mAlt = t.match(/(?:^|\n)\s*2\)\s*([\s\S]*?)(?=(?:\n\s*3\)|$))/i);
  if (mAlt && mAlt[1]) {
    const block = mAlt[1].trim();
    const lines = block.split('\n').map((x) => x.trim()).filter(Boolean);

    const candidates = [];
    for (const line of lines) {
      if (/^(\-|\—|\–|•|\d+[\.\)]|\*)\s+/.test(line)) {
        candidates.push(cleanText(line));
      } else {
        if (candidates.length > 0) candidates[candidates.length - 1] = (candidates[candidates.length - 1] + ' ' + line).trim();
        else candidates.push(cleanText(line));
      }
    }
    alts = candidates.filter(Boolean).slice(0, 5);
  }

  if (!best) {
    const firstLine = (t.split('\n').find((x) => x.trim().length > 0) || '').trim();
    best = cleanText(firstLine);
  }

  return { best, alts };
}

// --------------------
// Schema
// --------------------
function ensureModeStats(obj) {
  const modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  if (!obj.modeStats) obj.modeStats = {};
  for (const m of modes) {
    if (!obj.modeStats[m]) obj.modeStats[m] = { sent: 0, replied: 0, strongReplied: 0, dates: 0, ghosts: 0 };
    for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'ghosts']) {
      if (typeof obj.modeStats[m][k] !== 'number') obj.modeStats[m][k] = 0;
    }
  }
}

function ensureUserSchema(u) {
  if (!u.tone) u.tone = 'уверенно-иронично';
  if (!u.goal) u.goal = 'общение → встреча';
  if (!u.profile) u.profile = {};
  if (!u.girls) u.girls = { default: { ctx: 'нет', history: [] } };
  if (!u.activeGirl) u.activeGirl = 'default';
  if (!u.last) u.last = null;

  // settings
  if (!u.settings) u.settings = {};
  if (typeof u.settings.autoghostHours !== 'number') u.settings.autoghostHours = 48; // default
  if (typeof u.settings.autopick !== 'boolean') u.settings.autopick = true; // A/B auto mode on/off
  if (!u.settings.pacing || !['warm', 'fast'].includes(u.settings.pacing)) u.settings.pacing = 'warm';

  // portrait defaults (не “магия”, просто дефолт)
  const p = u.profile;
  if (!p.bio) p.bio = 'Серёга. Спокойный, уверенный, без понтов. Люблю живое общение и чувство юмора.';
  if (!p.vibe) p.vibe = 'уверенно-ироничный, взрослый, короткие фразы, без суеты';
  if (!p.boundaries) p.boundaries = 'без давления, без пошлости, без манипуляций; уважительно, но не в позиции просящего';
  if (!p.doNotSay) p.doNotSay = 'не писать «привет красотка», не обесценивать, не ревновать, не ныть, не оправдываться';
  if (!p.signature) p.signature = 'короткие фразы, лёгкая ирония, иногда 🙂 или 😉, без эмодзи-перегруза';
  if (!p.age) p.age = '25+';
  if (!p.city) p.city = 'Москва';
  if (!p.interests) p.interests = 'бизнес, саморазвитие, медиа, музыка, стиль, путешествия';
  if (!p.intent) p.intent = 'лёгкое общение → интерес → встреча, без игр и драм';

  // global counts
  if (!u.stats) u.stats = { sent: 0, replied: 0, strongReplied: 0, dates: 0, ghosts: 0 };
  for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'ghosts']) if (typeof u.stats[k] !== 'number') u.stats[k] = 0;

  // dialog units
  if (!u.conv) u.conv = { conversations: 0, successes: 0 };
  for (const k of ['conversations', 'successes']) if (typeof u.conv[k] !== 'number') u.conv[k] = 0;

  // learning weights
  if (!u.learning) u.learning = { humor: 0, brevity: 0, boldness: 0, invites: 0 };
  for (const k of ['humor', 'brevity', 'boldness', 'invites']) if (typeof u.learning[k] !== 'number') u.learning[k] = 0;

  ensureModeStats(u);

  // girls
  for (const [, g] of Object.entries(u.girls)) {
    if (!g.ctx) g.ctx = 'нет';
    if (!Array.isArray(g.history)) g.history = [];
    if (!Array.isArray(g.notes)) g.notes = [];

    if (!g.stats) g.stats = { sent: 0, replied: 0, dates: 0, ghosts: 0 };
    if (typeof g.stats.strongReplied !== 'number') g.stats.strongReplied = 0;
    for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'ghosts']) if (typeof g.stats[k] !== 'number') g.stats[k] = 0;

    if (!g.conv) g.conv = { conversations: 0, successes: 0 };
    for (const k of ['conversations', 'successes']) if (typeof g.conv[k] !== 'number') g.conv[k] = 0;

    ensureModeStats(g);

    // stage
    if (!g.stage || !['S1', 'S2', 'S3', 'S4'].includes(g.stage)) g.stage = 'S1';

    // thread: dialog session
    // { id, startedAt, mode, sentCount, lastSentAt, closed, outcome }
    if (!g.thread) g.thread = null;
  }

  return u;
}

function getUser(userId) {
  const id = String(userId);
  if (!store.has(id)) {
    store.set(id, ensureUserSchema({}));
    saveStore();
  } else {
    ensureUserSchema(store.get(id));
  }
  return store.get(id);
}

function getGirl(user, name) {
  const key = (name || user.activeGirl || 'default').trim() || 'default';
  if (!user.girls[key]) {
    user.girls[key] = {
      ctx: 'нет',
      history: [],
      notes: [],
      stats: { sent: 0, replied: 0, strongReplied: 0, dates: 0, ghosts: 0 },
      conv: { conversations: 0, successes: 0 },
      modeStats: {},
      stage: 'S1',
      thread: null,
    };
  }
  user.activeGirl = key;
  ensureUserSchema(user);
  return { key, data: user.girls[key] };
}

function pushHistory(girl, role, text) {
  girl.history.push({ role, text: cleanText(text) });
  if (girl.history.length > 16) girl.history = girl.history.slice(-16);
}

function addNote(girl, text) {
  girl.notes.push({ ts: now(), text: cleanText(text) });
  if (girl.notes.length > 60) girl.notes = girl.notes.slice(-60);
}

// --------------------
// Learning + mode selection (A/B)
// --------------------
function updateLearning(user, mode, outcome, options = {}) {
  const L = user.learning;
  const pacing = options.pacing || 'warm';
  const stage = options.stage || 'S1';
  const sentCount = options.sentCount || 0;
  const delta = (k, v) => (L[k] = clamp(L[k] + v, -3, 3));

  const good = outcome === 'strongReplied' ? 2 : outcome === 'replied' ? 1 : outcome === 'date' ? 2 : 0;
  let bad = outcome === 'ghost' ? -1 : 0;
  if (outcome === 'ghost' && pacing === 'warm') {
    bad = stage === 'S1' && sentCount <= 1 ? -0.2 : -0.5;
  }

  if (mode === 'funny') delta('humor', good + bad);
  if (mode === 'short') delta('brevity', good + bad);
  if (mode === 'bolder') delta('boldness', good + bad);
  if (mode === 'invite') delta('invites', good + bad);

  if (mode === 'base') {
    if (outcome === 'replied') {
      delta('brevity', 0.5);
      delta('boldness', 0.5);
    }
    if (outcome === 'ghost') {
      delta('boldness', -0.5);
      delta('humor', -0.25);
    }
  }
}

function learningHint(user) {
  const L = user.learning;
  const lvl = (x) => (x >= 2 ? 'сильнее' : x >= 1 ? 'чуть больше' : x <= -2 ? 'заметно меньше' : x <= -1 ? 'чуть меньше' : 'нейтрально');

  const summary = `Юмор: ${lvl(L.humor)} | Краткость: ${lvl(L.brevity)} | Смелость: ${lvl(L.boldness)} | Встреча: ${lvl(L.invites)}`;

  const inst = [];
  if (L.humor >= 2) inst.push('больше лёгкого юмора');
  else if (L.humor <= -2) inst.push('минимум шуток');

  if (L.brevity >= 2) inst.push('короче');
  else if (L.brevity <= -2) inst.push('чуть теплее и развернутее');

  if (L.boldness >= 2) inst.push('смелее флирт без давления');
  else if (L.boldness <= -2) inst.push('флирт мягче');

  if (L.invites >= 2) inst.push('чаще мягко к встрече');
  else if (L.invites <= -2) inst.push('встречу не торопить');

  return { summary, instruction: inst.length ? inst.join('; ') : 'держи баланс' };
}

function bumpModeStats(obj, mode, outcome, sentIncrement = 0) {
  ensureModeStats(obj);
  const m = obj.modeStats[mode || 'base'] || obj.modeStats.base;
  if (sentIncrement) m.sent += sentIncrement;
  if (outcome === 'replied') m.replied += 1;
  if (outcome === 'strongReplied') {
    m.replied += 1;
    m.strongReplied += 1;
  }
  if (outcome === 'date') m.dates += 1;
  if (outcome === 'ghost') m.ghosts += 1;
}

function scoreText(conv) {
  return `${conv.successes}/${conv.conversations} (${pct(conv.successes, conv.conversations)}%)`;
}

function modeReport(modeStats) {
  const modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  const rows = modes.map((m) => {
    const s = modeStats[m];
    const replyRate = pct(s.replied, s.sent);
    const dateRate = pct(s.dates, s.sent);
    return { m, sent: s.sent, replyRate, dateRate, replied: s.replied, dates: s.dates, ghosts: s.ghosts };
  });
  rows.sort((a, b) => (b.dateRate - a.dateRate) || (b.replyRate - a.replyRate) || (b.sent - a.sent));
  const lines = rows.map((r) => `• ${r.m}: sent=${r.sent}, replied=${r.replied} (${r.replyRate}%), dates=${r.dates} (${r.dateRate}%), ghost=${r.ghosts}`);
  return { lines: lines.join('\n'), bestMode: rows[0]?.m || 'base' };
}

// A/B: pick mode with exploration + smoothing
function pickMode(user, girl) {
  const pacing = user.settings.pacing || 'warm';
  const stage = girl?.stage || 'S1';
  let modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  if (stage === 'S1' || stage === 'S2') modes = ['base', 'short', 'funny'];
  if (stage === 'S3') modes = ['base', 'short', 'funny', 'bolder'];
  if (stage === 'S4') modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  const eps = 0.12; // exploration
  if (Math.random() < eps) return modes[Math.floor(Math.random() * modes.length)];

  // combine global and girl stats (weighted)
  const g = user.modeStats;
  const gg = girl?.modeStats || null;

  function modeValue(ms, m) {
    const s = ms[m];
    const sent = s.sent || 0;
    // smoothing: add small prior
    const replyRate = (s.replied + 1) / (sent + 4);
    const dateRate = (s.dates + 0.5) / (sent + 6);
    if (pacing === 'warm') {
      const dateWeight = stage === 'S4' ? 0.4 : 0.1;
      return 1.2 * replyRate + dateWeight * dateRate;
    }
    // fast/default: weight dates more
    return replyRate + 1.6 * dateRate;
  }

  const vals = modes.map((m) => {
    const vGlobal = modeValue(g, m);
    const vGirl = gg ? modeValue(gg, m) : vGlobal;
    let v = 0.55 * vGlobal + 0.45 * vGirl;
    if (pacing === 'warm' && stage === 'S3' && m === 'bolder') v *= 0.7;
    return { m, v };
  });

  vals.sort((a, b) => b.v - a.v);
  return vals[0].m;
}

function modeInstruction(mode) {
  if (mode === 'short') return 'Сделай основной ответ коротким, максимально по делу.';
  if (mode === 'funny') return 'Добавь лёгкий уместный юмор, без кринжа.';
  if (mode === 'bolder') return 'Сделай увереннее и чуть более флиртово, но без давления.';
  if (mode === 'invite') return 'Слегка подведи к созвону/встрече, мягко.';
  return 'Держи баланс.';
}

function stageLabel(stage) {
  if (stage === 'S2') return 'S2 — доверие';
  if (stage === 'S3') return 'S3 — лёгкий флирт / эмоциональная близость';
  if (stage === 'S4') return 'S4 — встреча';
  return 'S1 — знакомство';
}

function advanceStageOnStrongReply(girl) {
  if (girl.stage === 'S1') girl.stage = 'S2';
  else if (girl.stage === 'S2') girl.stage = 'S3';
}

function isStrongReply(text) {
  const normalized = (text || '').toLowerCase();
  if (normalized.length > 40) return true;
  if (normalized.includes('?')) return true;
  if (normalized.includes('аха') || normalized.includes('ахах') || normalized.includes('lol')) return true;
  if (normalized.includes('😂') || normalized.includes('😄')) return true;
  if (normalized.includes('а ты')) return true;
  return false;
}

// --------------------
// Thread (dialog session)
// --------------------
function ensureThread(girl, mode) {
  if (!girl.thread || girl.thread.closed) {
    girl.thread = {
      id: `${now()}_${Math.random().toString(16).slice(2)}`,
      startedAt: now(),
      mode: mode || 'base',
      sentCount: 0,
      lastSentAt: null,
      closed: false,
      outcome: null,
    };
  } else {
    girl.thread.mode = mode || girl.thread.mode || 'base';
  }
  return girl.thread;
}

function closeThread(user, girl, outcome) {
  const thread = girl.thread;
  if (!thread || thread.closed) return null;

  thread.closed = true;
  thread.outcome = outcome;

  user.conv.conversations += 1;
  girl.conv.conversations += 1;

  const success = outcome === 'replied' || outcome === 'date';
  if (success) {
    user.conv.successes += 1;
    girl.conv.successes += 1;
  }
  return thread;
}

// --------------------
// Prompting (core)
// --------------------
const SYSTEM_PROMPT = `
Ты ассистент для переписки. Ты формулируешь ответы.
Жёсткие правила:
- Ты отправляешь сообщения девушке и притворяешься пользователем.
- Уважительно, без давления, без манипуляций и токсичности.
- Естественный современный русский, без кринж-пикап фраз и “театра”.
- Соблюдай “портрет пользователя”: его стиль, границы и запреты по фразам.
Формат ответа:
1) Лучший ответ (1 вариант, 1–2 строки)
2) Альтернативы (3-5 вариантов, тоже коротко)
3) Следующий вопрос (1-2)
4) Чего избегать (если уместно)
`.trim();

function renderProfile(p) {
  return `
Возраст: ${p.age}
Город: ${p.city}
Интересы/теги: ${p.interests}
Намерение/позиционирование: ${p.intent}

Короткая био-справка: ${p.bio}
Вайб/манера: ${p.vibe}
Границы: ${p.boundaries}
Не говорить: ${p.doNotSay}
Фирменная подача: ${p.signature}
`.trim();
}

function renderGirlNotes(girl) {
  const last = (girl.notes || []).slice(-6);
  if (!last.length) return 'нет';
  return last.map((n, i) => `• ${i + 1}) ${n.text}`).join('\n');
}

async function askLLM(prompt, system = null) {
  const input = system
    ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];

  const r = await client.responses.create({
    model: 'gpt-4.1-mini',
    input,
  });
  return (r.output_text || '').trim();
}

async function generateSuggestions({ user, girl, herMessage, chosenMode }) {
  const historyText = girl.history?.length
    ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n')
    : 'нет';

  const hint = learningHint(user);
  const pacing = user.settings.pacing || 'warm';
  const pacingHint =
    pacing === 'warm'
      ? 'Темп: тёплый. Держи комфорт, любопытство и продолжение диалога; микро-шаги без давления; встречи — только на S4 или при очень явных сигналах.'
      : 'Темп: быстрый. Можно активнее сближать и быстрее вести к встрече.';

  const prompt = `
ПОРТРЕТ ПОЛЬЗОВАТЕЛЯ:
${renderProfile(user.profile)}

АДАПТАЦИЯ ПО СТАТИСТИКЕ:
${hint.summary}
Инструкция: ${hint.instruction}

Контекст по девушке:
${girl.ctx}

Заметки по девушке (последние):
${renderGirlNotes(girl)}

Пейсинг: ${pacing}
Стадия: ${girl.stage} (${stageLabel(girl.stage)})
Правило: ${pacingHint}

Цель: ${user.goal}
Тон: ${user.tone}

A/B РЕЖИМ ДЛЯ ЭТОЙ ПОДБОРКИ:
${chosenMode} — ${modeInstruction(chosenMode)}

История:
${historyText}

Её сообщение:
${herMessage}

Сгенерируй ответ по формату из system.
`.trim();

  return askLLM(prompt, SYSTEM_PROMPT);
}

async function tweakLast({ user, tweakType }) {
  if (!user.last?.herMessage || !user.last?.suggestionsText) return null;

  let instruction = '';
  let modeName = 'base';
  switch (tweakType) {
    case 'short':
      instruction = 'Сделай варианты КОРОЧЕ, максимально по делу.';
      modeName = 'short';
      break;
    case 'funny':
      instruction = 'Сделай варианты СМЕШНЕЕ: лёгкий юмор, без кринжа.';
      modeName = 'funny';
      break;
    case 'bolder':
      instruction = 'Сделай варианты СМЕЛЕЕ: увереннее, чуть больше флирта, без давления.';
      modeName = 'bolder';
      break;
    case 'invite':
      instruction = 'Сделай варианты, которые мягко переводят к встрече/созвону (3 варианта приглашения).';
      modeName = 'invite';
      break;
    case 'why':
      instruction = 'Коротко объясни логику: почему лучший вариант лучший + какие сигналы в её сообщении.';
      modeName = user.last.mode || 'base';
      break;
    default:
      instruction = 'Улучши варианты.';
      modeName = user.last.mode || 'base';
  }

  const hint = learningHint(user);
  const pacing = user.settings.pacing || 'warm';
  const pacingHint =
    pacing === 'warm'
      ? 'Темп тёплый: комфорт, любопытство, продолжение; без давления, микро-шаги; встреча — только на S4 или при очень явных сигналах.'
      : 'Темп быстрый: можно активнее вести к встрече.';

  const prompt = `
ПОРТРЕТ:
${renderProfile(user.profile)}

АДАПТАЦИЯ:
${hint.summary}
Инструкция: ${hint.instruction}

Пейсинг: ${pacing} | ${pacingHint}

Её сообщение:
${user.last.herMessage}

Твои прошлые варианты:
${user.last.suggestionsText}

Задача:
${instruction}

Верни по формату (кроме "почему": там только объяснение).
`.trim();

  const out = await askLLM(prompt, SYSTEM_PROMPT + '\nЕсли просят объяснение — пиши кратко и по делу.');
  return { out, modeName };
}

// --------------------
// Extra LLM commands: analyze / flags / dateplan / ice / reengage
// --------------------
async function cmdAnalyze({ user, girl, herMessage }) {
  const hint = learningHint(user);
  const prompt = `
Проанализируй её сообщение и ситуацию. Дай:
1) Что она, вероятно, имела в виду (2–3 гипотезы)
2) Её уровень интереса (низкий/средний/высокий) и почему
3) 3 стратегии ответа (коротко)
4) 3 конкретных варианта ответа (в стиле пользователя)
5) Чего избегать

ПОРТРЕТ:
${renderProfile(user.profile)}
АДАПТАЦИЯ:
${hint.summary} | ${hint.instruction}

Контекст:
${girl.ctx}
Заметки:
${renderGirlNotes(girl)}
История:
${girl.history?.length ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n') : 'нет'}

Её сообщение:
${herMessage}
`.trim();

  return askLLM(prompt);
}

async function cmdFlags({ user, girl }) {
  const hint = learningHint(user);
  const prompt = `
По переписке выдели:
- Зеленые сигналы (интерес)
- Желтые (неясность)
- Красные (риски/токсичность/слив)
Дай короткие советы: что делать дальше.

ПОРТРЕТ:
${renderProfile(user.profile)}
АДАПТАЦИЯ:
${hint.summary} | ${hint.instruction}

Контекст:
${girl.ctx}
Заметки:
${renderGirlNotes(girl)}
История:
${girl.history?.length ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n') : 'нет'}
`.trim();

  return askLLM(prompt);
}

async function cmdDatePlan({ user, girl }) {
  const hint = learningHint(user);
  const prompt = `
Сделай план приглашения и встречи:
1) 3 сообщения-приглашения (разные стили: спокойное/с юмором/уверенное)
2) 3 варианта формата встречи (простые и реалистичные)
3) Сообщение в день встречи (подтверждение)
4) Если она “не может” — 2 варианта переноса без давления
5) После встречи — 2 сообщения

ПОРТРЕТ:
${renderProfile(user.profile)}
АДАПТАЦИЯ:
${hint.summary} | ${hint.instruction}

Контекст:
${girl.ctx}
Заметки:
${renderGirlNotes(girl)}
История:
${girl.history?.length ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n') : 'нет'}
`.trim();

  return askLLM(prompt);
}

async function cmdIce({ user, girl }) {
  const hint = learningHint(user);
  const prompt = `
Сгенерируй 5 коротких сообщений, чтобы начать/перезапустить диалог.
2 варианта с лёгким юмором, 2 спокойных, 1 мягко к встрече. 1–2 строки.

ПОРТРЕТ:
${renderProfile(user.profile)}
АДАПТАЦИЯ:
${hint.summary} | ${hint.instruction}
Контекст:
${girl.ctx}
Заметки:
${renderGirlNotes(girl)}
`.trim();

  return askLLM(prompt);
}

async function cmdReengage({ user, girl, hours }) {
  const hint = learningHint(user);
  const prompt = `
Пауза ~${hours} часов. Сгенерируй 4 коротких сообщения:
1) лёгкое уверенное
2) с юмором
3) тёплое
4) с мягким переводом к встрече/созвону
Без обид и пассивной агрессии. 1–2 строки каждое.

ПОРТРЕТ:
${renderProfile(user.profile)}
АДАПТАЦИЯ:
${hint.summary} | ${hint.instruction}
Контекст:
${girl.ctx}
Заметки:
${renderGirlNotes(girl)}
`.trim();

  return askLLM(prompt);
}

// --------------------
// Keyboards
// --------------------
function combinedKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔹 Короче', 'tweak_short'), Markup.button.callback('😄 Смешнее', 'tweak_funny')],
    [Markup.button.callback('🔥 Смелее', 'tweak_bolder'), Markup.button.callback('📍 Пригласи', 'tweak_invite')],
    [Markup.button.callback('🧠 Почему', 'tweak_why')],
    [Markup.button.callback('✅ Отправил: Лучший', 'sent_best')],
    [Markup.button.callback('✅ Alt1', 'sent_alt1'), Markup.button.callback('✅ Alt2', 'sent_alt2'), Markup.button.callback('✅ Alt3', 'sent_alt3')],
    [Markup.button.callback('💬 Она ответила', 'out_replied'), Markup.button.callback('💬 Ответила (с интересом)', 'out_strong_replied')],
    [Markup.button.callback('📅 Встреча', 'out_date')],
    [Markup.button.callback('👻 Пропала/не зашло', 'out_ghost')],
  ]);
}

// --------------------
// Commands: core
// --------------------
bot.start(async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const hint = learningHint(user);

  await ctx.reply(
    `DM-ассистент запущен.\n\n` +
      `Активная: ${key}\n` +
      `Контекст: ${girl.ctx}\n` +
      `Стадия: ${girl.stage} (${stageLabel(girl.stage)})\n` +
      `Notes: ${(girl.notes || []).length}\n\n` +
      `Success (общий): ${scoreText(user.conv)}\n` +
      `Стата: sent=${user.stats.sent}, replied=${user.stats.replied}, dates=${user.stats.dates}, ghost=${user.stats.ghosts}\n` +
      `A/B autopick: ${user.settings.autopick ? 'ON' : 'OFF'}\n` +
      `Pacing: ${user.settings.pacing}\n` +
      `Autoghost: ${user.settings.autoghostHours}h\n` +
      `Адаптация: ${hint.summary}\n\n` +
      `Команды:\n` +
      `/girl <имя> | /girls | /ctx <контекст> | /reset\n` +
      `/note <заметка> | /notes\n` +
      `/ice | /reengage [часы]\n` +
      `/analyze (последнее её сообщение) | /flags | /dateplan\n` +
      `/stats | /gstats | /score | /gscore | /modes | /gmodes\n` +
      `/autopick on|off | /autoghost <hours|off>\n` +
      `/pacing warm|fast\n` +
      `/sent <текст>\n` +
      `/export | /backup\n\n` +
      `Пришли её сообщение — дам варианты + кнопки.`
  );
});

bot.command('girl', async (ctx) => {
  const user = getUser(ctx.from.id);
  const name = ctx.message.text.replace('/girl', '').trim();
  if (!name) return ctx.reply('Пример: /girl anya');
  const { key, data } = getGirl(user, name);
  saveStore();
  await ctx.reply(
    `Ок. Активная: ${key}\nКонтекст: ${data.ctx}\nNotes: ${(data.notes || []).length}\nСтадия: ${data.stage} (${stageLabel(data.stage)})\nSuccess: ${scoreText(data.conv)}`
  );
});

bot.command('girls', async (ctx) => {
  const user = getUser(ctx.from.id);
  const names = Object.keys(user.girls);
  await ctx.reply(`Девушки: ${names.join(', ')}\nАктивная: ${user.activeGirl}`);
});

bot.command('ctx', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { data } = getGirl(user, user.activeGirl);
  const text = ctx.message.text.replace('/ctx', '').trim();
  if (!text) return ctx.reply('Пример: /ctx познакомились в инсте, любит кофе');
  data.ctx = text;
  saveStore();
  await ctx.reply('Контекст сохранён.');
});

bot.command('reset', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data } = getGirl(user, user.activeGirl);
  data.history = [];
  data.thread = null;
  user.last = null;
  saveStore();
  await ctx.reply(`Ок. История и тред очищены для "${key}"`);
});

// notes
bot.command('note', async (ctx) => {
  const user = getUser(ctx.from.id);
  const text = ctx.message.text.replace('/note', '').trim();
  if (!text) return ctx.reply('Пример: /note любит кофе, не любит пассивную агрессию');
  const { key, data: girl } = getGirl(user, user.activeGirl);
  addNote(girl, text);
  saveStore();
  await ctx.reply(`Сохранил заметку для "${key}". Всего notes: ${girl.notes.length}`);
});

bot.command('notes', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const last = (girl.notes || []).slice(-12);
  if (!last.length) return ctx.reply(`У "${key}" пока нет заметок. Добавь: /note ...`);
  await ctx.reply(`Заметки "${key}" (последние):\n` + last.map((n, i) => `• ${i + 1}) ${n.text}`).join('\n'));
});

// toggles
bot.command('autopick', async (ctx) => {
  const user = getUser(ctx.from.id);
  const arg = ctx.message.text.replace('/autopick', '').trim().toLowerCase();
  if (!arg) return ctx.reply(`Сейчас autopick: ${user.settings.autopick ? 'ON' : 'OFF'}\nПример: /autopick on`);
  user.settings.autopick = arg === 'on' || arg === 'true' || arg === '1';
  saveStore();
  await ctx.reply(`A/B autopick: ${user.settings.autopick ? 'ON' : 'OFF'}`);
});

bot.command('autoghost', async (ctx) => {
  const user = getUser(ctx.from.id);
  const arg = ctx.message.text.replace('/autoghost', '').trim().toLowerCase();
  if (!arg) return ctx.reply(`Сейчас autoghost: ${user.settings.autoghostHours}h\nПример: /autoghost 48 или /autoghost off`);
  if (arg === 'off') {
    user.settings.autoghostHours = 0;
    saveStore();
    return ctx.reply('Autoghost выключен.');
  }
  const n = Number(arg);
  if (!Number.isFinite(n) || n <= 0 || n > 720) return ctx.reply('Введи часы (1..720) или off.');
  user.settings.autoghostHours = Math.round(n);
  saveStore();
  await ctx.reply(`Autoghost: ${user.settings.autoghostHours}h`);
});

bot.command('pacing', async (ctx) => {
  const user = getUser(ctx.from.id);
  const arg = ctx.message.text.replace('/pacing', '').trim().toLowerCase();
  if (!arg) return ctx.reply(`Сейчас pacing: ${user.settings.pacing}\nПример: /pacing warm`);
  if (arg !== 'warm' && arg !== 'fast') return ctx.reply('Варианты: /pacing warm или /pacing fast');
  user.settings.pacing = arg;
  saveStore();
  await ctx.reply(`Pacing: ${user.settings.pacing}`);
});

// ice / reengage
bot.command('ice', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  await ctx.reply(`Думаю… (ice для "${key}")`);
  try {
    const out = await cmdIce({ user, girl });
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('reengage', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const arg = ctx.message.text.replace('/reengage', '').trim();
  let hours = 24;
  if (arg) {
    const n = Number(arg);
    if (Number.isFinite(n) && n > 0 && n < 1000) hours = Math.round(n);
  }
  await ctx.reply(`Думаю… (разморозка ${hours}ч для "${key}")`);
  try {
    const out = await cmdReengage({ user, girl, hours });
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// NEW: analyze / flags / dateplan
bot.command('analyze', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const herMessage = user.last?.herMessage;
  if (!herMessage) return ctx.reply('Нет последнего её сообщения. Сначала пришли её текст, потом /analyze');
  await ctx.reply(`Думаю… (analyze для "${key}")`);
  try {
    const out = await cmdAnalyze({ user, girl, herMessage });
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('flags', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  await ctx.reply(`Думаю… (flags для "${key}")`);
  try {
    const out = await cmdFlags({ user, girl });
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('dateplan', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  await ctx.reply(`Думаю… (dateplan для "${key}")`);
  try {
    const out = await cmdDatePlan({ user, girl });
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// export / backup
bot.command('export', async (ctx) => {
  try {
    await ctx.replyWithDocument({ source: DATA_FILE, filename: 'data.json' }, { caption: 'Твой data.json (экспорт)' });
  } catch (e) {
    await ctx.reply(`Ошибка экспорта: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('backup', async (ctx) => {
  try {
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `data.backup-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
    const backupPath = path.resolve(`./${name}`);
    fs.copyFileSync(DATA_FILE, backupPath);
    await ctx.replyWithDocument({ source: backupPath, filename: name }, { caption: 'Бэкап создан' });
  } catch (e) {
    await ctx.reply(`Ошибка бэкапа: ${e?.message ?? 'unknown'}`);
  }
});

// stats/modes/score
bot.command('stats', async (ctx) => {
  const user = getUser(ctx.from.id);
  const hint = learningHint(user);
  const s = user.stats;
  await ctx.reply(
    `Стата (общая):\n` +
      `sent=${s.sent}\nreplied=${s.replied} (${pct(s.replied, s.sent)}%)\n` +
      `strongReplied=${s.strongReplied}\n` +
      `dates=${s.dates} (${pct(s.dates, s.sent)}%)\n` +
      `ghost=${s.ghosts}\n\n` +
      `Success Score: ${scoreText(user.conv)}\n` +
      `Адаптация: ${hint.summary}\nИнструкция: ${hint.instruction}\n` +
      `A/B autopick: ${user.settings.autopick ? 'ON' : 'OFF'} | Pacing: ${user.settings.pacing} | Autoghost: ${user.settings.autoghostHours}h`
  );
});

bot.command('gstats', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const s = girl.stats;
  await ctx.reply(
    `Стата по "${key}":\n` +
      `sent=${s.sent}\nreplied=${s.replied} (${pct(s.replied, s.sent)}%)\n` +
      `strongReplied=${s.strongReplied}\n` +
      `dates=${s.dates} (${pct(s.dates, s.sent)}%)\n` +
      `ghost=${s.ghosts}\n\n` +
      `Success Score: ${scoreText(girl.conv)}`
  );
});

bot.command('score', async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.reply(`Success Score (общий): ${scoreText(user.conv)}`);
});

bot.command('gscore', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  await ctx.reply(`Success Score по "${key}": ${scoreText(girl.conv)}`);
});

bot.command('modes', async (ctx) => {
  const user = getUser(ctx.from.id);
  const rep = modeReport(user.modeStats);
  await ctx.reply(`Стратегии (общие):\n${rep.lines}\n\nТоп сейчас: ${rep.bestMode}`);
});

bot.command('gmodes', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const rep = modeReport(girl.modeStats);
  await ctx.reply(`Стратегии по "${key}":\n${rep.lines}\n\nТоп сейчас: ${rep.bestMode}`);
});

// manual /sent
bot.command('sent', async (ctx) => {
  const user = getUser(ctx.from.id);
  const text = ctx.message.text.replace('/sent', '').trim();
  if (!text) return ctx.reply('Пример: /sent я тоже люблю кофе, давай проверим твоё место 🙂');

  const { data: girl } = getGirl(user, user.activeGirl);
  pushHistory(girl, 'me', text);

  const mode = user.last?.mode || 'base';
  const thread = ensureThread(girl, mode);
  thread.sentCount += 1;
  thread.lastSentAt = now();

  user.stats.sent += 1;
  girl.stats.sent += 1;
  bumpModeStats(user, mode, null, 1);
  bumpModeStats(girl, mode, null, 1);

  saveStore();
  await ctx.reply('Ок. Сохранил твоё сообщение как "Я:" + увеличил sent и открыл/обновил тред.');
});

// --------------------
// Incoming her message => auto-close replied if thread open
// --------------------
async function autoMarkRepliedIfNeeded(user, girl, herMessage) {
  const t = girl.thread;
  if (t && !t.closed && t.sentCount > 0) {
    const mode = t.mode || 'base';
    const strong = isStrongReply(herMessage);
    const outcome = strong ? 'strongReplied' : 'replied';

    // counts
    user.stats.replied += 1;
    girl.stats.replied += 1;
    if (strong) {
      user.stats.strongReplied += 1;
      girl.stats.strongReplied += 1;
      advanceStageOnStrongReply(girl);
    }

    bumpModeStats(user, mode, outcome, 0);
    bumpModeStats(girl, mode, outcome, 0);

    updateLearning(user, mode, outcome, { pacing: user.settings.pacing, stage: girl.stage, sentCount: t.sentCount });
    closeThread(user, girl, outcome);

    return { did: true, mode, strong };
  }
  return { did: false, mode: null, strong: false };
}

// --------------------
// Main: incoming her message -> generate suggestions
// --------------------
bot.on('text', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);

  const herMessage = (ctx.message.text || '').trim();
  if (herMessage.length < 2) return;
  if (herMessage.startsWith('/')) return;

  // если она ответила после твоего sent — автоматически засчитываем replied
  const auto = await autoMarkRepliedIfNeeded(user, girl, herMessage);

  // сохраняем её сообщение в историю
  pushHistory(girl, 'her', herMessage);

  // A/B mode selection
  let chosenMode = 'base';
  if (user.settings.autopick) chosenMode = pickMode(user, girl);

  await ctx.reply(
    `Думаю… (девушка: ${key})` +
      (auto.did ? `\nАвто-метка: ${auto.strong ? '💬 ответила (с интересом)' : '💬 она ответила'} (mode=${auto.mode})` : '') +
      (user.settings.autopick ? `\nA/B режим: ${chosenMode}` : '')
  );

  try {
    const suggestions = await generateSuggestions({
      user,
      girl,
      herMessage,
      chosenMode,
    });

    user.last = {
      herMessage,
      suggestionsText: suggestions,
      girlName: key,
      mode: chosenMode, // base|short|funny|bolder|invite
    };

    saveStore();
    await ctx.reply(suggestions, combinedKeyboard());
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// --------------------
// Buttons: tweaks
// --------------------
async function handleTweak(ctx, tweakType) {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();

  const res = await tweakLast({ user, tweakType });
  if (!res) return ctx.reply('Нет последнего сообщения. Пришли сначала её текст.');

  user.last.suggestionsText = res.out;
  user.last.mode = res.modeName;
  saveStore();

  return ctx.reply(res.out, combinedKeyboard());
}

bot.action('tweak_short', (ctx) => handleTweak(ctx, 'short'));
bot.action('tweak_funny', (ctx) => handleTweak(ctx, 'funny'));
bot.action('tweak_bolder', (ctx) => handleTweak(ctx, 'bolder'));
bot.action('tweak_invite', (ctx) => handleTweak(ctx, 'invite'));

bot.action('tweak_why', async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();
  const res = await tweakLast({ user, tweakType: 'why' });
  if (!res) return ctx.reply('Нет последнего сообщения. Пришли сначала её текст.');
  return ctx.reply(res.out);
});

// --------------------
// Buttons: sent_* (auto-save my message + open thread)
// --------------------
async function handleSent(ctx, which) {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();

  if (!user.last?.suggestionsText) {
    return ctx.reply('Нет последних вариантов. Сначала пришли её сообщение.');
  }

  const { best, alts } = parseSuggestions(user.last.suggestionsText);
  let chosen = '';
  if (which === 'best') chosen = best;
  if (which === 'alt1') chosen = alts[0] || '';
  if (which === 'alt2') chosen = alts[1] || '';
  if (which === 'alt3') chosen = alts[2] || '';
  chosen = cleanText(chosen);

  if (!chosen) {
    return ctx.reply('Не смог вытащить текст. Используй /sent <текст который ты реально отправил>');
  }

  const girlName = user.last.girlName || user.activeGirl;
  const { data: girl } = getGirl(user, girlName);

  pushHistory(girl, 'me', chosen);

  const mode = user.last.mode || 'base';
  const thread = ensureThread(girl, mode);
  thread.sentCount += 1;
  thread.lastSentAt = now();

  user.stats.sent += 1;
  girl.stats.sent += 1;

  bumpModeStats(user, mode, null, 1);
  bumpModeStats(girl, mode, null, 1);

  saveStore();
  return ctx.reply(`Сохранил "Я отправил":\n${chosen}\n\nТред: ${thread.id} (mode=${thread.mode})`);
}

bot.action('sent_best', (ctx) => handleSent(ctx, 'best'));
bot.action('sent_alt1', (ctx) => handleSent(ctx, 'alt1'));
bot.action('sent_alt2', (ctx) => handleSent(ctx, 'alt2'));
bot.action('sent_alt3', (ctx) => handleSent(ctx, 'alt3'));

// --------------------
// Buttons: outcomes (manual close thread)
// --------------------
async function handleOutcome(ctx, outcome) {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();

  const girlName = user.last?.girlName || user.activeGirl;
  const { key, data: girl } = getGirl(user, girlName);

  if (!girl.thread || girl.thread.closed) {
    return ctx.reply('Нет активного треда. Сначала нажми ✅ Отправил (или /sent ...), потом исход.');
  }

  const mode = girl.thread.mode || user.last?.mode || 'base';

  if (outcome === 'replied' || outcome === 'strongReplied') {
    user.stats.replied += 1;
    girl.stats.replied += 1;
    if (outcome === 'strongReplied') {
      user.stats.strongReplied += 1;
      girl.stats.strongReplied += 1;
      advanceStageOnStrongReply(girl);
    }
  } else if (outcome === 'date') {
    user.stats.dates += 1;
    girl.stats.dates += 1;
    girl.stage = 'S4';
  } else {
    user.stats.ghosts += 1;
    girl.stats.ghosts += 1;
  }

  bumpModeStats(user, mode, outcome, 0);
  bumpModeStats(girl, mode, outcome, 0);

  updateLearning(user, mode, outcome, { pacing: user.settings.pacing, stage: girl.stage, sentCount: girl.thread.sentCount });

  const closed = closeThread(user, girl, outcome);
  saveStore();

  const hint = learningHint(user);
  const msg =
    outcome === 'replied'
      ? 'Отметил: она ответила ✅'
      : outcome === 'strongReplied'
      ? 'Отметил: ответила с интересом 💬'
      : outcome === 'date'
      ? 'Отметил: встреча/созвон 📅'
      : 'Отметил: пропала/не зашло 👻';

  return ctx.reply(
    `${msg}\n` +
      `Тред закрыт: ${closed.id} (mode=${mode}, sent=${closed.sentCount})\n\n` +
      `Success (общий): ${scoreText(user.conv)}\n` +
      `Success ("${key}"): ${scoreText(girl.conv)}\n\n` +
      `Адаптация: ${hint.summary}\nИнструкция: ${hint.instruction}`
  );
}

bot.action('out_replied', (ctx) => handleOutcome(ctx, 'replied'));
bot.action('out_strong_replied', (ctx) => handleOutcome(ctx, 'strongReplied'));
bot.action('out_date', (ctx) => handleOutcome(ctx, 'date'));
bot.action('out_ghost', (ctx) => handleOutcome(ctx, 'ghost'));

// --------------------
// Autoghost timer
// --------------------
function autoghostSweep() {
  // раз в минуту проверяем все треды
  try {
    for (const [, uRaw] of store.entries()) {
      const user = ensureUserSchema(uRaw);
      const hours = user.settings.autoghostHours || 0;
      if (!hours) continue;

      const cutoff = now() - hours * 60 * 60 * 1000;

      for (const [, girl] of Object.entries(user.girls)) {
        const t = girl.thread;
        if (!t || t.closed) continue;
        if (!t.lastSentAt) continue;
        if (t.sentCount <= 0) continue;

        if (t.lastSentAt < cutoff) {
          // авто-ghost
          const mode = t.mode || 'base';

          user.stats.ghosts += 1;
          girl.stats.ghosts += 1;

          bumpModeStats(user, mode, 'ghost', 0);
          bumpModeStats(girl, mode, 'ghost', 0);

          updateLearning(user, mode, 'ghost', { pacing: user.settings.pacing, stage: girl.stage, sentCount: t.sentCount });
          closeThread(user, girl, 'ghost');
        }
      }
    }
    saveStore();
  } catch (e) {
    console.error('Autoghost sweep error:', e?.message || e);
  }
}
setInterval(autoghostSweep, 60_000);

// --------------------
// Launch
// --------------------
bot.launch();
console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
