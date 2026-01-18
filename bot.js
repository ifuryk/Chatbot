import 'dotenv/config';
import path from 'path';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { createCommands } from './core/commands.js';
import { loadStore } from './core/dataStore.js';
import {
  getGirl,
  getUser,
  learningHint,
  scoreText,
  stageLabel,
} from './core/state.js';
import {
  getActiveGirl,
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

async function runCommand(ctx, commandText) {
  try {
    const res = await commands.executeCommand(ctx.from.id, commandText);
    if (commandText.startsWith('/export') && res.data?.filePath) {
      return ctx.replyWithDocument({ source: res.data.filePath, filename: 'data.json' }, { caption: 'Твой data.json (экспорт)' });
    }
    if (commandText.startsWith('/backup') && res.data?.path) {
      return ctx.replyWithDocument({ source: res.data.path, filename: res.data.name }, { caption: 'Бэкап создан' });
    }
    return ctx.reply(res.message || JSON.stringify(res.data || {}, null, 2));
  } catch (e) {
    return ctx.reply(`Ошибка: ${e?.message ?? 'unknown'}`);
  }
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
  await runCommand(ctx, ctx.message.text);
});

bot.command('girls', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('ctx', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('reset', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// notes
bot.command('note', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('notes', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// toggles
bot.command('autopick', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('autoghost', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('pacing', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('learn', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('learn_debug', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('profile', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('tune', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('reset_learn', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// ice / reengage / analyze / flags / dateplan
bot.command('ice', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('reengage', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('analyze', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('flags', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('dateplan', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// export / backup
bot.command('export', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('backup', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// stats/modes/score
bot.command('stats', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('gstats', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('score', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('gscore', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('modes', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

bot.command('gmodes', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
});

// manual /sent
bot.command('sent', async (ctx) => {
  await runCommand(ctx, ctx.message.text);
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

app.get('/admin.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'admin.html'));
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

app.post('/api/command', async (req, res) => {
  try {
    const result = await commands.executeCommand(req.headers['x-user-id'] || 'web', req.body?.command || '');
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Command failed' });
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
