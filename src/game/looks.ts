import { CIVILIAN_JOBS, GATHER_JOBS, TOURIST_KINDS, type ClassKey } from './data';
import { pick, randi } from './util';
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
  maid: { outfit: ['dress'], head: ['kerchief', ''], item: ['broom', ''] },
  scholar: { outfit: ['coat', 'robe'], head: ['beret', ''], item: ['book'] },
  traveler: { outfit: ['cloak'], head: ['wideHat', 'hood'], item: ['bag'] },
  noble: { outfit: ['coat', 'dress'], head: ['', 'wideHat'], item: [''] },
  bard: { outfit: ['tunic', 'cloak'], head: ['beret'], item: ['lute'] },
  pilgrim: { outfit: ['robe', 'cloak'], head: ['hood', 'wideHat'], item: ['cane'] },
};

export function randomJob(role: Role): string {
  if (role === 'gatherer') return pick(GATHER_JOBS);
  if (role === 'civilian') return pick(CIVILIAN_JOBS);
  if (role === 'tourist') return pick(TOURIST_KINDS);
  return '';
}

export function makeLook(role: Role, cls: ClassKey, job: string): Look {
  const r = role === 'fighter' ? FIGHTER[cls] : JOBS[job] ?? JOBS.traveler;
  const look: Look = {
    skin: randi(0, LOOK_COUNTS.skin - 1), hair: randi(0, LOOK_COUNTS.hair - 1), style: randi(0, LOOK_COUNTS.style - 1),
    cloth: randi(0, LOOK_COUNTS.cloth - 1), cloth2: randi(0, LOOK_COUNTS.cloth - 1), pants: randi(0, LOOK_COUNTS.pants - 1),
    outfit: pick(r.outfit), head: pick(r.head), item: pick(r.item), beard: '',
  };
  if (look.style !== 2 && look.style !== 5 && Math.random() < 0.25) look.beard = pick(['full', 'mustache', 'goatee']);
  if (job === 'elder') { look.hair = GRAY_HAIR; if (Math.random() < 0.5) look.beard = 'full'; }
  if (cls === 'monk' && role === 'fighter' && Math.random() < 0.5) look.style = BALD;
  return look;
}
