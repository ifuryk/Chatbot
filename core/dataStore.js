import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('./data.json');
let store = new Map();
let loaded = false;

export function getDataFile() {
  return DATA_FILE;
}

export function getStore() {
  return store;
}

export function loadStore() {
  if (loaded) return store;
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
  loaded = true;
  return store;
}

export function saveStore() {
  try {
    const obj = Object.fromEntries(store);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Failed to save data.json:', e?.message || e);
  }
}

export function setStore(nextStore) {
  store = nextStore;
}
