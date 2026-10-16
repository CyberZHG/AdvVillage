import type { Ground } from './data';

export type Fam =
  | 'slime' | 'flyer' | 'bird' | 'beast' | 'boar' | 'bear' | 'humanoid' | 'golem' | 'spider' | 'scorpion'
  | 'beetle' | 'ghost' | 'wisp' | 'plant' | 'mushroom' | 'snake' | 'crab' | 'frog' | 'mimic' | 'dragon';

const FAM: Record<Fam, [number, number, number]> = {
  slime: [22, 4, 1], flyer: [16, 6, 1], bird: [20, 7, 1.5], beast: [38, 8, 3], boar: [46, 8, 4], bear: [60, 10, 5],
  humanoid: [40, 9, 3], golem: [90, 11, 8], spider: [40, 10, 3], scorpion: [44, 11, 5], beetle: [50, 8, 7],
  ghost: [40, 13, 2], wisp: [30, 14, 2], plant: [55, 9, 4], mushroom: [34, 7, 3], snake: [36, 10, 2.5],
  crab: [48, 7, 8], frog: [30, 7, 2], mimic: [90, 13, 9], dragon: [160, 20, 11],
};

export interface MonsterDef {
  fam: Fam; hp: number; atk: number; def: number; base: number;
  // 0..2 = map zone, -1 = expedition only
  zone: number; drops: [string, number][]; biomes?: Ground[];
}

type Row = [string, Fam, number, number, [string, number][], Ground[]?, number?];

// key, family, base level, zone, drops, biomes, strength multiplier
const ROWS: Row[] = [
  ['slime', 'slime', 1, 0, [['gel', 3], ['meat', 1]]],
  ['bat', 'flyer', 2, 0, [['wing', 2], ['meat', 1]]],
  ['rat', 'beast', 1, 0, [['meat', 2], ['fang', 1]], undefined, 0.7],
  ['bee', 'flyer', 3, 0, [['venom', 1], ['wing', 1]]],
  ['grassSnake', 'snake', 3, 0, [['meat', 1], ['venom', 1]], ['meadow', 'marsh', 'rocky']],
  ['shroom', 'mushroom', 2, 0, [['spore', 2]]],
  ['crow', 'bird', 2, 0, [['feather', 2]]],
  ['frog', 'frog', 3, 0, [['meat', 1], ['gel', 1]], ['meadow', 'marsh']],
  ['iceSlime', 'slime', 3, 0, [['gel', 2], ['frostShard', 1]], ['snow']],
  ['sandSlime', 'slime', 3, 0, [['gel', 2], ['stone', 1]], ['sand', 'rocky']],
  ['rockCrab', 'crab', 4, 0, [['shell', 2], ['meat', 1]], ['rocky', 'sand']],
  ['kobold', 'humanoid', 4, 0, [['cloth', 1], ['iron', 1]], undefined, 0.8],

  ['wolf', 'beast', 6, 1, [['meat', 2], ['pelt', 1], ['fang', 1]]],
  ['goblin', 'humanoid', 9, 1, [['cloth', 2], ['iron', 1]]],
  ['boar', 'boar', 8, 1, [['meat', 3], ['fang', 1]], ['meadow', 'rocky', 'marsh']],
  ['harpy', 'bird', 10, 1, [['feather', 2], ['meat', 1]]],
  ['venomSpider', 'spider', 11, 1, [['silk', 1], ['venom', 1]]],
  ['bandit', 'humanoid', 12, 1, [['cloth', 1], ['iron', 1]]],
  ['scorpion', 'scorpion', 12, 1, [['venom', 2], ['shell', 1]], ['sand']],
  ['snowWolf', 'beast', 10, 1, [['pelt', 2], ['fang', 1]], ['snow']],
  ['bogToad', 'frog', 12, 1, [['meat', 2], ['venom', 1]], ['marsh'], 1.3],
  ['manEater', 'plant', 13, 1, [['spore', 1], ['hardwood', 1]], ['meadow', 'marsh']],
  ['orc', 'humanoid', 14, 1, [['iron', 2], ['meat', 1]], undefined, 1.2],
  ['brownBear', 'bear', 13, 1, [['meat', 3], ['pelt', 2]], ['meadow', 'rocky', 'snow']],
  ['mudGolem', 'golem', 11, 1, [['stone', 2], ['gel', 1]], ['marsh', 'meadow'], 0.8],
  ['cactus', 'plant', 12, 1, [['spore', 1], ['fruit', 2]], ['sand']],
  ['foxSpirit', 'beast', 15, 1, [['pelt', 1], ['dust', 1]]],

  ['skeleton', 'humanoid', 16, 2, [['bone', 2], ['iron', 1]]],
  ['golem', 'golem', 22, 2, [['crystal', 1], ['stone', 2]]],
  ['zombie', 'humanoid', 18, 2, [['bone', 1], ['cloth', 1]], undefined, 1.1],
  ['orcWarlord', 'humanoid', 24, 2, [['iron', 2], ['horn', 1]], undefined, 1.3],
  ['direWolf', 'beast', 20, 2, [['pelt', 2], ['fang', 2]], undefined, 1.2],
  ['grizzly', 'bear', 24, 2, [['meat', 3], ['pelt', 2]], ['meadow', 'rocky', 'marsh']],
  ['wraith', 'ghost', 23, 2, [['ecto', 1]]],
  ['ironBeetle', 'beetle', 21, 2, [['iron', 2], ['shell', 1]], ['rocky', 'meadow']],
  ['yeti', 'bear', 25, 2, [['pelt', 2], ['frostShard', 1]], ['snow'], 1.2],
  ['sandWorm', 'snake', 24, 2, [['scale', 1], ['meat', 2]], ['sand'], 1.5],
  ['hydra', 'snake', 24, 2, [['scale', 1], ['venom', 1]], ['marsh'], 1.5],
  ['darkKnight', 'humanoid', 28, 2, [['iron', 2], ['bone', 1]], undefined, 1.4],
  ['gargoyle', 'golem', 26, 2, [['stone', 2], ['crystal', 1]], ['rocky', 'snow']],
  ['wisp', 'wisp', 22, 2, [['ecto', 1], ['dust', 1]]],

  ['treant', 'golem', 8, -1, [['hardwood', 2], ['fruit', 1]], undefined, 0.9],
  ['fairy', 'flyer', 10, -1, [['dust', 1], ['fruit', 1]], undefined, 1.8],
  ['pixie', 'wisp', 11, -1, [['dust', 1], ['feather', 1]]],
  ['bloomHorror', 'plant', 12, -1, [['spore', 2], ['fruit', 1]]],
  ['forestBear', 'bear', 13, -1, [['pelt', 2], ['meat', 2]]],
  ['elderStag', 'beast', 14, -1, [['horn', 2], ['meat', 2]], undefined, 1.2],

  ['spider', 'spider', 16, -1, [['silk', 2], ['meat', 1]]],
  ['lizard', 'beast', 18, -1, [['scale', 1], ['meat', 2]]],
  ['koboldMiner', 'humanoid', 17, -1, [['iron', 2], ['goldOre', 1]]],
  ['caveBat', 'flyer', 16, -1, [['wing', 2], ['meat', 1]], undefined, 1.6],
  ['ironGolem', 'golem', 22, -1, [['iron', 3], ['crystal', 1]], undefined, 1.1],
  ['crystalSpider', 'spider', 24, -1, [['crystal', 1], ['silk', 1]], undefined, 1.2],

  ['swampSlime', 'slime', 19, -1, [['gel', 3], ['venom', 1]], undefined, 1.8],
  ['lizardman', 'humanoid', 22, -1, [['scale', 1], ['iron', 1]]],
  ['swampSerpent', 'snake', 24, -1, [['scale', 1], ['venom', 1]], undefined, 1.3],
  ['marshHag', 'humanoid', 26, -1, [['spore', 2], ['ecto', 1]]],
  ['bloodMoss', 'plant', 25, -1, [['spore', 2], ['hardwood', 1]]],
  ['giantToad', 'frog', 21, -1, [['meat', 3], ['venom', 1]], undefined, 1.8],

  ['ghost', 'ghost', 28, -1, [['ecto', 1]]],
  ['mimic', 'mimic', 32, -1, [['gem', 1], ['iron', 2]]],
  ['mummy', 'humanoid', 30, -1, [['cloth', 2], ['bone', 1]], undefined, 1.2],
  ['sentinel', 'golem', 34, -1, [['stone', 3], ['crystal', 1]]],
  ['cursedArmor', 'humanoid', 36, -1, [['iron', 3], ['soulGem', 1]], undefined, 1.4],
  ['lich', 'humanoid', 40, -1, [['soulGem', 1], ['ecto', 1]], undefined, 1.3],

  ['sandScorpion', 'scorpion', 35, -1, [['venom', 2], ['shell', 1]]],
  ['scarab', 'beetle', 36, -1, [['shell', 2], ['goldOre', 1]]],
  ['cobra', 'snake', 40, -1, [['venom', 2], ['scale', 1]]],
  ['sandGolem', 'golem', 44, -1, [['stone', 3], ['goldOre', 1]]],
  ['mummyLord', 'humanoid', 42, -1, [['cloth', 2], ['soulGem', 1]], undefined, 1.5],
  ['sphinx', 'beast', 46, -1, [['goldOre', 2], ['horn', 1]], undefined, 1.6],

  ['frostWolf', 'beast', 50, -1, [['pelt', 2], ['frostShard', 1]]],
  ['iceGolem', 'golem', 52, -1, [['frostShard', 2], ['crystal', 1]]],
  ['snowHarpy', 'bird', 54, -1, [['feather', 2], ['frostShard', 1]], undefined, 1.4],
  ['iceWraith', 'ghost', 55, -1, [['ecto', 1], ['frostShard', 1]]],
  ['frostGiant', 'humanoid', 62, -1, [['frostShard', 2], ['iron', 2]], undefined, 1.8],
  ['iceDrake', 'dragon', 68, -1, [['dragon', 1], ['frostShard', 2]], undefined, 0.8],

  ['magmaSlime', 'slime', 70, -1, [['emberCore', 1], ['gel', 2]], undefined, 2],
  ['fireImp', 'humanoid', 72, -1, [['emberCore', 1], ['horn', 1]]],
  ['salamander', 'beast', 75, -1, [['scale', 2], ['emberCore', 1]]],
  ['lavaGolem', 'golem', 80, -1, [['emberCore', 2], ['stone', 3]]],
  ['hellhound', 'beast', 85, -1, [['fang', 2], ['emberCore', 1]], undefined, 1.3],
  ['phoenix', 'bird', 90, -1, [['feather', 3], ['emberCore', 2]], undefined, 1.8],

  ['thunderBird', 'bird', 95, -1, [['feather', 3], ['starDust', 1]], undefined, 1.5],
  ['cloudSlime', 'slime', 96, -1, [['gel', 3], ['starDust', 1]], undefined, 2.2],
  ['skyWisp', 'wisp', 100, -1, [['starDust', 2]]],
  ['griffin', 'beast', 105, -1, [['feather', 2], ['horn', 1]], undefined, 1.5],
  ['stormSpirit', 'wisp', 110, -1, [['starDust', 2], ['crystal', 1]], undefined, 1.3],
  ['sentry', 'humanoid', 115, -1, [['mithril', 1], ['soulGem', 1]], undefined, 1.5],

  ['wyvern', 'flyer', 110, -1, [['wyvern', 1], ['meat', 3]], undefined, 4],
  ['drake', 'beast', 115, -1, [['dragon', 1], ['meat', 3]], undefined, 1.8],
  ['greenDragon', 'dragon', 122, -1, [['dragon', 2], ['venom', 2]]],
  ['redDragon', 'dragon', 125, -1, [['dragon', 2], ['emberCore', 1]]],
  ['blackDragon', 'dragon', 135, -1, [['dragon', 2], ['soulGem', 1]], undefined, 1.1],

  ['demon', 'humanoid', 140, -1, [['soulGem', 2], ['horn', 1]], undefined, 1.6],
  ['shadowBeast', 'beast', 145, -1, [['pelt', 3], ['soulGem', 1]], undefined, 1.6],
  ['voidSlime', 'slime', 150, -1, [['starDust', 1], ['soulGem', 1]], undefined, 2.5],
  ['eldritchEye', 'wisp', 160, -1, [['soulGem', 2], ['starDust', 1]], undefined, 1.4],
  ['boneDragon', 'dragon', 170, -1, [['dragon', 3], ['bone', 5]], undefined, 1.1],
  ['abyssLord', 'humanoid', 190, -1, [['soulGem', 3], ['mithril', 2]], undefined, 2.2],
];

// every family has a signature material and a rare find on top of each monster's own drops
const FAM_DROPS: Record<Fam, [string, number][]> = {
  slime: [['slimeCore', 0.25]], flyer: [['honey', 0.6]], bird: [['egg', 1], ['feather', 0.5]], beast: [['claw', 0.8]],
  boar: [['tusk', 1]], bear: [['claw', 1], ['honey', 0.5]], humanoid: [['oldCoin', 0.3]], golem: [['golemCore', 0.25]],
  spider: [['venom', 0.6]], scorpion: [['stinger', 1]], beetle: [['amber', 0.3]], ghost: [['moonstone', 0.15]],
  wisp: [['wispLight', 0.6]], plant: [['herb', 1.2]], mushroom: [['herb', 0.8], ['truffle', 0.15]], snake: [['snakeskin', 1]],
  crab: [['pearl', 0.2]], frog: [['herb', 0.6]], mimic: [['oldCoin', 2], ['pearl', 0.5]], dragon: [['dragonFang', 0.4]],
};
// per-monster finds for the ones whose look calls for something specific
const EXTRA: Record<string, [string, number][]> = {
  bee: [['honey', 2]], koboldMiner: [['silverOre', 1.5]], ironGolem: [['silverOre', 1]], sandGolem: [['amber', 0.5]],
  gargoyle: [['moonstone', 0.15]], lich: [['moonstone', 0.4]], iceWraith: [['moonstone', 0.3]], scarab: [['amber', 0.6]],
  bandit: [['oldCoin', 0.8]], goblin: [['oldCoin', 0.4]], darkKnight: [['silverOre', 0.6]], cursedArmor: [['silverOre', 1]],
  voidSlime: [['voidShard', 0.5]], eldritchEye: [['voidShard', 0.6]], abyssLord: [['voidShard', 1]], demon: [['voidShard', 0.3]],
  shadowBeast: [['voidShard', 0.3]], sentry: [['silverOre', 1]], fairy: [['honey', 1]], pixie: [['honey', 0.5]],
  kobold: [['silverOre', 0.2]], orc: [['silverOre', 0.3]], treant: [['amber', 0.8]], manEater: [['amber', 0.2]],
  frog: [['pearl', 0.1]], bogToad: [['pearl', 0.15]], giantToad: [['pearl', 0.3]], hydra: [['pearl', 0.3]],
};

export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries(ROWS.map(([key, fam, base, zone, drops, biomes, mult]) => {
  const [hp, atk, def] = FAM[fam];
  const k = mult ?? 1;
  const all = [...drops];
  for (const [item, w] of [...FAM_DROPS[fam], ...(EXTRA[key] ?? [])]) {
    const have = all.find((d) => d[0] === item);
    if (have) have[1] += w; else all.push([item, w]);
  }
  return [key, { fam, hp: Math.round(hp * k), atk: atk * Math.sqrt(k), def: def * Math.sqrt(k), base, zone, drops: all, biomes }];
}));

// expedition natives also roam the map, rarely, in the ring that matches their strength
export const RARE_WEIGHT = 1 / 30;
export const mapZone = (d: MonsterDef) => (d.zone >= 0 ? d.zone : d.base < 10 ? 0 : d.base < 25 ? 1 : 2);
export const spawnWeight = (d: MonsterDef) => (d.zone >= 0 ? 1 : RARE_WEIGHT);

export const zoneMonsters = (zone: number, ground: Ground) =>
  Object.keys(MONSTERS).filter((k) => mapZone(MONSTERS[k]) === zone && (!MONSTERS[k].biomes || MONSTERS[k].biomes!.includes(ground)));
