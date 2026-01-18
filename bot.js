import 'dotenv/config';
import path from 'path';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { createCommands } from './core/commands.js';
import { getDataFile, loadStore } from './core/dataStore.js';
import {
  getGirl,
  getUser,
  learningHint,
  scoreText,
  stageLabel,
} from './core/state.js';
import {
  addGirlNote,
  getActiveGirl,
  getContext,
  listGirlNotes,
  listGirls,
  resetContext,
  resetGirl,
  setActiveGirl,
  setContext,
} from './core/girls.js';

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
const commands = createCommands({ client });

const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID ? String(process.env.ADMIN_TELEGRAM_ID) : null;
const WEB_TOKEN = process.env.WEB_TOKEN || '';
const WEB_PORT = process.env.WEB_PORT ? Number(process.env.WEB_PORT) : 3000;

loadStore();

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
// Keyboards
// --------------------
function combinedKeyboard(options = {}) {
  const stage = options.stage || 'S1';
  const showDatePlanned = stage === 'S4' || options.showDatePlanned;
  const rows = [
    [Markup.button.callback('🔹 Короче', 'tweak_short'), Markup.button.callback('😄 Смешнее', 'tweak_funny')],
    [Markup.button.callback('🔥 Смелее', 'tweak_bolder'), Markup.button.callback('📍 Пригласи', 'tweak_invite')],
    [Markup.button.callback('🧠 Почему', 'tweak_why')],
    [Markup.button.callback('✅ Отправил: Лучший', 'sent_best')],
    [Markup.button.callback('✅ Alt1', 'sent_alt1'), Markup.button.callback('✅ Alt2', 'sent_alt2'), Markup.button.callback('✅ Alt3', 'sent_alt3')],
    [Markup.button.callback('💬 Она ответила', 'out_replied'), Markup.button.callback('💬 Ответила (с интересом)', 'out_strong_replied')],
    [Markup.button.callback('📅 Встреча', 'out_date')],
    [Markup.button.callback('👻 Пропала/не зашло', 'out_ghost')],
  ];
  if (showDatePlanned) {
    rows.splice(7, 0, [Markup.button.callback('🔥 Дошли до встречи', 'out_date_planned')]);
  }
  return Markup.inlineKeyboard(rows);
}

// --------------------
// Commands: core
// --------------------
bot.start(async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  const hint = learningHint(user, girl);

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
      `/learn on|off | /learn_debug on|off\n` +
      `/profile | /tune <key> <value> | /reset_learn\n` +
      `/sent <текст>\n` +
      `/export | /backup\n\n` +
      `Пришли её сообщение — дам варианты + кнопки.`
  );
});

bot.command('girl', async (ctx) => {
  const name = ctx.message.text.replace('/girl', '').trim();
  if (!name) return ctx.reply('Пример: /girl anya');
  const { key, girl } = setActiveGirl(ctx.from.id, name);
  await ctx.reply(
    `Ок. Активная: ${key}\nКонтекст: ${girl.ctx}\nNotes: ${(girl.notes || []).length}\nСтадия: ${girl.stage} (${stageLabel(girl.stage)})\nSuccess: ${scoreText(girl.conv)}`
  );
});

bot.command('girls', async (ctx) => {
  const names = listGirls(ctx.from.id);
  const { key } = getActiveGirl(ctx.from.id);
  await ctx.reply(`Девушки: ${names.join(', ')}\nАктивная: ${key}`);
});

bot.command('ctx', async (ctx) => {
  const text = ctx.message.text.replace('/ctx', '').trim();
  if (!text) return ctx.reply('Пример: /ctx познакомились в инсте, любит кофе');
  setContext(ctx.from.id, text);
  await ctx.reply('Контекст сохранён.');
});

bot.command('reset', async (ctx) => {
  const { key } = resetGirl(ctx.from.id);
  await ctx.reply(`Ок. История и тред очищены для "${key}"`);
});

// notes
bot.command('note', async (ctx) => {
  const text = ctx.message.text.replace('/note', '').trim();
  if (!text) return ctx.reply('Пример: /note любит кофе, не любит пассивную агрессию');
  const { key, girl } = addGirlNote(ctx.from.id, text);
  await ctx.reply(`Сохранил заметку для "${key}". Всего notes: ${girl.notes.length}`);
});

bot.command('notes', async (ctx) => {
  const { key, notes } = listGirlNotes(ctx.from.id);
  const last = (notes || []).slice(-12);
  if (!last.length) return ctx.reply(`У "${key}" пока нет заметок. Добавь: /note ...`);
  await ctx.reply(`Заметки "${key}" (последние):\n` + last.map((n, i) => `• ${i + 1}) ${n.text}`).join('\n'));
});

// toggles
bot.command('autopick', async (ctx) => {
  const arg = ctx.message.text.replace('/autopick', '').trim().toLowerCase();
  if (!arg) {
    const status = commands.getStatus(ctx.from.id).settings.autopick;
    return ctx.reply(`Сейчас autopick: ${status ? 'ON' : 'OFF'}\nПример: /autopick on`);
  }
  const next = arg === 'on' || arg === 'true' || arg === '1';
  commands.setAutopick(ctx.from.id, next);
  await ctx.reply(`A/B autopick: ${next ? 'ON' : 'OFF'}`);
});

bot.command('autoghost', async (ctx) => {
  const arg = ctx.message.text.replace('/autoghost', '').trim().toLowerCase();
  if (!arg) {
    const hours = commands.getStatus(ctx.from.id).settings.autoghostHours;
    return ctx.reply(`Сейчас autoghost: ${hours}h\nПример: /autoghost 48 или /autoghost off`);
  }
  if (arg === 'off') {
    commands.setAutoghost(ctx.from.id, 0);
    return ctx.reply('Autoghost выключен.');
  }
  try {
    const hours = commands.setAutoghost(ctx.from.id, arg);
    await ctx.reply(`Autoghost: ${hours}h`);
  } catch {
    await ctx.reply('Введи часы (1..720) или off.');
  }
});

bot.command('pacing', async (ctx) => {
  const arg = ctx.message.text.replace('/pacing', '').trim().toLowerCase();
  if (!arg) {
    const pacing = commands.getStatus(ctx.from.id).settings.pacing;
    return ctx.reply(`Сейчас pacing: ${pacing}\nПример: /pacing warm`);
  }
  try {
    const pacing = commands.setPacing(ctx.from.id, arg);
    await ctx.reply(`Pacing: ${pacing}`);
  } catch {
    await ctx.reply('Варианты: /pacing warm или /pacing fast');
  }
});

bot.command('learn', async (ctx) => {
  const arg = ctx.message.text.replace('/learn', '').trim().toLowerCase();
  if (!arg) {
    const enabled = commands.getStatus(ctx.from.id).learning.enabled;
    return ctx.reply(`Сейчас learning: ${enabled ? 'ON' : 'OFF'}\nПример: /learn on`);
  }
  if (arg !== 'on' && arg !== 'off') return ctx.reply('Варианты: /learn on или /learn off');
  const enabled = commands.setLearning(ctx.from.id, arg === 'on');
  await ctx.reply(`Learning: ${enabled ? 'ON' : 'OFF'}`);
});

bot.command('learn_debug', async (ctx) => {
  const arg = ctx.message.text.replace('/learn_debug', '').trim().toLowerCase();
  if (!arg) {
    const enabled = commands.getStatus(ctx.from.id).learning.debug;
    return ctx.reply(`Сейчас learn_debug: ${enabled ? 'ON' : 'OFF'}\nПример: /learn_debug on`);
  }
  if (arg !== 'on' && arg !== 'off') return ctx.reply('Варианты: /learn_debug on или /learn_debug off');
  const enabled = commands.setLearnDebug(ctx.from.id, arg === 'on');
  await ctx.reply(`Learn debug: ${enabled ? 'ON' : 'OFF'}`);
});

bot.command('profile', async (ctx) => {
  const profile = commands.getProfile(ctx.from.id);
  const topModes = profile.topModes.length ? profile.topModes.map((m) => `${m.mode}:${m.score}`).join(', ') : 'нет данных';
  await ctx.reply(
    `Learning: ${profile.enabled ? 'ON' : 'OFF'}\n` +
      `Top modes: ${topModes}\n` +
      `Weights: W:${profile.weights.warmth.toFixed(2)} B:${profile.weights.brevity.toFixed(2)} H:${profile.weights.humor.toFixed(2)} ` +
      `C:${profile.weights.curiosity.toFixed(2)} F:${profile.weights.flirt.toFixed(2)} I:${profile.weights.inviteRate.toFixed(2)}`
  );
});

bot.command('tune', async (ctx) => {
  const args = ctx.message.text.replace('/tune', '').trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) return ctx.reply('Пример: /tune warmth 0.8');
  const [key, rawValue] = args;
  try {
    const value = commands.tuneWeight(ctx.from.id, key, rawValue);
    await ctx.reply(`OK. ${key}=${value.toFixed(2)}`);
  } catch {
    await ctx.reply('Ключи: warmth, brevity, humor, curiosity, flirt, inviteRate');
  }
});

bot.command('reset_learn', async (ctx) => {
  commands.resetLearning(ctx.from.id);
  await ctx.reply('Learning сброшен к дефолту.');
});

// ice / reengage / analyze / flags / dateplan
bot.command('ice', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  await ctx.reply(`Думаю… (ice для "${key}")`);
  try {
    const out = await commands.askLLM(
      `Сгенерируй 5 коротких сообщений, чтобы начать/перезапустить диалог.\n2 варианта с лёгким юмором, 2 спокойных, 1 мягко к встрече. 1–2 строки.\n\nПОРТРЕТ:\n${JSON.stringify(user.profile)}\nКонтекст:\n${girl.ctx}\nЗаметки:\n${girl.notes || []}`
    );
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
    const out = await commands.askLLM(
      `Пауза ~${hours} часов. Сгенерируй 4 коротких сообщения:\n1) лёгкое уверенное\n2) с юмором\n3) тёплое\n4) с мягким переводом к встрече/созвону\nБез обид и пассивной агрессии. 1–2 строки каждое.\n\nПОРТРЕТ:\n${JSON.stringify(user.profile)}\nКонтекст:\n${girl.ctx}\nЗаметки:\n${girl.notes || []}`
    );
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('analyze', async (ctx) => {
  try {
    const out = await commands.analyzeLastMessage(ctx.from.id);
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('flags', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { data: girl } = getGirl(user, user.activeGirl);
  try {
    const out = await commands.askLLM(
      `По переписке выдели:\n- Зеленые сигналы (интерес)\n- Желтые (неясность)\n- Красные (риски/токсичность/слив)\nДай короткие советы: что делать дальше.\n\nКонтекст:\n${girl.ctx}\nИстория:\n${girl.history?.length ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n') : 'нет'}`
    );
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('dateplan', async (ctx) => {
  const user = getUser(ctx.from.id);
  const { data: girl } = getGirl(user, user.activeGirl);
  try {
    const out = await commands.askLLM(
      `Сделай план приглашения и встречи:\n1) 3 сообщения-приглашения (разные стили: спокойное/с юмором/уверенное)\n2) 3 варианта формата встречи (простые и реалистичные)\n3) Сообщение в день встречи (подтверждение)\n4) Если она “не может” — 2 варианта переноса без давления\n5) После встречи — 2 сообщения\n\nКонтекст:\n${girl.ctx}\nИстория:\n${girl.history?.length ? girl.history.map((h) => (h.role === 'her' ? `Она: ${h.text}` : `Я: ${h.text}`)).join('\n') : 'нет'}`
    );
    await ctx.reply(out || 'Не получилось. Попробуй ещё раз.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// export / backup
bot.command('export', async (ctx) => {
  try {
    await ctx.replyWithDocument({ source: path.resolve(getDataFile()), filename: 'data.json' }, { caption: 'Твой data.json (экспорт)' });
  } catch (e) {
    await ctx.reply(`Ошибка экспорта: ${e?.message ?? 'unknown'}`);
  }
});

bot.command('backup', async (ctx) => {
  try {
    const backup = commands.backupData();
    await ctx.replyWithDocument({ source: backup.path, filename: backup.name }, { caption: 'Бэкап создан' });
  } catch (e) {
    await ctx.reply(`Ошибка бэкапа: ${e?.message ?? 'unknown'}`);
  }
});

// stats/modes/score
bot.command('stats', async (ctx) => {
  const { stats, hint, score } = commands.getStats(ctx.from.id);
  await ctx.reply(
    `Стата (общая):\n` +
      `sent=${stats.sent}\nreplied=${stats.replied} (${Math.round((stats.replied / (stats.sent || 1)) * 100)}%)\n` +
      `strongReplied=${stats.strongReplied}\n` +
      `dates=${stats.dates} (${Math.round((stats.dates / (stats.sent || 1)) * 100)}%)\n` +
      `datePlanned=${stats.datePlanned}\n` +
      `ghost=${stats.ghosts}\n\n` +
      `Success Score: ${score}\n` +
      `Адаптация: ${hint.summary}\nИнструкция: ${hint.instruction}\n` +
      `A/B autopick: ${commands.getStatus(ctx.from.id).settings.autopick ? 'ON' : 'OFF'} | Pacing: ${commands.getStatus(ctx.from.id).settings.pacing} | Autoghost: ${commands.getStatus(ctx.from.id).settings.autoghostHours}h`
  );
});

bot.command('gstats', async (ctx) => {
  const { girl, stats, score } = commands.getGstats(ctx.from.id);
  await ctx.reply(
    `Стата по "${girl}":\n` +
      `sent=${stats.sent}\nreplied=${stats.replied} (${Math.round((stats.replied / (stats.sent || 1)) * 100)}%)\n` +
      `strongReplied=${stats.strongReplied}\n` +
      `dates=${stats.dates} (${Math.round((stats.dates / (stats.sent || 1)) * 100)}%)\n` +
      `datePlanned=${stats.datePlanned}\n` +
      `ghost=${stats.ghosts}\n\n` +
      `Success Score: ${score}`
  );
});

bot.command('score', async (ctx) => {
  await ctx.reply(`Success Score (общий): ${commands.getScore(ctx.from.id)}`);
});

bot.command('gscore', async (ctx) => {
  const { girl, score } = commands.getGscore(ctx.from.id);
  await ctx.reply(`Success Score по "${girl}": ${score}`);
});

bot.command('modes', async (ctx) => {
  const rep = commands.getModes(ctx.from.id);
  await ctx.reply(`Стратегии (общие):\n${rep.lines}\n\nТоп сейчас: ${rep.bestMode}`);
});

bot.command('gmodes', async (ctx) => {
  const { girl, report } = commands.getGModes(ctx.from.id);
  await ctx.reply(`Стратегии по "${girl}":\n${report.lines}\n\nТоп сейчас: ${report.bestMode}`);
});

// manual /sent
bot.command('sent', async (ctx) => {
  const text = ctx.message.text.replace('/sent', '').trim();
  if (!text) return ctx.reply('Пример: /sent я тоже люблю кофе, давай проверим твоё место 🙂');
  try {
    commands.commitReply(ctx.from.id, { text });
    await ctx.reply('Ок. Сохранил твоё сообщение как "Я:" + увеличил sent и открыл/обновил тред.');
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// --------------------
// Main: incoming her message -> generate suggestions
// --------------------
bot.on('text', async (ctx) => {
  const herMessage = (ctx.message.text || '').trim();
  if (herMessage.length < 2) return;
  if (herMessage.startsWith('/')) return;

  const { key, girl } = getActiveGirl(ctx.from.id);
  await ctx.reply(`Думаю… (девушка: ${key})`);

  try {
    const res = await commands.generateReplies(ctx.from.id, herMessage);
    await ctx.reply(res.suggestions, combinedKeyboard({ stage: res.stage }));
  } catch (e) {
    await ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
});

// --------------------
// Buttons: tweaks
// --------------------
async function handleTweak(ctx, tweakType) {
  await ctx.answerCbQuery();
  try {
    const res = await commands.tweakReplies(ctx.from.id, tweakType);
    return ctx.reply(res.suggestions, combinedKeyboard({ stage: res.stage }));
  } catch {
    return ctx.reply('Нет последнего сообщения. Пришли сначала её текст.');
  }
}

bot.action('tweak_short', (ctx) => handleTweak(ctx, 'short'));
bot.action('tweak_funny', (ctx) => handleTweak(ctx, 'funny'));
bot.action('tweak_bolder', (ctx) => handleTweak(ctx, 'bolder'));
bot.action('tweak_invite', (ctx) => handleTweak(ctx, 'invite'));
bot.action('tweak_why', async (ctx) => {
  await ctx.answerCbQuery();
  const res = await commands.tweakReplies(ctx.from.id, 'why');
  return ctx.reply(res.suggestions);
});

// --------------------
// Buttons: sent_* (auto-save my message + open thread)
// --------------------
async function handleSent(ctx, which) {
  await ctx.answerCbQuery();
  const user = getUser(ctx.from.id);
  if (!user.last?.suggestionsText) {
    return ctx.reply('Нет последних вариантов. Сначала пришли её сообщение.');
  }
  try {
    const res = commands.commitReply(ctx.from.id, { which });
    return ctx.reply(`Сохранил "Я отправил":\n${res.chosen}\n\nТред: ${res.thread.id} (mode=${res.thread.mode})`);
  } catch {
    return ctx.reply('Не смог вытащить текст. Используй /sent <текст который ты реально отправил>');
  }
}

bot.action('sent_best', (ctx) => handleSent(ctx, 'best'));
bot.action('sent_alt1', (ctx) => handleSent(ctx, 'alt1'));
bot.action('sent_alt2', (ctx) => handleSent(ctx, 'alt2'));
bot.action('sent_alt3', (ctx) => handleSent(ctx, 'alt3'));

// --------------------
// Buttons: outcomes (manual close thread)
// --------------------
async function handleOutcome(ctx, outcome) {
  await ctx.answerCbQuery();
  try {
    const res = commands.recordOutcome(ctx.from.id, outcome);
    const hint = learningHint(getUser(ctx.from.id), res.girl);
    const msg =
      outcome === 'replied'
        ? 'Отметил: она ответила ✅'
        : outcome === 'strongReplied'
        ? 'Отметил: ответила с интересом 💬'
        : outcome === 'datePlanned'
        ? 'Отметил: дошли до встречи 🔥'
        : outcome === 'date'
        ? 'Отметил: встреча/созвон 📅'
        : 'Отметил: пропала/не зашло 👻';
    return ctx.reply(
      `${msg}\n` +
        `Тред закрыт: ${res.closed.id} (mode=${res.mode}, sent=${res.closed.sentCount})\n\n` +
        `Success (общий): ${scoreText(getUser(ctx.from.id).conv)}\n` +
        `Success ("${res.key}"): ${scoreText(res.girl.conv)}\n\n` +
        `Адаптация: ${hint.summary}\nИнструкция: ${hint.instruction}`
    );
  } catch {
    return ctx.reply('Нет активного треда. Сначала нажми ✅ Отправил (или /sent ...), потом исход.');
  }
}

bot.action('out_replied', (ctx) => handleOutcome(ctx, 'replied'));
bot.action('out_strong_replied', (ctx) => handleOutcome(ctx, 'strongReplied'));
bot.action('out_date_planned', (ctx) => handleOutcome(ctx, 'datePlanned'));
bot.action('out_date', (ctx) => handleOutcome(ctx, 'date'));
bot.action('out_ghost', (ctx) => handleOutcome(ctx, 'ghost'));

// --------------------
// Autoghost timer
// --------------------
setInterval(commands.autoghostSweep, 60_000);

// --------------------
// Web server
// --------------------
const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/web', express.static(path.join(__dirname, 'web')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', (req, res, next) => {
  if (!WEB_TOKEN || req.headers['x-web-token'] !== WEB_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
});

app.get('/api/status', (req, res) => {
  res.json(commands.getStatus(req.headers['x-user-id'] || 'web'));
});

app.post('/api/learn', (req, res) => {
  const enabled = commands.setLearning(req.headers['x-user-id'] || 'web', Boolean(req.body?.enabled));
  res.json({ enabled });
});

app.post('/api/learn_debug', (req, res) => {
  const enabled = commands.setLearnDebug(req.headers['x-user-id'] || 'web', Boolean(req.body?.enabled));
  res.json({ enabled });
});

app.post('/api/autopick', (req, res) => {
  const enabled = commands.setAutopick(req.headers['x-user-id'] || 'web', Boolean(req.body?.enabled));
  res.json({ enabled });
});

app.post('/api/pacing', (req, res) => {
  try {
    const pacing = commands.setPacing(req.headers['x-user-id'] || 'web', req.body?.pacing);
    res.json({ pacing });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Invalid pacing' });
  }
});

app.post('/api/autoghost', (req, res) => {
  try {
    const hours = commands.setAutoghost(req.headers['x-user-id'] || 'web', req.body?.hours);
    res.json({ hours });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Invalid hours' });
  }
});

app.post('/api/tune', (req, res) => {
  try {
    const value = commands.tuneWeight(req.headers['x-user-id'] || 'web', req.body?.key, req.body?.value);
    res.json({ key: req.body?.key, value });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Invalid tune' });
  }
});

app.post('/api/reset', (req, res) => {
  const { key } = resetGirl(req.headers['x-user-id'] || 'web');
  res.json({ activeGirl: key });
});

app.post('/api/reset_learn', (req, res) => {
  const weights = commands.resetLearning(req.headers['x-user-id'] || 'web');
  res.json({ weights });
});

app.get('/api/girls', (req, res) => {
  const userId = req.headers['x-user-id'] || 'web';
  res.json({ active: getActiveGirl(userId).key, girls: listGirls(userId) });
});

app.post('/api/girls/active', (req, res) => {
  const { key, girl } = setActiveGirl(req.headers['x-user-id'] || 'web', req.body?.name || '');
  res.json({ active: key, stage: girl.stage, context: girl.ctx });
});

app.get('/api/context', (req, res) => {
  const ctxText = getContext(req.headers['x-user-id'] || 'web');
  res.json({ context: ctxText });
});

app.post('/api/context', (req, res) => {
  try {
    const ctxText = setContext(req.headers['x-user-id'] || 'web', req.body?.text || '');
    res.json({ context: ctxText });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to set context' });
  }
});

app.post('/api/context/reset', (req, res) => {
  const ctxText = resetContext(req.headers['x-user-id'] || 'web');
  res.json({ context: ctxText });
});

app.post('/api/message/send', (req, res) => {
  try {
    const result = commands.commitReply(req.headers['x-user-id'] || 'web', { text: req.body?.text });
    res.json({ chosen: result.chosen, thread: result.thread });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to send' });
  }
});

app.post('/api/message/analyzeLast', async (req, res) => {
  try {
    const out = await commands.analyzeLastMessage(req.headers['x-user-id'] || 'web');
    res.json({ analysis: out });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to analyze' });
  }
});

app.post('/api/message/generateReplies', async (req, res) => {
  try {
    const result = await commands.generateReplies(req.headers['x-user-id'] || 'web', req.body?.text || '');
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to generate' });
  }
});

app.post('/api/message/commitReply', (req, res) => {
  try {
    const result = commands.commitReply(req.headers['x-user-id'] || 'web', {
      which: req.body?.which,
      text: req.body?.text,
      suggestions: req.body?.suggestions,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to commit' });
  }
});

app.get('/api/stats', (req, res) => {
  res.json(commands.getStats(req.headers['x-user-id'] || 'web'));
});

app.get('/api/gstats', (req, res) => {
  res.json(commands.getGstats(req.headers['x-user-id'] || 'web'));
});

app.get('/api/score', (req, res) => {
  res.json({ score: commands.getScore(req.headers['x-user-id'] || 'web') });
});

app.get('/api/gscore', (req, res) => {
  res.json(commands.getGscore(req.headers['x-user-id'] || 'web'));
});

app.get('/api/modes', (req, res) => {
  res.json(commands.getModes(req.headers['x-user-id'] || 'web'));
});

app.get('/api/gmodes', (req, res) => {
  res.json(commands.getGModes(req.headers['x-user-id'] || 'web'));
});

app.get('/api/export', (req, res) => {
  res.type('application/json').send(commands.exportData());
});

app.post('/api/backup', (req, res) => {
  const backup = commands.backupData();
  res.json({ name: backup.name });
});

app.get('/api/backup/:name', (req, res) => {
  try {
    const filePath = commands.readBackup(req.params.name);
    res.download(filePath, req.params.name);
  } catch (e) {
    res.status(404).json({ error: e?.message || 'Not found' });
  }
});

app.post('/api/message/outcome', (req, res) => {
  try {
    const result = commands.recordOutcome(req.headers['x-user-id'] || 'web', req.body?.outcome);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Failed to record outcome' });
  }
});

app.listen(WEB_PORT, () => {
  console.log(`Web admin listening on ${WEB_PORT}`);
});

// --------------------
// Launch
// --------------------
bot.launch();
console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
