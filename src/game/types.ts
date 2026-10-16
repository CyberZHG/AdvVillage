import type { NodeKind } from './data';

export interface P { x: number; y: number }
export interface Building { id: number; type: string; x: number; y: number; rot: number; level: number; exp: number }
export interface ResNode { id: number; kind: NodeKind; x: number; y: number; amount: number; v: number }
export interface Monster {
  id: number; type: string; x: number; y: number; hp: number; tx: number; ty: number;
  target: number | null; cd: number; facing: 1 | -1; zone: number; wait: number;
}

export type Role = 'fighter' | 'gatherer' | 'civilian' | 'tourist';
export type Cls = 'warrior' | 'archer' | 'mage';
export type NState = 'idle' | 'walk' | 'inside' | 'hunt' | 'fight' | 'gather' | 'down' | 'carried' | 'away' | 'wait';
export type Goal =
  | 'eat' | 'shop' | 'forge' | 'fun' | 'rest' | 'sleep' | 'deposit' | 'quest' | 'expedition' | 'expWait'
  | 'exitExp' | 'patrol' | 'camp' | 'homeStay' | 'gatherNode' | 'rescue' | 'dropoff' | 'visit' | 'leave';

export interface Look { skin: number; hair: number; cloth: number; pants: number }

export interface Npc {
  id: number; role: Role; cls: Cls; name: number; look: Look;
  level: number; exp: number; hp: number; hunger: number; mood: number; money: number;
  home: number | null; x: number; y: number; path: P[]; state: NState; goal: Goal | null; goalId: number;
  inside: number | null; timer: number; cd: number; facing: 1 | -1;
  weapon: string | null; armor: string | null; accessory: string | null;
  bag: Record<string, number>; quest: number | null;
  carry: number | null; rescuer: number | null; downT: number; repath: number;
  profile: number; plan: number[]; noFood: number; kills: number;
}

export interface Profile { name: number; look: Look; level: number; exp: number; visits: number }
export interface Quest { id: number; type: string; need: number; done: number; reward: number; until: number; members: number[] }
export interface Expedition {
  loc: string; state: 'recruit' | 'depart' | 'away'; members: number[]; until: number;
  wins: number; losses: number; loot: Record<string, number>; nextDay: number;
}
export type LogParam = string | number;
export interface LogEntry { t: number; k: string; p?: Record<string, LogParam> }
export interface Fx { kind: 'coin' | 'dmg' | 'lvl' | 'item' | 'score'; x: number; y: number; v: string | number }
export interface Score { npcs: number; buildings: number; npcLevels: number; bldLevels: number; fame: number; total: number; rank: string }

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
  stats: { income: number; lastIncome: number; kills: number; tourists: number };
  fx: Fx[];
}
