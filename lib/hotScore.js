// lib/hotScore.js
// Reddit-like hot score: votes vs age (seconds)
export function hotScore(votes, createdAt) {
  const s = Math.max(-1, Math.min(1, votes)); // direction (never negative here but safe)
  const order = Math.log10(Math.max(Math.abs(votes), 1));
  const seconds = (new Date(createdAt).getTime() / 1000) - 1134028003; // epoch
  return Number((order + seconds / 45000).toFixed(6));
}
