import type { ClassKey, NodeKind } from './data';

export interface P { x: number; y: number }
export interface Building { id: number; type: string; x: number; y: number; rot: number; level: number; exp: number; yi?: number; door?: P | null }
export interface ResNode { id: number; kind: NodeKind; x: number; y: number; amount: number; v: number }
export interface Monster {
  id: number; type: string; x: number; y: number; hp: number; tx: number; ty: number;
  target: number | null; cd: number; facing: 1 | -1; zone: number; wait: number;
  boss?: number; lv?: number; shiny?: boolean; until?: number;
}

export type Role = 'fighter' | 'gatherer' | 'civilian' | 'tourist';
export type Cls = ClassKey;
export type NState = 'idle' | 'walk' | 'inside' | 'hunt' | 'fight' | 'gather' | 'down' | 'carried' | 'away' | 'wait';
export type Goal =
  | 'eat' | 'shop' | 'forge' | 'fun' | 'rest' | 'sleep' | 'deposit' | 'quest' | 'expedition' | 'expWait'
  | 'exitExp' | 'patrol' | 'camp' | 'homeStay' | 'gatherNode' | 'rescue' | 'dropoff' | 'visit' | 'leave';

export interface Look {
  skin: number; hair: number; style: number; cloth: number; cloth2: number; pants: number;
  outfit: string; head: string; beard: string; item: string;
}

export interface Npc {
  id: number; role: Role; cls: Cls; job: string; name: number; look: Look;
  level: number; exp: number; hp: number; hunger: number; mood: number; money: number;
  home: number | null; x: number; y: number; path: P[]; state: NState; goal: Goal | null; goalId: number;
  inside: number | null; timer: number; cd: number; facing: 1 | -1;
  weapon: string | null; armor: string | null; accessory: string | null;
  bag: Record<string, number>; quest: number | null;
  carry: number | null; rescuer: number | null; downT: number; repath: number;
  profile: number; plan: number[]; noFood: number; kills: number;
  title?: string; titles?: string[]; fk?: Record<string, number>; partner?: number | null; spouse?: number | null;
  downs?: number; yk?: number; exps?: number; bosses?: number;
}

export interface Profile { name: number; job: string; look: Look; level: number; exp: number; visits: number }
export interface Quest { id: number; type: string; need: number; done: number; reward: number; until: number; members: number[] }
export interface Expedition {
  loc: string; state: 'recruit' | 'depart' | 'away'; members: number[]; until: number;
  wins: number; losses: number; loot: Record<string, number>; nextDay: number;
}
export type LogParam = string | number;
export interface LogEntry { t: number; k: string; p?: Record<string, LogParam> }
export interface Fx { kind: 'coin' | 'dmg' | 'lvl' | 'item' | 'score' | 'emote'; x: number; y: number; v: string | number }
export interface Score { npcs: number; buildings: number; npcLevels: number; bldLevels: number; fame: number; total: number; rank: string }

export interface Effect { k: string; until: number }
export interface Offer { item: string; count: number; price: number; sold?: boolean }
export interface Couple { a: number; b: number; since: number; kids: number }
export interface YearStats { income: number; kills: number; tourists: number; quests: number; expeditions: number; bosses: number; shinies: number; events: LogEntry[] }
export interface Report {
  year: number; income: number; kills: number; tourists: number; quests: number; expeditions: number; bosses: number;
  residents: number; buildings: number; star?: { name: number; cls: string; kills: number; level: number };
  shop?: { type: string; income: number }; events: LogEntry[];
}

export interface GameState {
  v: number; village: string; vlv: number; roads: number[]; time: number; day: number; money: number;
  items: Record<string, number>;
  buildings: Building[]; nodes: ResNode[]; monsters: Monster[]; npcs: Npc[]; profiles: Profile[];
  quests: Quest[]; exp: Expedition | null;
  mlv: Record<string, { level: number; exp: number }>;
  wlv: Record<string, number>;
  disc: string[]; seen: string[];
  nextId: number; log: LogEntry[]; scored: boolean; score: Score | null;
  timers: { spawn: number; node: number; rescue: number };
  comboSeen: string[]; weather: string; effects: Effect[]; bonds: Record<string, number>; couples: Couple[];
  reports: Report[]; ys: YearStats; shinySeen: string[]; merchant: { until: number; offers: Offer[] } | null; nextBoss: number;
  stats: {
    income: number; lastIncome: number; kills: number; tourists: number;
    quests: number; rescues: number; expeditions: number; expLocs: string[];
  };
  fx: Fx[];
}
