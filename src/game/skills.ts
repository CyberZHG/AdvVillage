import type { Cls, Npc } from './types';

// skills grow by themselves through use; each fighter has four shared ones and one of their class
export const SKILL_MAX = 50;
export const COMMON_SKILLS = ['blade', 'guard', 'vigor', 'instinct'] as const;
export const CLASS_SKILL: Record<Cls, string> = {
  warrior: 'cleave', knight: 'block', archer: 'volley', rogue: 'crit', mage: 'blast', cleric: 'mend', lancer: 'charge', monk: 'evade',
};

// [base, per level, cap] for skills that trigger by chance; mend and charge scale their strength instead
export const PROC: Record<string, [number, number, number]> = {
  cleave: [0.05, 0.005, 0.3], block: [0.05, 0.006, 0.35], volley: [0.04, 0.004, 0.25], crit: [0.06, 0.006, 0.36],
  blast: [0.05, 0.004, 0.25], evade: [0.04, 0.005, 0.3],
};
// per level: blade +atk, guard +def, vigor +hp, instinct +exp
export const COMMON_PER: Record<string, number> = { blade: 0.006, guard: 0.006, vigor: 0.008, instinct: 0.004 };

export const skillsOf = (n: Npc) => [...COMMON_SKILLS, CLASS_SKILL[n.cls]];
export const slv = (n: Npc, k: string) => Math.floor(n.sk?.[k] ?? 0);
export const procChance = (n: Npc, k: string) => {
  const p = PROC[k];
  return Math.min(p[2], p[0] + p[1] * slv(n, k));
};
export const skillMult = (n: Npc, k: string) => 1 + COMMON_PER[k] * slv(n, k);
export const mendPower = (n: Npc) => 0.08 + 0.002 * slv(n, 'mend');
export const chargeMult = (n: Npc) => 1.5 + 0.02 * slv(n, 'charge');

// uses needed for the next level rise slowly; 'rate' lets rarer events (kills, knockdowns) count for more
const need = (L: number) => 4 + 2 * L;

// returns the new level when it crosses a multiple of ten, for the biography
export function train(n: Npc, k: string, rate = 1): number | null {
  const sk = (n.sk ??= {});
  const before = Math.floor(sk[k] ?? 0);
  if (before >= SKILL_MAX) return null;
  sk[k] = Math.min(SKILL_MAX, (sk[k] ?? 0) + rate / need(before));
  const after = Math.floor(sk[k]);
  return after > before && after % 10 === 0 ? after : null;
}
