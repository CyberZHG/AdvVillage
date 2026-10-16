export type Slot = 'weapon' | 'armor' | 'accessory';
export type BKind = 'guild' | 'house' | 'food' | 'shop' | 'souvenir' | 'forge' | 'clinic' | 'fun' | 'inn' | 'decor';
export type NodeKind = 'tree' | 'rock' | 'bush';

export interface Cost { money: number; wood?: number; stone?: number }

export const ITEMS: Record<string, { value: number }> = {
  wood: { value: 2 }, stone: { value: 2 }, fruit: { value: 2 }, meat: { value: 3 },
  gel: { value: 4 }, wing: { value: 5 }, fang: { value: 8 }, pelt: { value: 8 },
  cloth: { value: 6 }, iron: { value: 12 }, bone: { value: 14 }, crystal: { value: 20 },
  hardwood: { value: 16 }, dust: { value: 22 }, silk: { value: 24 }, scale: { value: 26 },
  ecto: { value: 35 }, gem: { value: 60 }, wyvern: { value: 70 }, dragon: { value: 90 },
};
export const BASE_ITEMS = ['wood', 'stone', 'fruit', 'meat'];
export const FOODS = ['meat', 'fruit'];
export const NODE_ITEM: Record<NodeKind, string> = { tree: 'wood', rock: 'stone', bush: 'fruit' };

export interface MonsterDef { hp: number; atk: number; def: number; base: number; zone: number; drops: [string, number][] }

// zone -1 = expedition only
export const MONSTERS: Record<string, MonsterDef> = {
  slime: { hp: 22, atk: 4, def: 1, base: 1, zone: 0, drops: [['gel', 3], ['meat', 1]] },
  bat: { hp: 16, atk: 6, def: 1, base: 2, zone: 0, drops: [['wing', 2], ['meat', 1]] },
  wolf: { hp: 38, atk: 8, def: 3, base: 6, zone: 1, drops: [['meat', 2], ['pelt', 1], ['fang', 1]] },
  goblin: { hp: 40, atk: 9, def: 3, base: 9, zone: 1, drops: [['cloth', 2], ['iron', 1]] },
  skeleton: { hp: 55, atk: 12, def: 5, base: 16, zone: 2, drops: [['bone', 2], ['iron', 1]] },
  golem: { hp: 90, atk: 13, def: 8, base: 22, zone: 2, drops: [['crystal', 1], ['stone', 2]] },
  treant: { hp: 80, atk: 10, def: 6, base: 8, zone: -1, drops: [['hardwood', 2], ['fruit', 1]] },
  fairy: { hp: 30, atk: 14, def: 2, base: 10, zone: -1, drops: [['dust', 1], ['fruit', 1]] },
  spider: { hp: 50, atk: 13, def: 4, base: 16, zone: -1, drops: [['silk', 2], ['meat', 1]] },
  lizard: { hp: 60, atk: 12, def: 7, base: 18, zone: -1, drops: [['scale', 1], ['meat', 2]] },
  ghost: { hp: 45, atk: 16, def: 3, base: 28, zone: -1, drops: [['ecto', 1]] },
  mimic: { hp: 100, atk: 15, def: 10, base: 32, zone: -1, drops: [['gem', 1], ['iron', 2]] },
  wyvern: { hp: 110, atk: 18, def: 8, base: 45, zone: -1, drops: [['wyvern', 1], ['meat', 3]] },
  drake: { hp: 150, atk: 20, def: 11, base: 55, zone: -1, drops: [['dragon', 1], ['meat', 3]] },
};
export const ZONE_MONSTERS = [0, 1, 2].map((z) => Object.keys(MONSTERS).filter((k) => MONSTERS[k].zone === z));

export const CLASSES = {
  warrior: { hp: 34, hpG: 9, atk: 5, atkG: 2, def: 3, defG: 1.2, range: 1, interval: 1.0 },
  archer: { hp: 26, hpG: 7, atk: 6, atkG: 2.3, def: 2, defG: 0.8, range: 3.2, interval: 1.1 },
  mage: { hp: 22, hpG: 6, atk: 8, atkG: 2.7, def: 1, defG: 0.7, range: 3.2, interval: 1.4 },
};

export interface EquipDef { key: string; tier: number; atk: number; def: number; hp: number; price: number; mat?: string }

const eq = (key: string, tier: number, atk: number, def: number, hp: number, price: number, mat?: string): EquipDef =>
  ({ key, tier, atk, def, hp, price, mat });

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
    eq('clothTunic', 1, 0, 2, 10, 30),
    eq('leatherArmor', 2, 0, 5, 25, 120),
    eq('chainmail', 3, 0, 9, 45, 400),
    eq('plateArmor', 4, 0, 15, 80, 1200),
    eq('crystalMail', 5, 0, 24, 130, 3500),
    eq('mythrilArmor', 6, 0, 36, 200, 9000),
    eq('runeArmor', 7, 0, 52, 300, 22000),
    eq('dragonMail', 8, 0, 75, 450, 60000),
  ],
  accessory: [
    eq('copperRing', 1, 1, 0, 5, 25),
    eq('wingCharm', 2, 2, 0, 15, 100),
    eq('fangNecklace', 3, 4, 0, 25, 350),
    eq('ironBracelet', 4, 7, 0, 40, 1000),
    eq('crystalPendant', 5, 11, 0, 70, 3000),
    eq('mythrilRing', 6, 16, 0, 110, 8000),
    eq('runeAmulet', 7, 24, 0, 170, 20000),
    eq('dragonHeart', 8, 36, 0, 260, 55000),
  ],
};
export const SHOP_TIER_LEVELS = [1, 3, 6, 12, 25, 50, 100, 200];
export const shopTier = (level: number) => SHOP_TIER_LEVELS.filter((l) => level >= l).length;
export const equipByKey = (key: string | null): EquipDef | undefined => {
  if (!key) return undefined;
  for (const list of Object.values(EQUIP)) for (const e of list) if (e.key === key) return e;
  return undefined;
};

export type Category = 'housing' | 'food' | 'shops' | 'leisure' | 'services' | 'decor';
export const CATEGORIES: Category[] = ['housing', 'food', 'shops', 'leisure', 'services', 'decor'];

export interface BuildingDef {
  size: 1 | 2; cost: Cost; attraction: number; price: number; kind: BKind; cat: Category;
  slot?: Slot; unique?: boolean; buildable?: boolean;
  // [from, to] time of day when the place is busiest; outside it visitors rarely come
  peak?: [number, number]; closed?: [number, number];
}

export const BUILDINGS: Record<string, BuildingDef> = {
  guild: { size: 2, cost: { money: 0 }, attraction: 3, price: 0, kind: 'guild', cat: 'services', unique: true, buildable: false },
  house: { size: 1, cost: { money: 500, wood: 10 }, attraction: 0, price: 0, kind: 'house', cat: 'housing' },
  breakfastShop: { size: 1, cost: { money: 900, wood: 10 }, attraction: 2, price: 8, kind: 'food', cat: 'food', peak: [0, 0.3], closed: [0.45, 1] },
  bakery: { size: 1, cost: { money: 1100, wood: 10, stone: 10 }, attraction: 2, price: 10, kind: 'food', cat: 'food', peak: [0, 0.4] },
  restaurant: { size: 2, cost: { money: 1250, wood: 20, stone: 5 }, attraction: 4, price: 14, kind: 'food', cat: 'food', peak: [0.35, 0.75] },
  weaponShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'weapon' },
  armorShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'armor' },
  accessoryShop: { size: 1, cost: { money: 1500, wood: 10, stone: 5 }, attraction: 3, price: 18, kind: 'shop', cat: 'shops', slot: 'accessory' },
  souvenirShop: { size: 1, cost: { money: 1800, wood: 20 }, attraction: 3, price: 24, kind: 'souvenir', cat: 'shops' },
  cafe: { size: 1, cost: { money: 1600, wood: 10, stone: 5 }, attraction: 4, price: 12, kind: 'fun', cat: 'leisure', peak: [0.15, 0.6] },
  teahouse: { size: 1, cost: { money: 2000, wood: 25 }, attraction: 4, price: 15, kind: 'fun', cat: 'leisure', peak: [0.3, 0.7] },
  tavern: { size: 2, cost: { money: 1750, wood: 25 }, attraction: 5, price: 12, kind: 'fun', cat: 'leisure', peak: [0.55, 1], closed: [0, 0.3] },
  bathhouse: { size: 2, cost: { money: 3750, wood: 20, stone: 25 }, attraction: 8, price: 20, kind: 'fun', cat: 'leisure', peak: [0.5, 0.8] },
  spa: { size: 2, cost: { money: 9000, wood: 60, stone: 120 }, attraction: 14, price: 38, kind: 'fun', cat: 'leisure', peak: [0.45, 0.85] },
  theater: { size: 2, cost: { money: 11000, wood: 120, stone: 80 }, attraction: 16, price: 32, kind: 'fun', cat: 'leisure', peak: [0.5, 0.85] },
  arena: { size: 2, cost: { money: 13000, stone: 200 }, attraction: 14, price: 26, kind: 'fun', cat: 'leisure', peak: [0.2, 0.7] },
  inn: { size: 2, cost: { money: 2250, wood: 30, stone: 10 }, attraction: 4, price: 35, kind: 'inn', cat: 'housing' },
  forge: { size: 2, cost: { money: 3000, wood: 10, stone: 30 }, attraction: 1, price: 0, kind: 'forge', cat: 'services', unique: true },
  clinic: { size: 2, cost: { money: 2500, wood: 20, stone: 10 }, attraction: 1, price: 20, kind: 'clinic', cat: 'services' },
  flowerbed: { size: 1, cost: { money: 150 }, attraction: 2, price: 0, kind: 'decor', cat: 'decor' },
  fountain: { size: 1, cost: { money: 1000, stone: 15 }, attraction: 6, price: 0, kind: 'decor', cat: 'decor' },
  statue: { size: 1, cost: { money: 2500, stone: 60 }, attraction: 9, price: 0, kind: 'decor', cat: 'decor' },
};
export const ROAD_COST = 10;

const inRange = (t: number, r?: [number, number]) => !!r && t >= r[0] && t < r[1];
export const isOpen = (type: string, t: number) => !inRange(t, BUILDINGS[type].closed);
export const isPeak = (type: string, t: number) => inRange(t, BUILDINGS[type].peak);

export interface ExpeditionDef { key: string; unlockYear: number; days: number; monsters: string[] }

export const EXPEDITIONS: ExpeditionDef[] = [
  { key: 'woods', unlockYear: 1, days: 6, monsters: ['treant', 'fairy'] },
  { key: 'mine', unlockYear: 3, days: 8, monsters: ['spider', 'lizard'] },
  { key: 'ruins', unlockYear: 6, days: 10, monsters: ['ghost', 'mimic'] },
  { key: 'ridge', unlockYear: 10, days: 12, monsters: ['wyvern', 'drake'] },
];
export const EXPEDITION_PARTY = 4;

export interface VillageMods {
  wood: number; stone: number; fruit: number; monsterRate: number; monsterLevel: number;
  hunger: number; drops: number; touristRate: number; touristSpend: number; forgeCost: number;
}
export type Ground = 'meadow' | 'rocky' | 'marsh' | 'snow' | 'sand';
export interface VillageDef { key: string; ground: Ground; mods: Partial<VillageMods> }

export const VILLAGES: VillageDef[] = [
  { key: 'maple', ground: 'meadow', mods: {} },
  { key: 'iron', ground: 'rocky', mods: { wood: 0.6, stone: 2, monsterLevel: 5, forgeCost: 0.7 } },
  { key: 'mist', ground: 'marsh', mods: { fruit: 2, monsterRate: 1.5, touristRate: 0.7 } },
  { key: 'frost', ground: 'snow', mods: { hunger: 1.5, drops: 1.5, monsterLevel: 10, touristRate: 0.8 } },
  { key: 'sun', ground: 'sand', mods: { wood: 0.3, fruit: 0.5, touristSpend: 1.5, touristRate: 1.3 } },
];
const DEFAULT_MODS: VillageMods = {
  wood: 1, stone: 1, fruit: 1, monsterRate: 1, monsterLevel: 0,
  hunger: 1, drops: 1, touristRate: 1, touristSpend: 1, forgeCost: 1,
};
export const villageDef = (key: string) => VILLAGES.find((v) => v.key === key) ?? VILLAGES[0];
export const villageMods = (key: string): VillageMods => ({ ...DEFAULT_MODS, ...villageDef(key).mods });
