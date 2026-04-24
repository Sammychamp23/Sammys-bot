const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function load(file) {
  const filePath = path.join(dataDir, file);
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function save(file, data) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2));
}

function key(guildId, userId) {
  return `${guildId}-${userId}`;
}

// ── Levels ────────────────────────────────────────────────────────────────────
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function getLevelData(guildId, userId) {
  const data = load('levels.json');
  const k = key(guildId, userId);
  if (!data[k]) data[k] = { xp: 0, level: 0 };
  return { data, k, entry: data[k] };
}

function addXp(guildId, userId, amount) {
  const { data, k, entry } = getLevelData(guildId, userId);
  entry.xp += amount;
  let leveledUp = false;
  while (entry.xp >= xpForLevel(entry.level + 1)) {
    entry.xp -= xpForLevel(entry.level + 1);
    entry.level += 1;
    leveledUp = true;
  }
  save('levels.json', data);
  return { level: entry.level, xp: entry.xp, leveledUp };
}

function getLevel(guildId, userId) {
  const { entry } = getLevelData(guildId, userId);
  return entry;
}

function getLeaderboard(guildId) {
  const data = load('levels.json');
  const prefix = `${guildId}-`;
  return Object.entries(data)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ userId: k.slice(prefix.length), ...v }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 10);
}

// ── Economy ───────────────────────────────────────────────────────────────────
function getEconData(guildId, userId) {
  const data = load('economy.json');
  const k = key(guildId, userId);
  if (!data[k]) data[k] = { coins: 0, lastDaily: null };
  return { data, k, entry: data[k] };
}

function getCoins(guildId, userId) {
  return getEconData(guildId, userId).entry;
}

function addCoins(guildId, userId, amount) {
  const { data, k, entry } = getEconData(guildId, userId);
  entry.coins = Math.max(0, entry.coins + amount);
  save('economy.json', data);
  return entry.coins;
}

function claimDaily(guildId, userId) {
  const { data, k, entry } = getEconData(guildId, userId);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  if (entry.lastDaily && now - entry.lastDaily < cooldown) {
    const remaining = cooldown - (now - entry.lastDaily);
    return { success: false, remaining };
  }
  const reward = 150 + Math.floor(Math.random() * 100);
  entry.coins += reward;
  entry.lastDaily = now;
  save('economy.json', data);
  return { success: true, reward, total: entry.coins };
}

module.exports = { addXp, getLevel, getLeaderboard, xpForLevel, getCoins, addCoins, claimDaily };
