// progress shared by every village: which champions have fallen, the final boss's shared health, and the lasting
// boons they leave. Kept in the meta save; the game keeps a live copy here.
export interface Legacy { champs: string[]; finalHp: number; finalDown: boolean }
export const legacy: Legacy = { champs: [], finalHp: -1, finalDown: false };
export const setLegacy = (l?: Partial<Legacy>) => { legacy.champs = [...(l?.champs ?? [])]; legacy.finalHp = l?.finalHp ?? -1; legacy.finalDown = !!l?.finalDown; };

// each village's champion
export const CHAMPION: Record<string, string> = { maple: 'crimsonStag', iron: 'magmaColossus', mist: 'serpentQueen', frost: 'frostWyrm', sun: 'duneDjinn' };
export const FINAL = 'worldEater';
export const CHAMPION_BASE = 1000;
// the final boss stands far above even the last champion
export const FINAL_MUL = CHAMPION_BASE * 64;

// the boons: each champion leaves one small lasting gift to every village, the final boss a larger one to all
export const boon = (k: 'gather' | 'forge' | 'exp' | 'hp' | 'gold' | 'atk') => {
  const has = (v: string) => legacy.champs.includes(v), fin = legacy.finalDown ? 0.1 : 0;
  switch (k) {
    case 'gather': return 1 + (has('maple') ? 0.08 : 0) + fin;
    case 'forge': return 1 - (has('iron') ? 0.1 : 0) - fin;
    case 'exp': return 1 + (has('mist') ? 0.06 : 0) + fin;
    case 'hp': return 1 + (has('frost') ? 0.08 : 0) + fin;
    case 'gold': return 1 + (has('sun') ? 0.06 : 0) + fin;
    case 'atk': return 1 + fin;
  }
};
