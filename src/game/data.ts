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
  venom: { value: 6 }, spore: { value: 4 }, feather: { value: 5 }, shell: { value: 10 }, horn: { value: 18 },
  frostShard: { value: 30 }, goldOre: { value: 40 }, soulGem: { value: 80 }, emberCore: { value: 55 },
  starDust: { value: 70 }, mithril: { value: 120 },
  honey: { value: 6 }, egg: { value: 5 }, herb: { value: 5 }, slimeCore: { value: 15 }, claw: { value: 12 },
  tusk: { value: 16 }, snakeskin: { value: 14 }, stinger: { value: 20 }, oldCoin: { value: 25 }, silverOre: { value: 28 },
  amber: { value: 30 }, wispLight: { value: 35 }, truffle: { value: 40 }, golemCore: { value: 45 }, pearl: { value: 50 },
  moonstone: { value: 65 }, dragonFang: { value: 110 }, voidShard: { value: 150 },
};
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
export const CIVILIAN_JOBS = ['farmer', 'merchant', 'elder', 'craftsman', 'maid', 'scholar'] as const;
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

export type Category = 'housing' | 'food' | 'shops' | 'leisure' | 'services' | 'decor';
export const CATEGORIES: Category[] = ['housing', 'food', 'shops', 'leisure', 'services', 'decor'];

export interface BuildingDef {
  size: 1 | 2; cost: Cost; attraction: number; price: number; kind: BKind; cat: Category;
  slot?: Slot; unique?: boolean; buildable?: boolean;
  // specialty goods: a sale uses one of these from storage, in order, and adds twice its value to the price
  goods?: string[];
  // [from, to] time of day when the place is busiest; outside it visitors rarely come
  peak?: [number, number]; closed?: [number, number];
}

export const BUILDINGS: Record<string, BuildingDef> = {
  guild: { size: 2, cost: { money: 0 }, attraction: 3, price: 0, kind: 'guild', cat: 'services', unique: true, buildable: false },
  house: { size: 1, cost: { money: 500, wood: 10 }, attraction: 0, price: 0, kind: 'house', cat: 'housing' },
  breakfastShop: { size: 1, cost: { money: 900, wood: 10 }, attraction: 2, price: 8, kind: 'food', cat: 'food', peak: [0, 0.3], closed: [0.45, 1], goods: ['egg', 'honey'] },
  bakery: { size: 1, cost: { money: 1100, wood: 10, stone: 10 }, attraction: 2, price: 10, kind: 'food', cat: 'food', peak: [0, 0.4], goods: ['honey', 'egg'] },
  restaurant: { size: 2, cost: { money: 1250, wood: 20, stone: 5 }, attraction: 4, price: 14, kind: 'food', cat: 'food', peak: [0.35, 0.75], goods: ['truffle', 'egg', 'herb'] },
  weaponShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'weapon' },
  armorShop: { size: 2, cost: { money: 2000, wood: 15, stone: 15 }, attraction: 2, price: 22, kind: 'shop', cat: 'shops', slot: 'armor' },
  accessoryShop: { size: 1, cost: { money: 1500, wood: 10, stone: 5 }, attraction: 3, price: 18, kind: 'shop', cat: 'shops', slot: 'accessory', goods: ['oldCoin', 'moonstone'] },
  souvenirShop: { size: 1, cost: { money: 1800, wood: 20 }, attraction: 3, price: 24, kind: 'souvenir', cat: 'shops', goods: ['pearl', 'amber', 'feather', 'shell', 'horn'] },
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
};
// decorations also lift the takings of businesses that stand near them
export const DECOR_RADIUS = 3;
export const DECOR_STEP = 0.03;
export const DECOR_MAX = 0.3;
export const ROAD_COST = 10;

const inRange = (t: number, r?: [number, number]) => !!r && t >= r[0] && t < r[1];
export const isOpen = (type: string, t: number) => !inRange(t, BUILDINGS[type].closed);
export const isPeak = (type: string, t: number) => inRange(t, BUILDINGS[type].peak);

export interface ExpeditionDef { key: string; unlockYear: number; days: number; monsters: string[] }

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
