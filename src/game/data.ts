export type Slot = 'weapon' | 'armor' | 'accessory';
export type BKind = 'guild' | 'house' | 'food' | 'shop' | 'souvenir' | 'forge' | 'clinic' | 'fun' | 'inn' | 'decor' | 'work';
export type NodeKind = 'tree' | 'rock' | 'bush';

export interface Cost { money: number; wood?: number; stone?: number }

export const ITEMS: Record<string, { value: number }> = {
  wood: { value: 2 }, stone: { value: 2 }, fruit: { value: 2 }, meat: { value: 3 },
  gel: { value: 4 }, wing: { value: 5 }, fang: { value: 8 }, pelt: { value: 8 },
  cloth: { value: 6 }, iron: { value: 12 }, bone: { value: 14 }, crystal: { value: 20 },
  hardwood: { value: 16 }, dust: { value: 22 }, silk: { value: 24 }, scale: { value: 26 },
  ecto: { value: 35 }, gem: { value: 60 }, wyvern: { value: 70 }, dragon: { value: 90 },
  venom: { value: 6 }, spore: { value: 4 }, feather: { value: 5 }, shell: { value: 10 }, horn: { value: 18 },
  frostShard: { value: 30 }, goldOre: { value: 40 }, soulGem: { value: 80 }, emberCore: { value: 55 },
  starDust: { value: 70 }, mithril: { value: 120 },
  honey: { value: 6 }, egg: { value: 5 }, herb: { value: 5 }, slimeCore: { value: 15 }, claw: { value: 12 },
  tusk: { value: 16 }, snakeskin: { value: 14 }, stinger: { value: 20 }, oldCoin: { value: 25 }, silverOre: { value: 28 },
  amber: { value: 30 }, wispLight: { value: 35 }, truffle: { value: 40 }, golemCore: { value: 45 }, pearl: { value: 50 },
  moonstone: { value: 65 }, dragonFang: { value: 110 }, voidShard: { value: 150 },
  // regional: bamboo from the groves, and the finds of Chinese and Japanese lore creatures
  bamboo: { value: 4 }, talisman: { value: 30 }, jadePendant: { value: 48 }, loongScale: { value: 90 },
  kitsunebi: { value: 30 }, tenguFeather: { value: 48 }, kappaPlate: { value: 90 },
  // each village's own product, made in its workshop, and the relic its legendary beast leaves behind
  mapleSyrup: { value: 30 }, steel: { value: 45 }, remedy: { value: 32 }, furCoat: { value: 48 }, spice: { value: 40 },
  heartwood: { value: 140 }, magmaHeart: { value: 150 }, mistPearl: { value: 140 }, everIce: { value: 150 }, sunStone: { value: 150 },
};
// the regional wonders keep rising after completion, each level calling for one of these in turn
export const WONDER_LORE: Record<string, string[]> = { zh: ['talisman', 'jadePendant', 'loongScale'], ja: ['kitsunebi', 'tenguFeather', 'kappaPlate'] };
export function wonderLevelMat(b: { type: string; level: number; stage?: number }): [string, number] | null {
  const d = BUILDINGS[b.type];
  if (!d.wonder || !d.lang || !WONDER_LORE[d.lang] || !finished(b)) return null;
  const list = WONDER_LORE[d.lang];
  return [list[(b.level - 1) % list.length], 3 + 2 * b.level];
}
export const BASE_ITEMS = ['wood', 'stone', 'fruit', 'meat'];
export const FOODS = ['meat', 'fruit'];
export const NODE_ITEM: Record<NodeKind, string> = { tree: 'wood', rock: 'stone', bush: 'fruit' };

export { MONSTERS, zoneMonsters, spawnWeight, mapZone, type MonsterDef, type Fam } from './monsters';

export const CLASSES = {
  warrior: { hp: 34, hpG: 9, atk: 5, atkG: 2, def: 3, defG: 1.2, range: 1, interval: 1.0 },
  knight: { hp: 40, hpG: 10.5, atk: 4, atkG: 1.7, def: 4, defG: 1.6, range: 1, interval: 1.15 },
  archer: { hp: 26, hpG: 7, atk: 6, atkG: 2.3, def: 2, defG: 0.8, range: 3.2, interval: 1.1 },
  rogue: { hp: 24, hpG: 6.5, atk: 5, atkG: 1.8, def: 1.5, defG: 0.7, range: 1, interval: 0.7 },
  mage: { hp: 22, hpG: 6, atk: 8, atkG: 2.7, def: 1, defG: 0.7, range: 3.2, interval: 1.4 },
  cleric: { hp: 30, hpG: 8, atk: 5, atkG: 1.9, def: 2, defG: 1.0, range: 2.5, interval: 1.2 },
  lancer: { hp: 32, hpG: 8.5, atk: 5.5, atkG: 2.2, def: 2.5, defG: 1.0, range: 1.6, interval: 1.05 },
  monk: { hp: 30, hpG: 8, atk: 4.5, atkG: 1.7, def: 2, defG: 0.9, range: 1, interval: 0.8 },
};
export type ClassKey = keyof typeof CLASSES;
export const CLASS_KEYS = Object.keys(CLASSES) as ClassKey[];
export const GATHER_JOBS = ['woodcutter', 'miner', 'forager'] as const;
export const CIVILIAN_JOBS = ['farmer', 'merchant', 'elder', 'craftsman', 'scholar'] as const;
export const TOURIST_KINDS = ['traveler', 'noble', 'bard', 'pilgrim', 'scholar'] as const;

export interface EquipDef { key: string; slot: Slot; tier: number; atk: number; def: number; hp: number; price: number; mat: string }

const eq = (key: string, tier: number, atk: number, def: number, hp: number, price: number, mat: string): EquipDef =>
  ({ key, slot: 'weapon', tier, atk, def, hp, price, mat });

export const EQUIP: Record<Slot, EquipDef[]> = {
  weapon: [
    eq('woodSword', 1, 3, 0, 0, 30, 'wood'),
    eq('bronzeSword', 2, 7, 0, 0, 120, 'fang'),
    eq('ironSword', 3, 13, 0, 0, 400, 'iron'),
    eq('steelBlade', 4, 21, 0, 0, 1200, 'bone'),
    eq('crystalSpear', 5, 33, 0, 0, 3500, 'crystal'),
    eq('mythrilSword', 6, 50, 0, 0, 9000, 'scale'),
    eq('runeBlade', 7, 74, 0, 0, 22000, 'ecto'),
    eq('dragonSlayer', 8, 110, 0, 0, 60000, 'dragon'),
  ],
  armor: [
    eq('clothTunic', 1, 0, 2, 10, 30, 'cloth'),
    eq('leatherArmor', 2, 0, 5, 25, 120, 'pelt'),
    eq('chainmail', 3, 0, 9, 45, 400, 'iron'),
    eq('plateArmor', 4, 0, 15, 80, 1200, 'silverOre'),
    eq('crystalMail', 5, 0, 24, 130, 3500, 'crystal'),
    eq('mythrilArmor', 6, 0, 36, 200, 9000, 'mithril'),
    eq('runeArmor', 7, 0, 52, 300, 22000, 'moonstone'),
    eq('dragonMail', 8, 0, 75, 450, 60000, 'dragon'),
  ],
  accessory: [
    eq('copperRing', 1, 1, 0, 5, 25, 'gel'),
    eq('wingCharm', 2, 2, 0, 15, 100, 'feather'),
    eq('fangNecklace', 3, 4, 0, 25, 350, 'claw'),
    eq('ironBracelet', 4, 7, 0, 40, 1000, 'amber'),
    eq('crystalPendant', 5, 11, 0, 70, 3000, 'pearl'),
    eq('mythrilRing', 6, 16, 0, 110, 8000, 'mithril'),
    eq('runeAmulet', 7, 24, 0, 170, 20000, 'soulGem'),
    eq('dragonHeart', 8, 36, 0, 260, 55000, 'dragonFang'),
  ],
};
for (const [slot, list] of Object.entries(EQUIP)) for (const e of list) e.slot = slot as Slot;
export const ALL_EQUIP = Object.values(EQUIP).flat();
export const SHOP_TIER_LEVELS = [1, 3, 6, 12, 25, 50, 100, 200];
export const shopTier = (level: number) => SHOP_TIER_LEVELS.filter((l) => level >= l).length;
export const equipByKey = (key: string | null): EquipDef | undefined => {
  if (!key) return undefined;
  return ALL_EQUIP.find((e) => e.key === key);
};

export type Category = 'housing' | 'food' | 'shops' | 'leisure' | 'services' | 'decor' | 'land' | 'wonder';
export const CATEGORIES: Category[] = ['housing', 'food', 'shops', 'leisure', 'services', 'decor', 'land', 'wonder'];

export interface BuildingDef {
  size: 1 | 2 | 3 | 4; cost: Cost; attraction: number; price: number; kind: BKind; cat: Category;
  slot?: Slot; unique?: boolean; buildable?: boolean;
  // specialty goods: a sale uses one of these from storage, in order, and adds twice its value to the price
  goods?: string[];
  // [from, to] time of day when the place is busiest; outside it visitors rarely come
  peak?: [number, number]; closed?: [number, number];
  // must stand next to this terrain, and is only offered on maps that have it
  near?: 'water' | 'rock' | 'bog' | 'thicket' | 'vent' | 'cave';
  // items brought in each day at level 1: [item, amount]; fractions are a daily chance
  yield?: [string, number][];
  // regional flavour: only offered while the game is played in this language
  lang?: string;
  // only offered in this village
  village?: string;
  // a wonder: raised in stages, each needing one of these rare materials in turn
  wonder?: string[];
  // people a house holds, if not the usual four
  beds?: number;
  // a standing benefit: interest on savings, richer expeditions, faster-learning adventurers
  perk?: 'interest' | 'escort' | 'academy' | 'relay' | 'dojo' | 'fireWatch' | 'rockGuard' | 'plagueWard' | 'avalancheGuard' | 'droughtGuard';
  // turns [input, amount] into [output, amount] each morning (a workshop's daily batch at level 1)
  convert?: [[string, number], [string, number]];
  // may stand on bog (stilts)
  onBog?: boolean;
}

export { culture, setCulture } from './culture';
import { culture } from './culture';

export const BUILDINGS: Record<string, BuildingDef> = {
  guild: { size: 2, cost: { money: 0 }, attraction: 3, price: 0, kind: 'guild', cat: 'services', unique: true, buildable: false },
  house: { size: 1, cost: { money: 500, wood: 10 }, attraction: 0, price: 0, kind: 'house', cat: 'housing' },
  breakfastShop: { size: 1, cost: { money: 900, wood: 10 }, attraction: 2, price: 8, kind: 'food', cat: 'food', peak: [0, 0.3], closed: [0.45, 1], goods: ['egg', 'honey'] },
  bakery: { size: 1, cost: { money: 1100, wood: 10, stone: 10 }, attraction: 2, price: 10, kind: 'food', cat: 'food', peak: [0, 0.4], goods: ['honey', 'egg'] },
  restaurant: { size: 2, cost: { money: 1250, wood: 20, stone: 5 }, attraction: 4, price: 14, kind: 'food', cat: 'food', peak: [0.35, 0.75], goods: ['truffle', 'egg', 'herb'] },
  weaponShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'weapon' },
  armorShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'armor' },
  accessoryShop: { size: 1, cost: { money: 1500, wood: 10, stone: 5 }, attraction: 3, price: 18, kind: 'shop', cat: 'shops', slot: 'accessory', goods: ['oldCoin', 'moonstone'] },
  souvenirShop: { size: 1, cost: { money: 1800, wood: 20 }, attraction: 3, price: 24, kind: 'souvenir', cat: 'shops', goods: ['mapleSyrup', 'steel', 'remedy', 'furCoat', 'spice', 'pearl', 'amber', 'feather', 'shell', 'horn', 'bamboo'] },
  cafe: { size: 1, cost: { money: 1600, wood: 10, stone: 5 }, attraction: 4, price: 12, kind: 'fun', cat: 'leisure', peak: [0.15, 0.6], goods: ['honey', 'herb'] },
  teahouse: { size: 1, cost: { money: 2000, wood: 25 }, attraction: 4, price: 15, kind: 'fun', cat: 'leisure', peak: [0.3, 0.7], goods: ['herb', 'spore'] },
  tavern: { size: 2, cost: { money: 1750, wood: 25 }, attraction: 5, price: 12, kind: 'fun', cat: 'leisure', peak: [0.55, 1], closed: [0, 0.3], goods: ['honey', 'herb'] },
  bathhouse: { size: 2, cost: { money: 3750, wood: 20, stone: 25 }, attraction: 8, price: 20, kind: 'fun', cat: 'leisure', peak: [0.5, 0.8], goods: ['herb', 'spore'] },
  spa: { size: 2, cost: { money: 9000, wood: 60, stone: 120 }, attraction: 14, price: 38, kind: 'fun', cat: 'leisure', peak: [0.45, 0.85], goods: ['emberCore', 'frostShard', 'herb'] },
  theater: { size: 2, cost: { money: 11000, wood: 120, stone: 80 }, attraction: 16, price: 32, kind: 'fun', cat: 'leisure', peak: [0.5, 0.85], goods: ['silk', 'wispLight'] },
  arena: { size: 2, cost: { money: 13000, stone: 200 }, attraction: 14, price: 26, kind: 'fun', cat: 'leisure', peak: [0.2, 0.7] },
  inn: { size: 2, cost: { money: 2250, wood: 30, stone: 10 }, attraction: 4, price: 35, kind: 'inn', cat: 'housing', goods: ['pelt', 'snakeskin'] },
  forge: { size: 2, cost: { money: 3000, wood: 10, stone: 30 }, attraction: 1, price: 0, kind: 'forge', cat: 'services', unique: true },
  clinic: { size: 2, cost: { money: 2500, wood: 20, stone: 10 }, attraction: 1, price: 20, kind: 'clinic', cat: 'services', goods: ['herb', 'slimeCore', 'venom'] },
  flowerbed: { size: 1, cost: { money: 150 }, attraction: 2, price: 0, kind: 'decor', cat: 'decor' },
  fountain: { size: 1, cost: { money: 1000, stone: 15 }, attraction: 6, price: 0, kind: 'decor', cat: 'decor' },
  statue: { size: 1, cost: { money: 2500, stone: 60 }, attraction: 9, price: 0, kind: 'decor', cat: 'decor' },
  lamppost: { size: 1, cost: { money: 200, stone: 4 }, attraction: 1, price: 0, kind: 'decor', cat: 'decor' },
  bench: { size: 1, cost: { money: 250, wood: 8 }, attraction: 1, price: 0, kind: 'decor', cat: 'decor' },
  hedge: { size: 1, cost: { money: 180, wood: 4 }, attraction: 1, price: 0, kind: 'decor', cat: 'decor' },
  well: { size: 1, cost: { money: 600, stone: 20 }, attraction: 3, price: 0, kind: 'decor', cat: 'decor' },
  pond: { size: 1, cost: { money: 800, stone: 10 }, attraction: 4, price: 0, kind: 'decor', cat: 'decor' },
  flowerArch: { size: 1, cost: { money: 900, wood: 15 }, attraction: 4, price: 0, kind: 'decor', cat: 'decor' },
  gazebo: { size: 2, cost: { money: 3500, wood: 60, stone: 20 }, attraction: 10, price: 0, kind: 'decor', cat: 'decor' },
  windmill: { size: 2, cost: { money: 4500, wood: 90, stone: 30 }, attraction: 9, price: 0, kind: 'decor', cat: 'decor' },
  clockTower: { size: 2, cost: { money: 12000, stone: 220 }, attraction: 18, price: 0, kind: 'decor', cat: 'decor' },
  fishingDock: { size: 1, cost: { money: 1400, wood: 30 }, attraction: 4, price: 16, kind: 'food', cat: 'land', near: 'water', peak: [0.3, 0.7], yield: [['meat', 3], ['shell', 0.3], ['pearl', 0.08]] },
  waterMill: { size: 2, cost: { money: 3800, wood: 80, stone: 20 }, attraction: 8, price: 0, kind: 'decor', cat: 'land', near: 'water', yield: [['fruit', 6]] },
  quarry: { size: 2, cost: { money: 2400, wood: 40 }, attraction: 1, price: 0, kind: 'work', cat: 'land', near: 'rock', yield: [['stone', 8], ['silverOre', 0.3], ['goldOre', 0.1]] },
  lookout: { size: 1, cost: { money: 2200, wood: 40, stone: 20 }, attraction: 7, price: 10, kind: 'fun', cat: 'land', near: 'rock', peak: [0.2, 0.75] },
  mudBath: { size: 2, cost: { money: 3200, wood: 40, stone: 20 }, attraction: 9, price: 22, kind: 'fun', cat: 'land', near: 'bog', peak: [0.4, 0.85], goods: ['herb', 'spore'] },
  herbGarden: { size: 1, cost: { money: 1300, wood: 20 }, attraction: 2, price: 0, kind: 'work', cat: 'land', near: 'bog', yield: [['herb', 2], ['spore', 0.5]] },
  lumberCamp: { size: 2, cost: { money: 1800, wood: 10, stone: 10 }, attraction: 1, price: 0, kind: 'work', cat: 'land', near: 'thicket', yield: [['wood', 10], ['hardwood', 0.4]] },
  paifang: { size: 1, cost: { money: 2600, wood: 30, stone: 40 }, attraction: 8, price: 0, kind: 'decor', cat: 'decor', lang: 'zh' },
  operaStage: { size: 2, cost: { money: 6500, wood: 110, stone: 30 }, attraction: 13, price: 28, kind: 'fun', cat: 'leisure', lang: 'zh', peak: [0.6, 1], goods: ['silk', 'feather'] },
  onsen: { size: 2, cost: { money: 7000, wood: 50, stone: 110 }, attraction: 14, price: 34, kind: 'fun', cat: 'leisure', lang: 'ja', peak: [0.45, 0.9], goods: ['herb', 'emberCore'] },
  torii: { size: 1, cost: { money: 1800, wood: 50 }, attraction: 7, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  stoneLantern: { size: 1, cost: { money: 500, stone: 18 }, attraction: 2, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  pharmacy: { size: 1, cost: { money: 2000, wood: 20, stone: 10 }, attraction: 2, price: 18, kind: 'clinic', cat: 'services', lang: 'zh', goods: ['herb', 'spore'] },
  earthShrine: { size: 1, cost: { money: 1200, stone: 30 }, attraction: 5, price: 0, kind: 'decor', cat: 'decor', lang: 'zh' },
  baoziShop: { size: 1, cost: { money: 900, wood: 15 }, attraction: 2, price: 9, kind: 'food', cat: 'food', lang: 'zh', peak: [0, 0.45], goods: ['meat', 'egg'] },
  tanghuluStall: { size: 1, cost: { money: 600, wood: 10 }, attraction: 3, price: 7, kind: 'food', cat: 'food', lang: 'zh', peak: [0.2, 0.7], goods: ['honey', 'fruit'] },
  shrine: { size: 2, cost: { money: 5000, wood: 80, stone: 60 }, attraction: 12, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  teaRoom: { size: 1, cost: { money: 2100, wood: 30 }, attraction: 5, price: 16, kind: 'fun', cat: 'leisure', lang: 'ja', peak: [0.3, 0.7], goods: ['herb'] },
  pagoda: { size: 2, cost: { money: 10000, wood: 160, stone: 60 }, attraction: 16, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  koiPond: { size: 1, cost: { money: 1100, stone: 20 }, attraction: 5, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  takoyakiStall: { size: 1, cost: { money: 700, wood: 10 }, attraction: 3, price: 9, kind: 'food', cat: 'food', lang: 'ja', peak: [0.4, 0.95], goods: ['meat'] },
  dangoStall: { size: 1, cost: { money: 600, wood: 10 }, attraction: 3, price: 7, kind: 'food', cat: 'food', lang: 'ja', peak: [0.2, 0.7], goods: ['honey'] },
  siheyuan: { size: 2, cost: { money: 2600, wood: 60, stone: 40 }, attraction: 4, price: 0, kind: 'house', cat: 'housing', lang: 'zh', beds: 8 },
  qianzhuang: { size: 1, cost: { money: 5000, wood: 20, stone: 30 }, attraction: 2, price: 0, kind: 'work', cat: 'services', lang: 'zh', unique: true, perk: 'interest' },
  biaoju: { size: 2, cost: { money: 4500, wood: 60, stone: 40 }, attraction: 2, price: 0, kind: 'work', cat: 'services', lang: 'zh', unique: true, perk: 'escort' },
  shuyuan: { size: 2, cost: { money: 5500, wood: 90, stone: 40 }, attraction: 5, price: 0, kind: 'work', cat: 'services', lang: 'zh', unique: true, perk: 'academy' },
  fengyuqiao: { size: 2, cost: { money: 3000, wood: 90, stone: 30 }, attraction: 9, price: 0, kind: 'decor', cat: 'land', lang: 'zh', near: 'water' },
  ryokan: { size: 2, cost: { money: 3000, wood: 50, stone: 20 }, attraction: 6, price: 40, kind: 'inn', cat: 'housing', lang: 'ja', goods: ['silk', 'herb'] },
  sento: { size: 2, cost: { money: 3200, wood: 30, stone: 40 }, attraction: 7, price: 18, kind: 'fun', cat: 'leisure', lang: 'ja', peak: [0.55, 0.9], goods: ['herb'] },
  terakoya: { size: 1, cost: { money: 4500, wood: 40 }, attraction: 3, price: 0, kind: 'work', cat: 'services', lang: 'ja', unique: true, perk: 'academy' },
  sumoRing: { size: 2, cost: { money: 5000, wood: 80, stone: 30 }, attraction: 12, price: 24, kind: 'fun', cat: 'leisure', lang: 'ja', peak: [0.3, 0.7] },
  inariShrine: { size: 1, cost: { money: 1600, wood: 50 }, attraction: 6, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  zenGarden: { size: 2, cost: { money: 2400, stone: 60 }, attraction: 8, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  kakigoriStall: { size: 1, cost: { money: 600, wood: 10 }, attraction: 3, price: 6, kind: 'food', cat: 'food', lang: 'ja', peak: [0.3, 0.7] },
  jangseung: { size: 1, cost: { money: 900, wood: 30 }, attraction: 4, price: 0, kind: 'decor', cat: 'decor', lang: 'ko' },
  mineShaft: { size: 2, cost: { money: 3200, wood: 60, stone: 20 }, attraction: 1, price: 0, kind: 'work', cat: 'land', near: 'cave', yield: [['iron', 3], ['silverOre', 0.8], ['goldOre', 0.3], ['crystal', 0.15]] },
  riverPort: { size: 2, cost: { money: 3000, wood: 70, stone: 20 }, attraction: 6, price: 26, kind: 'souvenir', cat: 'land', near: 'water', village: 'maple', goods: ['pearl', 'shell', 'amber'] },
  stiltHouse: { size: 1, cost: { money: 600, wood: 20 }, attraction: 1, price: 0, kind: 'house', cat: 'housing', near: 'bog', village: 'mist', onBog: true },
  snowLodge: { size: 2, cost: { money: 3200, wood: 70, stone: 30 }, attraction: 6, price: 38, kind: 'inn', cat: 'housing', village: 'frost', goods: ['pelt', 'frostShard'] },
  caravanserai: { size: 2, cost: { money: 4200, wood: 30, stone: 70 }, attraction: 7, price: 40, kind: 'inn', cat: 'land', near: 'water', village: 'sun', goods: ['silk', 'amber'] },
  cathedral: { size: 4, cost: { money: 20000, wood: 300, stone: 600 }, attraction: 45, price: 0, kind: 'decor', cat: 'wonder', unique: true, wonder: ['soulGem', 'moonstone', 'crystal'] },
  colossus: { size: 4, cost: { money: 20000, wood: 100, stone: 800 }, attraction: 45, price: 0, kind: 'decor', cat: 'wonder', unique: true, wonder: ['goldOre', 'mithril', 'emberCore'] },
  observatory: { size: 4, cost: { money: 22000, wood: 200, stone: 500 }, attraction: 42, price: 0, kind: 'decor', cat: 'wonder', unique: true, wonder: ['starDust', 'crystal', 'mithril'] },
  palace: { size: 4, cost: { money: 25000, wood: 500, stone: 500 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, lang: 'zh', wonder: ['gem', 'goldOre', 'silk'] },
  craneTower: { size: 4, cost: { money: 22000, wood: 600, stone: 300 }, attraction: 50, price: 0, kind: 'decor', cat: 'wonder', unique: true, lang: 'zh', wonder: ['feather', 'amber', 'gem'] },
  castle: { size: 4, cost: { money: 25000, wood: 400, stone: 700 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, lang: 'ja', wonder: ['mithril', 'dragonFang', 'iron'] },
  goldenPavilion: { size: 4, cost: { money: 22000, wood: 400, stone: 300 }, attraction: 50, price: 0, kind: 'decor', cat: 'wonder', unique: true, lang: 'ja', wonder: ['goldOre', 'pearl', 'moonstone'] },
  farmField: { size: 2, cost: { money: 900, wood: 20 }, attraction: 1, price: 0, kind: 'work', cat: 'land', yield: [['fruit', 4], ['herb', 0.3]] },
  ruins: { size: 1, cost: { money: 0 }, attraction: 3, price: 0, kind: 'decor', cat: 'decor', buildable: false },
  drumTower: { size: 1, cost: { money: 2400, wood: 40, stone: 30 }, attraction: 7, price: 0, kind: 'decor', cat: 'decor', lang: 'zh' },
  yizhan: { size: 2, cost: { money: 3800, wood: 70, stone: 20 }, attraction: 3, price: 0, kind: 'work', cat: 'services', lang: 'zh', unique: true, perk: 'relay' },
  stoneMill: { size: 1, cost: { money: 1400, wood: 10, stone: 40 }, attraction: 3, price: 0, kind: 'work', cat: 'land', lang: 'zh', near: 'water', yield: [['fruit', 2]] },
  chaya: { size: 1, cost: { money: 1300, wood: 25 }, attraction: 5, price: 12, kind: 'fun', cat: 'leisure', lang: 'ja', peak: [0.2, 0.65], goods: ['herb', 'bamboo'] },
  senbonTorii: { size: 1, cost: { money: 2200, wood: 70 }, attraction: 8, price: 0, kind: 'decor', cat: 'decor', lang: 'ja' },
  dojo: { size: 2, cost: { money: 5000, wood: 100, stone: 30 }, attraction: 4, price: 0, kind: 'work', cat: 'services', lang: 'ja', unique: true, perk: 'dojo' },
  fishMarket: { size: 2, cost: { money: 3400, wood: 60, stone: 20 }, attraction: 7, price: 14, kind: 'food', cat: 'land', lang: 'ja', near: 'water', peak: [0, 0.3], goods: ['shell', 'pearl'], yield: [['meat', 3], ['shell', 0.3]] },
  yatai: { size: 1, cost: { money: 800, wood: 15 }, attraction: 4, price: 10, kind: 'food', cat: 'food', lang: 'ja', peak: [0.55, 0.85], closed: [0, 0.5], goods: ['meat'] },
  // village workshops making each village's product
  sugarHouse: { size: 1, cost: { money: 2400, wood: 40 }, attraction: 3, price: 0, kind: 'work', cat: 'land', village: 'maple', convert: [['wood', 6], ['mapleSyrup', 1]] },
  steelworks: { size: 2, cost: { money: 4200, wood: 30, stone: 80 }, attraction: 2, price: 0, kind: 'work', cat: 'land', village: 'iron', convert: [['iron', 3], ['steel', 1]] },
  apothecary: { size: 1, cost: { money: 2800, wood: 30, stone: 10 }, attraction: 3, price: 0, kind: 'work', cat: 'services', village: 'mist', perk: 'plagueWard', convert: [['herb', 4], ['remedy', 1]] },
  furrier: { size: 1, cost: { money: 2600, wood: 40 }, attraction: 3, price: 0, kind: 'work', cat: 'land', village: 'frost', convert: [['pelt', 3], ['furCoat', 1]] },
  spiceHouse: { size: 1, cost: { money: 2600, wood: 20, stone: 30 }, attraction: 4, price: 0, kind: 'work', cat: 'land', village: 'sun', convert: [['fruit', 5], ['spice', 1]] },
  // each village's guard against its own disaster
  watchtower: { size: 1, cost: { money: 2000, wood: 60 }, attraction: 2, price: 0, kind: 'decor', cat: 'services', village: 'maple', unique: true, perk: 'fireWatch' },
  shoring: { size: 1, cost: { money: 1800, wood: 80 }, attraction: 1, price: 0, kind: 'decor', cat: 'services', village: 'iron', unique: true, perk: 'rockGuard' },
  snowFence: { size: 1, cost: { money: 1600, wood: 50, stone: 20 }, attraction: 1, price: 0, kind: 'decor', cat: 'services', village: 'frost', unique: true, perk: 'avalancheGuard' },
  deepWell: { size: 1, cost: { money: 2400, stone: 70 }, attraction: 3, price: 0, kind: 'decor', cat: 'services', village: 'sun', unique: true, perk: 'droughtGuard' },
  // a wonder of each village's own
  greatMaple: { size: 4, cost: { money: 24000, wood: 500, stone: 300 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, village: 'maple', wonder: ['mapleSyrup', 'heartwood', 'gem'] },
  greatFurnace: { size: 4, cost: { money: 26000, wood: 200, stone: 700 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, village: 'iron', wonder: ['steel', 'magmaHeart', 'goldOre'] },
  floatingPagoda: { size: 4, cost: { money: 24000, wood: 500, stone: 300 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, village: 'mist', wonder: ['remedy', 'mistPearl', 'wispLight'] },
  icePalace: { size: 4, cost: { money: 26000, wood: 200, stone: 600 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, village: 'frost', wonder: ['furCoat', 'everIce', 'frostShard'] },
  sunPyramid: { size: 4, cost: { money: 26000, wood: 100, stone: 800 }, attraction: 55, price: 0, kind: 'decor', cat: 'wonder', unique: true, village: 'sun', wonder: ['spice', 'sunStone', 'amber'] },
  hunterLodge: { size: 1, cost: { money: 1500, wood: 25 }, attraction: 2, price: 0, kind: 'work', cat: 'land', near: 'thicket', yield: [['meat', 3], ['pelt', 0.3], ['feather', 0.3]] },
};
export const WONDER_STAGES = 5;
export const hasPerk = (buildings: { type: string }[], perk: string) => buildings.some((b) => BUILDINGS[b.type].perk === perk);
// an unfinished wonder is a building site and does nothing yet; older buildings carry no stage and count as done
export const finished = (b: { type: string; stage?: number }) => !BUILDINGS[b.type].wonder || (b.stage ?? WONDER_STAGES) >= WONDER_STAGES;
// cost of raising a wonder to stage k (1..WONDER_STAGES); stage 0, the footing, costs the listed price
export function wonderCost(type: string, k: number): Cost & { mat: string; count: number } {
  const d = BUILDINGS[type], f = 1 + 0.5 * k;
  const mat = d.wonder![(k - 1) % d.wonder!.length];
  // a legendary beast's relic is scarce: a stage wants only a few
  const relic = ['heartwood', 'magmaHeart', 'mistPearl', 'everIce', 'sunStone'].includes(mat);
  return { money: Math.round(d.cost.money * f), wood: Math.round((d.cost.wood ?? 0) * f), stone: Math.round((d.cost.stone ?? 0) * f), mat, count: relic ? 1 + k : 8 + 5 * k };
}

// terrain buildings only appear where the map has their terrain
export const bldAvailable = (s: { village: string; terrain?: { water: number[]; rock: number[]; bog: number[]; thicket: number[]; vent?: number[]; cave?: number[] } }, type: string) => {
  const d = BUILDINGS[type];
  if (d.lang && d.lang !== culture.lang) return false;
  if (d.village && d.village !== s.village) return false;
  return !d.near || (s.terrain?.[d.near]?.length ?? 0) > 0;
};
// decorations also lift the takings of businesses that stand near them
export const DECOR_RADIUS = 3;
export const DECOR_STEP = 0.03;
export const DECOR_MAX = 0.3;
export const ROAD_COST = 10;

const inRange = (t: number, r?: [number, number]) => !!r && t >= r[0] && t < r[1];
export const isOpen = (type: string, t: number) => !inRange(t, BUILDINGS[type].closed);
export const isPeak = (type: string, t: number) => inRange(t, BUILDINGS[type].peak);

export interface ExpeditionDef { key: string; unlockYear: number; days: number; monsters: string[]; village?: string }

export const EXPEDITIONS: ExpeditionDef[] = [
  { key: 'woods', unlockYear: 1, days: 6, monsters: ['treant', 'fairy', 'pixie', 'bloomHorror', 'forestBear', 'elderStag'] },
  { key: 'mine', unlockYear: 2, days: 7, monsters: ['spider', 'lizard', 'koboldMiner', 'caveBat', 'ironGolem', 'crystalSpider'] },
  { key: 'marsh', unlockYear: 3, days: 8, monsters: ['swampSlime', 'lizardman', 'swampSerpent', 'marshHag', 'bloodMoss', 'giantToad'] },
  { key: 'ruins', unlockYear: 5, days: 9, monsters: ['ghost', 'mimic', 'mummy', 'sentinel', 'cursedArmor', 'lich'] },
  { key: 'tomb', unlockYear: 6, days: 10, monsters: ['sandScorpion', 'scarab', 'cobra', 'sandGolem', 'mummyLord', 'sphinx'] },
  { key: 'frozen', unlockYear: 8, days: 10, monsters: ['frostWolf', 'iceGolem', 'snowHarpy', 'iceWraith', 'frostGiant', 'iceDrake'] },
  { key: 'volcano', unlockYear: 10, days: 11, monsters: ['magmaSlime', 'fireImp', 'salamander', 'lavaGolem', 'hellhound', 'phoenix'] },
  { key: 'sky', unlockYear: 12, days: 12, monsters: ['thunderBird', 'cloudSlime', 'skyWisp', 'griffin', 'stormSpirit', 'sentry'] },
  { key: 'ridge', unlockYear: 13, days: 12, monsters: ['wyvern', 'drake', 'greenDragon', 'redDragon', 'blackDragon'] },
  { key: 'abyss', unlockYear: 15, days: 14, monsters: ['demon', 'shadowBeast', 'voidSlime', 'eldritchEye', 'boneDragon', 'abyssLord'] },
  // sites only one village can reach
  { key: 'coralIsle', unlockYear: 4, days: 9, monsters: ['rockCrab', 'mossTurtle', 'swampSerpent', 'harpy', 'giantToad', 'hydra'], village: 'maple' },
  { key: 'deepForge', unlockYear: 4, days: 9, monsters: ['koboldMiner', 'ironGolem', 'magmaSlime', 'salamander', 'fireImp', 'lavaGolem'], village: 'iron' },
  { key: 'sunkenShrine', unlockYear: 4, days: 9, monsters: ['ghost', 'wisp', 'bogLantern', 'swampSerpent', 'marshHag', 'hydra'], village: 'mist' },
  { key: 'glacierHeart', unlockYear: 4, days: 10, monsters: ['frostWolf', 'iceGolem', 'yeti', 'iceWraith', 'frostGiant', 'iceDrake'], village: 'frost' },
  { key: 'lostCity', unlockYear: 4, days: 10, monsters: ['scarab', 'cobra', 'mummy', 'sandGolem', 'sphinx', 'sandWorm'], village: 'sun' },
];
export const EXPEDITION_PARTY = 4;

export interface VillageMods {
  wood: number; stone: number; fruit: number; monsterRate: number; monsterLevel: number;
  hunger: number; drops: number; touristRate: number; touristSpend: number; forgeCost: number;
}
export type Ground = 'meadow' | 'rocky' | 'marsh' | 'snow' | 'sand';
// terrain features, all generated from these numbers so a village always looks the same.
// river: runs the map's length along an axis ('at' is its mean position across, 'w' its width)
// lake: a pond too wide to bridge; ridge: a broken line of rock from a to b; rocks/bog/thicket: patches [x, y, radius]
export interface TerrainDef {
  river?: { along: 'x' | 'y'; at: number; amp: number; w: number; seed: number };
  lakes?: [number, number, number, number][];
  ridges?: [number, number, number, number][];
  rocks?: [number, number, number][];
  bog?: [number, number, number][];
  thicket?: [number, number, number][];
  // single-tile features: steaming hot-spring vents and cave mouths; flower meadows are patches [x, y, radius]
  vents?: [number, number][];
  caves?: [number, number][];
  flowers?: [number, number, number][];
  // shallow streams anyone can wade: a polyline of points
  streams?: [number, number][][];
  // open sea along the back (y = 0) edge, about this many tiles deep, with a beach and a few reefs
  sea?: number;
  // the back corner's peak is a live volcano whose lava wanders from year to year
  volcano?: boolean;
  // hot spring pools, patches [x, y, radius]
  springs?: [number, number, number][];
  // mangrove swamp on the coast, patches [x, y, radius]; a stone forest of tall pillars, patches [x, y, radius]
  mangroves?: [number, number, number][];
  pillars?: [number, number, number][];
  // travertine terraces: hot spring pools stepping down a slope, 2x2 pools from the top step to the bottom
  terraces?: [number, number][];
  // a glacier this many tiles deep along the back (y = 0) edge, split by crevasses
  glacier?: number;
  // round sinkholes dropping into the ground, [x, y, radius]
  sinkholes?: [number, number, number][];
  // an old battlefield, [x, y, radius]: rusted arms in the grass, stronger monsters and better spoils
  battlefield?: [number, number, number];
  // a deep gorge three tiles wide along this line; a rope bridge carries the road across
  canyon?: [number, number][];
}
// start: opening stock; theme: the commission kind this village posts more often
export interface VillageDef { key: string; ground: Ground; mods: Partial<VillageMods>; terrain: TerrainDef; road: number; start: { money: number; wood: number; stone: number; fruit: number; meat?: number }; theme: string }
// street paving inside the village; index 0 is the original cobbles
export const ROAD_STYLES = ['cobble', 'brick', 'flagstone', 'gravel', 'plank', 'sandstone'] as const;

export const VILLAGES: VillageDef[] = [
  { key: 'maple', ground: 'meadow', mods: {}, terrain: { river: { along: 'y', at: 26.5, amp: 1.6, w: 2, seed: 1 }, thicket: [[37, 25, 2.2], [43, 41, 3], [14, 16, 4], [50, 12, 3.5], [12, 46, 3]], streams: [[[63, 12], [52, 15], [46, 20], [44, 26]], [[6, 40], [10, 44], [13, 47], [17, 52]]], flowers: [[40, 47, 3], [17, 40, 3.5], [47, 15, 3]], sea: 5, mangroves: [[54, 6.5, 3.2], [36, 6, 2.6]], battlefield: [10, 30, 3] }, road: 0, start: { money: 4000, wood: 40, stone: 30, fruit: 30 }, theme: 'build' },
  { key: 'iron', ground: 'rocky', mods: { wood: 0.6, stone: 2, monsterLevel: 5, forgeCost: 0.7 }, terrain: { ridges: [[6, 20, 26, 14], [38, 14, 58, 22], [44, 46, 60, 40], [6, 44, 20, 52]], rocks: [[26, 37, 1.3], [37, 26, 1.2], [35, 38, 0.9], [18, 30, 1.6], [47, 31, 1.8]], thicket: [[24, 24, 1.6]], vents: [[20, 47], [21, 47], [47, 20], [13, 8], [8, 13], [14, 10]], springs: [[16, 9.5, 2.4], [10, 16, 2.2], [23, 50, 2]], caves: [[16, 17], [48, 18], [51, 43]], flowers: [[29, 45, 2]], volcano: true, terraces: [[15, 36], [17, 38], [19, 40]], sinkholes: [[53, 24, 2.4]], battlefield: [42, 54, 3] }, road: 2, start: { money: 3500, wood: 20, stone: 120, fruit: 20 }, theme: 'forge' },
  { key: 'mist', ground: 'marsh', mods: { fruit: 2, monsterRate: 1.5, touristRate: 0.7 }, terrain: { river: { along: 'x', at: 38, amp: 2, w: 3, seed: 2 }, bog: [[25, 26, 2.4], [37, 25, 2], [18, 22, 4], [48, 18, 4], [20, 50, 3.5], [50, 50, 3]], thicket: [[12, 32, 3]], streams: [[[0, 20], [10, 22], [18, 18], [24, 16]]], flowers: [[44, 31, 2.5], [14, 40, 3]], pillars: [[31, 53, 3.2], [53, 34, 2.6]], battlefield: [9, 9, 3] }, road: 4, start: { money: 4000, wood: 60, stone: 20, fruit: 80 }, theme: 'fam' },
  { key: 'frost', ground: 'snow', mods: { hunger: 1.5, drops: 1.5, monsterLevel: 10, touristRate: 0.8 }, terrain: { lakes: [[40.5, 25.5, 3.6, 2.8], [16, 44, 5, 4]], rocks: [[25, 37, 1.4], [44, 38, 1.6], [20, 22, 2]], ridges: [[48, 50, 60, 44]], thicket: [[36, 44, 2]], vents: [[22, 27], [41, 47], [42, 47]], springs: [[20, 29.5, 2.3], [44, 49.5, 2.1]], glacier: 4, battlefield: [52, 13, 3] }, road: 3, start: { money: 5000, wood: 60, stone: 40, fruit: 20, meat: 30 }, theme: 'deliver' },
  { key: 'sun', ground: 'sand', mods: { wood: 0.3, fruit: 0.5, touristSpend: 1.5, touristRate: 1.3 }, terrain: { lakes: [[25, 26, 2.6, 2.2]], rocks: [[38, 38, 2], [44, 22, 2.4], [16, 40, 3], [50, 48, 2.6]], ridges: [[10, 12, 28, 8]], canyon: [[57, 6], [55, 18], [57, 30], [56, 42], [52, 56], [50, 63]], battlefield: [12, 52, 3] }, road: 5, start: { money: 6000, wood: 10, stone: 40, fruit: 10 }, theme: 'earn' },
];
const DEFAULT_MODS: VillageMods = {
  wood: 1, stone: 1, fruit: 1, monsterRate: 1, monsterLevel: 0,
  hunger: 1, drops: 1, touristRate: 1, touristSpend: 1, forgeCost: 1,
};
export const villageDef = (key: string) => VILLAGES.find((v) => v.key === key) ?? VILLAGES[0];
export const villageMods = (key: string): VillageMods => ({ ...DEFAULT_MODS, ...villageDef(key).mods });
