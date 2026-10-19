import { CIVILIAN_JOBS, GATHER_JOBS, TOURIST_KINDS, type ClassKey } from './data';
import { pick, randi, weighted } from './util';
import { culture } from './culture';
import type { Look, Role } from './types';

export const LOOK_COUNTS = { skin: 5, hair: 10, style: 8, cloth: 14, pants: 6 };
export const GRAY_HAIR = 7;
const BALD = 4;

interface Recipe { outfit: string[]; head: string[]; item: string[] }

const FIGHTER: Record<ClassKey, Recipe> = {
  warrior: { outfit: ['tunic'], head: ['helmet', '', 'headband'], item: ['sword'] },
  knight: { outfit: ['armor'], head: ['knightHelm', 'helmet'], item: ['swordShield'] },
  archer: { outfit: ['leather'], head: ['hood', '', 'cap'], item: ['bow'] },
  rogue: { outfit: ['leather'], head: ['bandana', 'hood', ''], item: ['dagger'] },
  mage: { outfit: ['robe'], head: ['wizardHat', 'wizardHat', ''], item: ['staff'] },
  cleric: { outfit: ['robe'], head: ['mitre', '', 'hood'], item: ['mace'] },
  lancer: { outfit: ['tunic', 'leather'], head: ['helmet', ''], item: ['spear'] },
  monk: { outfit: ['gi'], head: ['headband', ''], item: [''] },
};
const JOBS: Record<string, Recipe> = {
  woodcutter: { outfit: ['tunic'], head: ['', 'bandana', 'cap'], item: ['axe'] },
  miner: { outfit: ['work'], head: ['minerHelm'], item: ['pickaxe'] },
  forager: { outfit: ['tunic', 'work'], head: ['strawHat', ''], item: ['basket'] },
  farmer: { outfit: ['work'], head: ['strawHat', 'kerchief'], item: ['hoe'] },
  merchant: { outfit: ['apron', 'coat'], head: ['cap', ''], item: ['bag'] },
  elder: { outfit: ['robe'], head: ['', 'cap'], item: ['cane'] },
  craftsman: { outfit: ['apron'], head: ['bandana', ''], item: ['hammer'] },
  scholar: { outfit: ['coat', 'robe'], head: ['beret', ''], item: ['book'] },
  traveler: { outfit: ['cloak'], head: ['wideHat', 'hood'], item: ['bag'] },
  noble: { outfit: ['coat', 'dress'], head: ['', 'wideHat'], item: [''] },
  bard: { outfit: ['tunic', 'cloak'], head: ['beret'], item: ['lute'] },
  pilgrim: { outfit: ['robe', 'cloak'], head: ['hood', 'wideHat'], item: ['cane'] },
  critic: { outfit: ['coat'], head: ['beret'], item: ['book'] },
  royal: { outfit: ['coat', 'dress'], head: ['crown'], item: [''] },
  // regional townsfolk
  shusheng: { outfit: ['hanfu'], head: ['cap', ''], item: ['book'] },
  taoist: { outfit: ['hanfu', 'robe'], head: ['hood'], item: ['cane'] },
  peddler: { outfit: ['tunic'], head: ['strawHat'], item: ['basket'] },
  watchman: { outfit: ['coat'], head: ['cap'], item: ['cane'] },
  miko: { outfit: ['yukata'], head: [''], item: ['broom'] },
  bonze: { outfit: ['robe'], head: ['wideHat'], item: ['cane'] },
  courier: { outfit: ['tunic'], head: ['headband'], item: ['bag'] },
  ronin: { outfit: ['cloak', 'yukata'], head: ['wideHat', ''], item: ['sword'] },
  boatman: { outfit: ['tunic'], head: ['strawHat'], item: ['spear'] },
  foreman: { outfit: ['work'], head: ['minerHelm'], item: ['hammer'] },
  herbalist: { outfit: ['robe', 'cloak'], head: ['hood'], item: ['basket'] },
  hunter: { outfit: ['leather', 'cloak'], head: ['cap'], item: ['bow'] },
  cameleer: { outfit: ['robe'], head: ['bandana'], item: ['cane'] },
  fortuneTeller: { outfit: ['hanfu', 'robe'], head: ['wideHat'], item: ['fan'] },
  apprentice: { outfit: ['apron'], head: ['bandana', ''], item: ['hammer'] },
  performer: { outfit: ['gi', 'tunic'], head: ['headband'], item: ['spear'] },
  ninja: { outfit: ['ninja'], head: ['ninjaHood'], item: ['dagger'] },
  geisha: { outfit: ['kimono'], head: ['kanzashi'], item: ['fan'] },
  fisherman: { outfit: ['tunic', 'work'], head: ['strawHat'], item: ['rod'] },
  rickshaw: { outfit: ['tunic'], head: ['headband', 'strawHat'], item: [''] },
};
const LOCAL_JOBS: Record<string, string[]> = { zh: ['shusheng', 'taoist', 'peddler', 'watchman', 'fortuneTeller', 'apprentice', 'performer'], ja: ['miko', 'bonze', 'courier', 'ronin', 'ninja', 'geisha', 'fisherman', 'rickshaw'] };

// palette indices (see PALETTE.cloth): each class keeps to a few related colours so a party reads at a glance
const CLASS_CLOTH: Record<ClassKey, number[]> = {
  warrior: [0, 1, 9, 11], knight: [5, 6, 10, 11], archer: [3, 4, 9], rogue: [11, 7, 6, 9],
  mage: [6, 7, 5, 8], cleric: [10, 2, 13], lancer: [4, 1, 0, 5], monk: [1, 2, 0],
};
const CIVIL_CLOTH = [9, 10, 3, 4, 5, 0, 1, 11, 13, 12, 2];
const ACCENT = [2, 10, 9, 11, 0, 5];
const HAIR_W = [5, 5, 3, 2, 1, 0.6, 5, 0.3, 0.6, 0.4];

export function randomJob(role: Role): string {
  if (role === 'gatherer') return pick(GATHER_JOBS);
  if (role === 'civilian') return LOCAL_JOBS[culture.lang] && Math.random() < 0.35 ? pick(LOCAL_JOBS[culture.lang]) : pick(CIVILIAN_JOBS);
  if (role === 'tourist') return pick(TOURIST_KINDS);
  return '';
}

export function makeLook(role: Role, cls: ClassKey, job: string): Look {
  const r = role === 'fighter' ? FIGHTER[cls] : JOBS[job] ?? JOBS.traveler;
  const look: Look = {
    skin: randi(0, LOOK_COUNTS.skin - 1), hair: weighted(HAIR_W.map((_, i) => i), (i) => HAIR_W[i])!, style: randi(0, LOOK_COUNTS.style - 1),
    cloth: pick(role === 'fighter' ? CLASS_CLOTH[cls] : CIVIL_CLOTH), cloth2: pick(ACCENT), pants: randi(0, LOOK_COUNTS.pants - 1),
    outfit: pick(r.outfit), head: pick(r.head), item: pick(r.item), beard: '',
  };
  if (look.style !== 2 && look.style !== 5 && Math.random() < 0.25) look.beard = pick(['full', 'mustache', 'goatee']);
  if (job === 'elder' || job === 'fortuneTeller') { look.hair = GRAY_HAIR; if (Math.random() < 0.5) look.beard = job === 'elder' ? 'full' : 'goatee'; }
  if (job === 'geisha') { look.beard = ''; look.style = 6; look.hair = 1; look.skin = 5; }
  if (job === 'ninja') { look.beard = ''; look.cloth = 11; look.pants = 2; }
  if (cls === 'monk' && role === 'fighter' && Math.random() < 0.5) look.style = BALD;
  if (look.cloth2 === look.cloth) look.cloth2 = 10;
  return look;
}

// older saves picked clothing colours at random; give them the class schemes
export function recolor(look: Look, role: Role, cls: ClassKey) {
  look.cloth = pick(role === 'fighter' ? CLASS_CLOTH[cls] : CIVIL_CLOTH);
  look.cloth2 = pick(ACCENT);
  if (look.cloth2 === look.cloth) look.cloth2 = 10;
}
