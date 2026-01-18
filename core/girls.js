import { addNote, ensureUserSchema, getGirl, getUser } from './state.js';
import { saveStore } from './dataStore.js';

export function listGirls(userId) {
  const user = getUser(userId);
  return Object.keys(user.girls || {});
}

export function setActiveGirl(userId, name) {
  const user = getUser(userId);
  const { key, data } = getGirl(user, name);
  saveStore();
  return { key, girl: data };
}

export function getActiveGirl(userId) {
  const user = getUser(userId);
  const { key, data } = getGirl(user, user.activeGirl);
  return { key, girl: data };
}

export function resetGirl(userId) {
  const user = getUser(userId);
  const { key, data } = getGirl(user, user.activeGirl);
  data.history = [];
  data.thread = null;
  user.last = null;
  saveStore();
  return { key, girl: data };
}

export function getContext(userId) {
  const { girl } = getActiveGirl(userId);
  return girl.ctx;
}

export function setContext(userId, text) {
  const user = getUser(userId);
  const { data } = getGirl(user, user.activeGirl);
  data.ctx = text;
  saveStore();
  return data.ctx;
}

export function resetContext(userId) {
  const user = getUser(userId);
  const { data } = getGirl(user, user.activeGirl);
  data.ctx = 'нет';
  data.history = [];
  data.thread = null;
  user.last = null;
  saveStore();
  return data.ctx;
}

export function addGirlNote(userId, text) {
  const user = getUser(userId);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  addNote(girl, text);
  saveStore();
  return { key, girl };
}

export function listGirlNotes(userId) {
  const user = getUser(userId);
  const { key, data: girl } = getGirl(user, user.activeGirl);
  return { key, notes: girl.notes || [] };
}

export function ensureSchema(userId) {
  const user = getUser(userId);
  ensureUserSchema(user);
  saveStore();
}
