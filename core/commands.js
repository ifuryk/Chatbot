import fs from 'fs';
import path from 'path';
import {
  advanceStageOnStrongReply,
  applyStreakBonus,
  bumpLearningModeOutcome,
  bumpLearningModeTry,
  bumpModeStats,
  cleanText,
  closeThread,
  ensureLearningModeStats,
  ensureThread,
  getEffectiveWeights,
  getGirl,
  getUser,
  isStrongReply,
  learningHint,
  modeInstruction,
  modeReport,
  parseSuggestions,
  pickMode,
  pushHistory,
  scoreText,
  stageLabel,
  updateLearning,
  weightsSummary,
} from './state.js';
import { getDataFile, getStore, saveStore } from './dataStore.js';

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

export function createCommands({ client }) {
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

  async function generateSuggestions(user, girl, herMessage, chosenMode) {
    const historyText = girl.history?.length
      ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n')
      : 'нет';

    const hint = learningHint(user, girl);
    const pacing = user.settings.pacing || 'warm';
    const pacingHint =
      pacing === 'warm'
        ? 'Темп: тёплый. Держи комфорт, любопытство и продолжение диалога; микро-шаги без давления; встречи — только на S4 или при очень явных сигналах.'
        : 'Темп: быстрый. Можно активнее сближать и быстрее вести к встрече.';
    const weights = getEffectiveWeights(user, girl);
    const girlPref = girl.prefWeights || {};
    const prefLine =
      Object.values(girlPref).some((v) => v !== 0)
        ? `GirlΔ: W${girlPref.warmth || 0}, B${girlPref.brevity || 0}, H${girlPref.humor || 0}, C${girlPref.curiosity || 0}, F${girlPref.flirt || 0}, I${girlPref.inviteRate || 0}`
        : 'GirlΔ: 0';

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

Весовые предпочтения: ${weightsSummary(weights)} | ${prefLine}

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

  async function tweakLast(user, tweakType) {
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

    const { data: girl } = getGirl(user, user.last?.girlName || user.activeGirl);
    const hint = learningHint(user, girl);
    const pacing = user.settings.pacing || 'warm';
    const pacingHint =
      pacing === 'warm'
        ? 'Темп тёплый: комфорт, любопытство, продолжение; без давления, микро-шаги; встреча — только на S4 или при очень явных сигналах.'
        : 'Темп быстрый: можно активнее вести к встрече.';
    const weights = getEffectiveWeights(user, girl);
    const girlPref = girl.prefWeights || {};
    const prefLine =
      Object.values(girlPref).some((v) => v !== 0)
        ? `GirlΔ: W${girlPref.warmth || 0}, B${girlPref.brevity || 0}, H${girlPref.humor || 0}, C${girlPref.curiosity || 0}, F${girlPref.flirt || 0}, I${girlPref.inviteRate || 0}`
        : 'GirlΔ: 0';

    const prompt = `
ПОРТРЕТ:
${renderProfile(user.profile)}

АДАПТАЦИЯ:
${hint.summary}
Инструкция: ${hint.instruction}

Пейсинг: ${pacing} | ${pacingHint}
Весовые предпочтения: ${weightsSummary(weights)} | ${prefLine}

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

  async function analyzeLastMessage(userId) {
    const user = getUser(userId);
    const { data: girl } = getGirl(user, user.activeGirl);
    const herMessage = user.last?.herMessage;
    if (!herMessage) throw new Error('Нет последнего её сообщения.');
    const hint = learningHint(user, girl);
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

  async function generateReplies(userId, herMessage) {
    const user = getUser(userId);
    const { key, data: girl } = getGirl(user, user.activeGirl);
    const cleaned = cleanText(herMessage);
    if (!cleaned) throw new Error('Пустое сообщение.');

    const auto = await autoMarkRepliedIfNeeded(user, girl, cleaned);
    pushHistory(girl, 'her', cleaned);

    let chosenMode = 'base';
    if (user.settings.autopick) chosenMode = pickMode(user, girl);

    const suggestions = await generateSuggestions(user, girl, cleaned, chosenMode);
    user.last = {
      herMessage: cleaned,
      suggestionsText: suggestions,
      girlName: key,
      mode: chosenMode,
    };

    const weights = getEffectiveWeights(user, girl);
    const debugFooter = user.learning.debug
      ? `\n\n—\nDebug: pacing=${user.settings.pacing}, stage=${girl.stage}, mode=${chosenMode}, weights=${weightsSummary(weights)}`
      : '';

    saveStore();
    return {
      suggestions: suggestions + debugFooter,
      auto,
      chosenMode,
      stage: girl.stage,
    };
  }

  async function tweakReplies(userId, tweakType) {
    const user = getUser(userId);
    const res = await tweakLast(user, tweakType);
    if (!res) throw new Error('Нет последнего сообщения.');
    user.last.suggestionsText = res.out;
    user.last.mode = res.modeName;
    const { data: girl } = getGirl(user, user.last?.girlName || user.activeGirl);
    const weights = getEffectiveWeights(user, girl);
    const debugFooter = user.learning.debug
      ? `\n\n—\nDebug: pacing=${user.settings.pacing}, stage=${girl.stage}, mode=${res.modeName}, weights=${weightsSummary(weights)}`
      : '';
    saveStore();
    return { suggestions: res.out + debugFooter, stage: girl.stage, mode: res.modeName };
  }

  function commitReply(userId, payload) {
    const user = getUser(userId);
    if (!user.last?.suggestionsText && !payload?.text) {
      throw new Error('Нет последних вариантов.');
    }

    const girlName = user.last?.girlName || user.activeGirl;
    const { data: girl } = getGirl(user, girlName);

    let chosen = '';
    if (payload?.text) {
      chosen = cleanText(payload.text);
    } else {
      const { best, alts } = parseSuggestions(payload?.suggestions || user.last?.suggestionsText || '');
      if (payload?.which === 'alt1') chosen = alts[0] || '';
      if (payload?.which === 'alt2') chosen = alts[1] || '';
      if (payload?.which === 'alt3') chosen = alts[2] || '';
      if (!payload?.which || payload.which === 'best') chosen = best;
      chosen = cleanText(chosen);
    }

    if (!chosen) throw new Error('Не смог вытащить текст.');

    pushHistory(girl, 'me', chosen);

    const mode = user.last?.mode || 'base';
    const thread = ensureThread(girl, mode);
    thread.sentCount += 1;
    thread.lastSentAt = Date.now();

    user.stats.sent += 1;
    girl.stats.sent += 1;
    bumpLearningModeTry(user, mode);
    bumpModeStats(user, mode, null, 1);
    bumpModeStats(girl, mode, null, 1);

    saveStore();
    return { chosen, thread };
  }

  function recordOutcome(userId, outcome) {
    const user = getUser(userId);
    const girlName = user.last?.girlName || user.activeGirl;
    const { key, data: girl } = getGirl(user, girlName);

    if (!girl.thread || girl.thread.closed) throw new Error('Нет активного треда.');

    const mode = girl.thread.mode || user.last?.mode || 'base';

    if (outcome === 'replied' || outcome === 'strongReplied') {
      user.stats.replied += 1;
      girl.stats.replied += 1;
      if (outcome === 'strongReplied') {
        user.stats.strongReplied += 1;
        girl.stats.strongReplied += 1;
        advanceStageOnStrongReply(girl);
      }
    } else if (outcome === 'date' || outcome === 'datePlanned') {
      user.stats.dates += 1;
      girl.stats.dates += 1;
      if (outcome === 'datePlanned') {
        user.stats.datePlanned += 1;
        girl.stats.datePlanned += 1;
      }
      girl.stage = 'S4';
    } else {
      user.stats.ghosts += 1;
      girl.stats.ghosts += 1;
    }

    bumpModeStats(user, mode, outcome, 0);
    bumpModeStats(girl, mode, outcome, 0);
    bumpLearningModeOutcome(user, mode, outcome);
    updateLearning(user, girl, outcome, { stage: girl.stage, sentCount: girl.thread.sentCount });

    const closed = closeThread(user, girl, outcome);
    saveStore();

    return { key, girl, closed, mode };
  }

  function autoMarkRepliedIfNeeded(user, girl, herMessage) {
    const t = girl.thread;
    if (t && !t.closed && t.sentCount > 0) {
      if (t.lastSentAt && Date.now() - t.lastSentAt > 72 * 60 * 60 * 1000) {
        girl.consecutiveExchanges = 0;
      }
      const mode = t.mode || 'base';
      const strong = isStrongReply(herMessage);
      const outcome = strong ? 'strongReplied' : 'replied';

      user.stats.replied += 1;
      girl.stats.replied += 1;
      if (strong) {
        user.stats.strongReplied += 1;
        girl.stats.strongReplied += 1;
        advanceStageOnStrongReply(girl);
      }

      bumpModeStats(user, mode, outcome, 0);
      bumpModeStats(girl, mode, outcome, 0);
      bumpLearningModeOutcome(user, mode, outcome);

      updateLearning(user, girl, outcome, { stage: girl.stage, sentCount: t.sentCount });
      girl.consecutiveExchanges += 1;
      if (girl.consecutiveExchanges >= 3) {
        applyStreakBonus(user);
        girl.consecutiveExchanges = 0;
      }
      closeThread(user, girl, outcome);

      return { did: true, mode, strong };
    }
    return { did: false, mode: null, strong: false };
  }

  function getStatus(userId) {
    const user = getUser(userId);
    const { key, data: girl } = getGirl(user, user.activeGirl);
    return {
      activeGirl: key,
      stage: girl.stage,
      settings: user.settings,
      learning: {
        enabled: user.learning.enabled,
        debug: user.learning.debug,
        weights: user.learning.weights,
      },
    };
  }

  function setLearning(userId, enabled) {
    const user = getUser(userId);
    user.learning.enabled = Boolean(enabled);
    saveStore();
    return user.learning.enabled;
  }

  function setLearnDebug(userId, enabled) {
    const user = getUser(userId);
    user.learning.debug = Boolean(enabled);
    saveStore();
    return user.learning.debug;
  }

  function setAutopick(userId, enabled) {
    const user = getUser(userId);
    user.settings.autopick = Boolean(enabled);
    saveStore();
    return user.settings.autopick;
  }

  function setPacing(userId, pacing) {
    const user = getUser(userId);
    if (!['warm', 'fast'].includes(pacing)) throw new Error('Invalid pacing');
    user.settings.pacing = pacing;
    saveStore();
    return user.settings.pacing;
  }

  function setAutoghost(userId, hours) {
    const user = getUser(userId);
    if (!hours) {
      user.settings.autoghostHours = 0;
    } else {
      const n = Number(hours);
      if (!Number.isFinite(n) || n <= 0 || n > 720) throw new Error('Invalid hours');
      user.settings.autoghostHours = Math.round(n);
    }
    saveStore();
    return user.settings.autoghostHours;
  }

  function tuneWeight(userId, key, value) {
    const user = getUser(userId);
    if (!['warmth', 'brevity', 'humor', 'curiosity', 'flirt', 'inviteRate'].includes(key)) {
      throw new Error('Invalid key');
    }
    const v = Number(value);
    if (!Number.isFinite(v)) throw new Error('Invalid value');
    user.learning.weights[key] = clamp(v, 0, 1);
    saveStore();
    return user.learning.weights[key];
  }

  function resetLearning(userId) {
    const user = getUser(userId);
    user.learning.weights = {
      warmth: 0.7,
      brevity: 0.55,
      humor: 0.35,
      curiosity: 0.75,
      flirt: 0.25,
      inviteRate: 0.15,
    };
    user.learning.modeStats = {};
    ensureLearningModeStats(user);
    saveStore();
    return user.learning.weights;
  }

  function getProfile(userId) {
    const user = getUser(userId);
    ensureLearningModeStats(user);
    const modes = Object.entries(user.learning.modeStats);
    const scored = modes.map(([mode, s]) => {
      const tries = s.tries || 0;
      const score = tries ? (s.replied * 2 + s.strongReplied * 3 + s.datePlanned * 4 - s.ghost) / tries : 0;
      return { mode, score: score.toFixed(2) };
    });
    scored.sort((a, b) => Number(b.score) - Number(a.score));
    const topModes = scored.slice(0, 3);
    return { enabled: user.learning.enabled, weights: user.learning.weights, topModes };
  }

  function getStats(userId) {
    const user = getUser(userId);
    const { data: girl } = getGirl(user, user.activeGirl);
    return { stats: user.stats, hint: learningHint(user, girl), score: scoreText(user.conv) };
  }

  function getGstats(userId) {
    const user = getUser(userId);
    const { key, data: girl } = getGirl(user, user.activeGirl);
    return { girl: key, stats: girl.stats, score: scoreText(girl.conv) };
  }

  function getScore(userId) {
    const user = getUser(userId);
    return scoreText(user.conv);
  }

  function getGscore(userId) {
    const user = getUser(userId);
    const { key, data: girl } = getGirl(user, user.activeGirl);
    return { girl: key, score: scoreText(girl.conv) };
  }

  function getModes(userId) {
    const user = getUser(userId);
    return modeReport(user.modeStats);
  }

  function getGModes(userId) {
    const user = getUser(userId);
    const { key, data: girl } = getGirl(user, user.activeGirl);
    return { girl: key, report: modeReport(girl.modeStats) };
  }

  function exportData() {
    const file = getDataFile();
    return fs.readFileSync(file, 'utf8');
  }

  function backupData() {
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `data.backup-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
    const backupPath = path.resolve(`./${name}`);
    fs.copyFileSync(getDataFile(), backupPath);
    return { name, path: backupPath };
  }

  function readBackup(name) {
    const backupPath = path.resolve(`./${name}`);
    if (!fs.existsSync(backupPath)) throw new Error('Not found');
    return backupPath;
  }

  function autoghostSweep() {
    const userIds = Array.from(getStore().keys());
    for (const id of userIds) {
      const user = getUser(id);
      const hours = user.settings.autoghostHours || 0;
      if (!hours) continue;
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      for (const [, girl] of Object.entries(user.girls)) {
        const t = girl.thread;
        if (!t || t.closed) continue;
        if (!t.lastSentAt) continue;
        if (t.sentCount <= 0) continue;
        if (t.lastSentAt < cutoff) {
          const mode = t.mode || 'base';
          user.stats.ghosts += 1;
          girl.stats.ghosts += 1;
          bumpModeStats(user, mode, 'ghost', 0);
          bumpModeStats(girl, mode, 'ghost', 0);
          bumpLearningModeOutcome(user, mode, 'ghost');
          updateLearning(user, girl, 'ghost', { stage: girl.stage, sentCount: t.sentCount });
          closeThread(user, girl, 'ghost');
        }
      }
    }
    saveStore();
  }

  function getDebugFooter(user, girl, mode) {
    const weights = getEffectiveWeights(user, girl);
    return user.learning.debug
      ? `\n\n—\nDebug: pacing=${user.settings.pacing}, stage=${girl.stage}, mode=${mode}, weights=${weightsSummary(weights)}`
      : '';
  }

  return {
    askLLM,
    analyzeLastMessage,
    autoghostSweep,
    backupData,
    commitReply,
    generateReplies,
    getDebugFooter,
    getGscore,
    getGstats,
    getGModes,
    getModes,
    getProfile,
    getScore,
    getStats,
    getStatus,
    readBackup,
    recordOutcome,
    resetLearning,
    setAutoghost,
    setAutopick,
    setLearnDebug,
    setLearning,
    setPacing,
    tuneWeight,
    tweakReplies,
    exportData,
  };
}
