import { getStore, loadStore, saveStore } from './dataStore.js';

export function now() {
  return Date.now();
}

export function cleanText(s) {
  return (s || '')
    .replace(/\r/g, '')
    .replace(/^[\s\-–—•\d\)\.]+/, '')
    .trim();
}

export function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function parseSuggestions(text) {
  const t = (text || '').replace(/\r/g, '');
  const cleaned = t.split('\n—\nDebug:')[0];

  let best = '';
  const mBest = cleaned.match(/(?:^|\n)\s*1\)\s*([\s\S]*?)(?=(?:\n\s*2\)|$))/i);
  if (mBest && mBest[1]) best = cleanText((mBest[1].split('\n')[0] || mBest[1]).trim());

  let alts = [];
  const mAlt = cleaned.match(/(?:^|\n)\s*2\)\s*([\s\S]*?)(?=(?:\n\s*3\)|$))/i);
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
    const firstLine = (cleaned.split('\n').find((x) => x.trim().length > 0) || '').trim();
    best = cleanText(firstLine);
  }

  return { best, alts };
}

export function ensureModeStats(obj) {
  const modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  if (!obj.modeStats) obj.modeStats = {};
  for (const m of modes) {
    if (!obj.modeStats[m]) obj.modeStats[m] = { sent: 0, replied: 0, strongReplied: 0, dates: 0, datePlanned: 0, ghosts: 0 };
    for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'datePlanned', 'ghosts']) {
      if (typeof obj.modeStats[m][k] !== 'number') obj.modeStats[m][k] = 0;
    }
  }
}

export function ensureUserSchema(u) {
  if (!u.tone) u.tone = 'уверенно-иронично';
  if (!u.goal) u.goal = 'общение → встреча';
  if (!u.profile) u.profile = {};
  if (!u.girls) u.girls = { default: { ctx: 'нет', history: [] } };
  if (!u.activeGirl) u.activeGirl = 'default';
  if (!u.last) u.last = null;

  if (!u.settings) u.settings = {};
  if (typeof u.settings.autoghostHours !== 'number') u.settings.autoghostHours = 48;
  if (typeof u.settings.autopick !== 'boolean') u.settings.autopick = true;
  if (!u.settings.pacing || !['warm', 'fast'].includes(u.settings.pacing)) u.settings.pacing = 'warm';

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

  if (!u.stats) u.stats = { sent: 0, replied: 0, strongReplied: 0, dates: 0, datePlanned: 0, ghosts: 0 };
  for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'datePlanned', 'ghosts']) if (typeof u.stats[k] !== 'number') u.stats[k] = 0;

  if (!u.conv) u.conv = { conversations: 0, successes: 0 };
  for (const k of ['conversations', 'successes']) if (typeof u.conv[k] !== 'number') u.conv[k] = 0;

  if (!u.learning) u.learning = {};
  if (typeof u.learning.enabled !== 'boolean') u.learning.enabled = true;
  if (typeof u.learning.debug !== 'boolean') u.learning.debug = false;
  if (!u.learning.weights) {
    u.learning.weights = {
      warmth: 0.7,
      brevity: 0.55,
      humor: 0.35,
      curiosity: 0.75,
      flirt: 0.25,
      inviteRate: 0.15,
    };
  }
  for (const k of ['warmth', 'brevity', 'humor', 'curiosity', 'flirt', 'inviteRate']) {
    if (typeof u.learning.weights[k] !== 'number') u.learning.weights[k] = 0;
    u.learning.weights[k] = clamp(u.learning.weights[k], 0, 1);
  }
  if (!u.learning.modeStats) u.learning.modeStats = {};
  for (const m of ['base', 'short', 'funny', 'bolder', 'invite']) {
    if (!u.learning.modeStats[m]) u.learning.modeStats[m] = { tries: 0, replied: 0, strongReplied: 0, ghost: 0, datePlanned: 0 };
    for (const k of ['tries', 'replied', 'strongReplied', 'ghost', 'datePlanned']) {
      if (typeof u.learning.modeStats[m][k] !== 'number') u.learning.modeStats[m][k] = 0;
    }
  }

  ensureModeStats(u);

  for (const [, g] of Object.entries(u.girls)) {
    if (!g.ctx) g.ctx = 'нет';
    if (!Array.isArray(g.history)) g.history = [];
    if (!Array.isArray(g.notes)) g.notes = [];

    if (!g.stats) g.stats = { sent: 0, replied: 0, dates: 0, ghosts: 0 };
    if (typeof g.stats.strongReplied !== 'number') g.stats.strongReplied = 0;
    if (typeof g.stats.datePlanned !== 'number') g.stats.datePlanned = 0;
    for (const k of ['sent', 'replied', 'strongReplied', 'dates', 'datePlanned', 'ghosts']) if (typeof g.stats[k] !== 'number') g.stats[k] = 0;

    if (!g.conv) g.conv = { conversations: 0, successes: 0 };
    for (const k of ['conversations', 'successes']) if (typeof g.conv[k] !== 'number') g.conv[k] = 0;

    ensureModeStats(g);

    if (!g.stage || !['S1', 'S2', 'S3', 'S4'].includes(g.stage)) g.stage = 'S1';
    if (!g.prefWeights) g.prefWeights = { warmth: 0, brevity: 0, humor: 0, curiosity: 0, flirt: 0, inviteRate: 0 };
    for (const k of ['warmth', 'brevity', 'humor', 'curiosity', 'flirt', 'inviteRate']) {
      if (typeof g.prefWeights[k] !== 'number') g.prefWeights[k] = 0;
    }
    if (typeof g.consecutiveExchanges !== 'number') g.consecutiveExchanges = 0;

    if (!g.thread) g.thread = null;
  }

  return u;
}

export function getUser(userId) {
  loadStore();
  const store = getStore();
  const id = String(userId);
  if (!store.has(id)) {
    store.set(id, ensureUserSchema({}));
    saveStore();
  } else {
    ensureUserSchema(store.get(id));
  }
  return store.get(id);
}

export function getGirl(user, name) {
  const key = (name || user.activeGirl || 'default').trim() || 'default';
  if (!user.girls[key]) {
    user.girls[key] = {
      ctx: 'нет',
      history: [],
      notes: [],
      stats: { sent: 0, replied: 0, strongReplied: 0, dates: 0, datePlanned: 0, ghosts: 0 },
      conv: { conversations: 0, successes: 0 },
      modeStats: {},
      stage: 'S1',
      prefWeights: { warmth: 0, brevity: 0, humor: 0, curiosity: 0, flirt: 0, inviteRate: 0 },
      consecutiveExchanges: 0,
      thread: null,
    };
  }
  user.activeGirl = key;
  ensureUserSchema(user);
  return { key, data: user.girls[key] };
}

export function pushHistory(girl, role, text) {
  girl.history.push({ role, text: cleanText(text) });
  if (girl.history.length > 16) girl.history = girl.history.slice(-16);
}

export function addNote(girl, text) {
  girl.notes.push({ ts: now(), text: cleanText(text) });
  if (girl.notes.length > 60) girl.notes = girl.notes.slice(-60);
}

export function weightsSummary(weights) {
  return `W:${weights.warmth.toFixed(2)} B:${weights.brevity.toFixed(2)} H:${weights.humor.toFixed(2)} C:${weights.curiosity.toFixed(2)} F:${weights.flirt.toFixed(2)} I:${weights.inviteRate.toFixed(2)}`;
}

export function getEffectiveWeights(user, girl) {
  const base = user.learning.weights;
  const pref = girl?.prefWeights || {};
  const merged = {};
  for (const k of ['warmth', 'brevity', 'humor', 'curiosity', 'flirt', 'inviteRate']) {
    const delta = typeof pref[k] === 'number' ? pref[k] : 0;
    merged[k] = clamp((base[k] ?? 0) + delta, 0, 1);
  }
  return merged;
}

export function updateLearning(user, girl, outcome, options = {}) {
  if (!user.learning.enabled) return;
  const stage = options.stage || girl?.stage || 'S1';
  const sentCount = options.sentCount || 0;
  const weights = user.learning.weights;

  function applyDelta(deltas) {
    for (const [k, v] of Object.entries(deltas)) {
      weights[k] = clamp(weights[k] + v, 0, 1);
    }
  }

  if (outcome === 'strongReplied') {
    const extraInvite = stage === 'S3' || stage === 'S4' ? 0.005 : 0;
    applyDelta({ warmth: 0.03, curiosity: 0.03, brevity: -0.01, inviteRate: extraInvite });
    return;
  }

  if (outcome === 'replied') {
    applyDelta({ warmth: 0.015, curiosity: 0.01 });
    return;
  }

  if (outcome === 'ghost') {
    if (stage === 'S1' && sentCount <= 1) {
      applyDelta({ inviteRate: -0.005, flirt: -0.01 });
    } else {
      applyDelta({ inviteRate: -0.02, flirt: -0.02, warmth: 0.01, brevity: 0.01 });
    }
    return;
  }

  if (outcome === 'datePlanned') {
    applyDelta({ inviteRate: 0.03, warmth: 0.01, curiosity: 0.01 });
  }
}

export function applyStreakBonus(user) {
  if (!user.learning.enabled) return;
  const weights = user.learning.weights;
  weights.warmth = clamp(weights.warmth + 0.01, 0, 1);
  weights.curiosity = clamp(weights.curiosity + 0.01, 0, 1);
}

export function learningHint(user, girl) {
  const weights = getEffectiveWeights(user, girl);
  const inst = [];
  if (weights.warmth >= 0.75) inst.push('теплее');
  if (weights.brevity >= 0.7) inst.push('короче');
  if (weights.humor >= 0.5) inst.push('лёгкий юмор');
  if (weights.curiosity >= 0.7) inst.push('больше интереса/вопросов');
  if (weights.flirt >= 0.4) inst.push('чуть флирта');
  if (weights.inviteRate >= 0.3) inst.push('аккуратнее к встрече');
  return {
    summary: weightsSummary(weights),
    instruction: inst.length ? inst.join('; ') : 'держи баланс',
  };
}

export function ensureLearningModeStats(user) {
  if (!user.learning.modeStats) user.learning.modeStats = {};
  for (const m of ['base', 'short', 'funny', 'bolder', 'invite']) {
    if (!user.learning.modeStats[m]) user.learning.modeStats[m] = { tries: 0, replied: 0, strongReplied: 0, ghost: 0, datePlanned: 0 };
  }
}

export function bumpLearningModeTry(user, mode) {
  ensureLearningModeStats(user);
  const ms = user.learning.modeStats[mode || 'base'];
  ms.tries += 1;
}

export function bumpLearningModeOutcome(user, mode, outcome) {
  ensureLearningModeStats(user);
  const ms = user.learning.modeStats[mode || 'base'];
  if (outcome === 'replied') ms.replied += 1;
  if (outcome === 'strongReplied') ms.strongReplied += 1;
  if (outcome === 'ghost') ms.ghost += 1;
  if (outcome === 'datePlanned') ms.datePlanned += 1;
}

export function bumpModeStats(obj, mode, outcome, sentIncrement = 0) {
  ensureModeStats(obj);
  const m = obj.modeStats[mode || 'base'] || obj.modeStats.base;
  if (sentIncrement) m.sent += sentIncrement;
  if (outcome === 'replied') m.replied += 1;
  if (outcome === 'strongReplied') {
    m.replied += 1;
    m.strongReplied += 1;
  }
  if (outcome === 'datePlanned') m.datePlanned += 1;
  if (outcome === 'date') m.dates += 1;
  if (outcome === 'ghost') m.ghosts += 1;
}

export function scoreText(conv) {
  return `${conv.successes}/${conv.conversations} (${pct(conv.successes, conv.conversations)}%)`;
}

export function modeReport(modeStats) {
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

export function pickMode(user, girl) {
  const pacing = user.settings.pacing || 'warm';
  const stage = girl?.stage || 'S1';
  let modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  if (stage === 'S1' || stage === 'S2') modes = ['base', 'short', 'funny'];
  if (stage === 'S3') modes = ['base', 'short', 'funny', 'bolder'];
  if (stage === 'S4') modes = ['base', 'short', 'funny', 'bolder', 'invite'];
  const eps = 0.1;
  if (Math.random() < eps) return modes[Math.floor(Math.random() * modes.length)];

  ensureLearningModeStats(user);
  const weights = getEffectiveWeights(user, girl);
  const stageGate = stage === 'S4' ? 1 : 0.05;

  const vals = modes.map((m) => {
    const s = user.learning.modeStats[m] || { tries: 0, replied: 0, strongReplied: 0, ghost: 0, datePlanned: 0 };
    const tries = s.tries || 0;
    const replyScore = (s.replied + 1) / (tries + 3);
    const strongScore = (s.strongReplied + 0.5) / (tries + 3);
    const dateScore = (s.datePlanned + 0.2) / (tries + 4);
    const ghostScore = (s.ghost + 0.2) / (tries + 4);
    let score = replyScore * 2 + strongScore * 3 + dateScore * stageGate - ghostScore;

    if (m === 'base') score += weights.warmth * 0.25;
    if (m === 'short') score += weights.brevity * 0.22;
    if (m === 'funny') score += weights.humor * 0.22;
    if (m === 'bolder') score += weights.flirt * 0.2;
    if (m === 'invite') score += weights.inviteRate * (stage === 'S4' ? 0.25 : 0.05);
    if (pacing === 'warm' && stage === 'S3' && m === 'bolder') score *= 0.7;

    return { m, v: score };
  });

  vals.sort((a, b) => b.v - a.v);
  return vals[0].m;
}

export function modeInstruction(mode) {
  if (mode === 'short') return 'Сделай основной ответ коротким, максимально по делу.';
  if (mode === 'funny') return 'Добавь лёгкий уместный юмор, без кринжа.';
  if (mode === 'bolder') return 'Сделай увереннее и чуть более флиртово, но без давления.';
  if (mode === 'invite') return 'Слегка подведи к созвону/встрече, мягко.';
  return 'Держи баланс.';
}

export function stageLabel(stage) {
  if (stage === 'S2') return 'S2 — доверие';
  if (stage === 'S3') return 'S3 — лёгкий флирт / эмоциональная близость';
  if (stage === 'S4') return 'S4 — встреча';
  return 'S1 — знакомство';
}

export function advanceStageOnStrongReply(girl) {
  if (girl.stage === 'S1') girl.stage = 'S2';
  else if (girl.stage === 'S2') girl.stage = 'S3';
}

export function isStrongReply(text) {
  const normalized = (text || '').toLowerCase();
  if (normalized.length > 40) return true;
  if (normalized.includes('?')) return true;
  if (normalized.includes('аха') || normalized.includes('ахах') || normalized.includes('lol')) return true;
  if (normalized.includes('😂') || normalized.includes('😄')) return true;
  if (normalized.includes('а ты')) return true;
  return false;
}

export function ensureThread(girl, mode) {
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
    girl.consecutiveExchanges = 0;
  } else {
    girl.thread.mode = mode || girl.thread.mode || 'base';
  }
  return girl.thread;
}

export function closeThread(user, girl, outcome) {
  const thread = girl.thread;
  if (!thread || thread.closed) return null;

  thread.closed = true;
  thread.outcome = outcome;

  user.conv.conversations += 1;
  girl.conv.conversations += 1;

  const success = outcome === 'replied' || outcome === 'strongReplied' || outcome === 'date' || outcome === 'datePlanned';
  if (success) {
    user.conv.successes += 1;
    girl.conv.successes += 1;
  }
  girl.consecutiveExchanges = 0;
  return thread;
}
