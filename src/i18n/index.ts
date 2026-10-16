import en from './en';
import zh from './zh';
import ja from './ja';
import ko from './ko';

export interface LangPack {
  label: string;
  dict: Record<string, string>;
  name: (i: number) => string;
  num?: (n: number) => string;
}

// add a language by creating a pack file and registering it here
export const LANGS: Record<string, LangPack> = { en, zh, ja, ko };

let current = 'en';

export const getLang = () => current;
export function setLang(l: string) {
  if (LANGS[l]) current = l;
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
  document.title = t('game.title');
}

export function detectLang(saved?: string): string {
  if (saved && LANGS[saved]) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  for (const l of Object.keys(LANGS)) if (nav.startsWith(l)) return l;
  return 'en';
}

export const npcName = (i: number) => LANGS[current].name(i);

export function fmt(n: number): string {
  const pack = LANGS[current];
  if (pack.num) return pack.num(n);
  n = Math.floor(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString('en-US');
}

function param(v: unknown): string {
  if (typeof v === 'number') return fmt(v);
  if (typeof v === 'string' && v.startsWith('@name:')) return npcName(Number(v.slice(6)));
  if (typeof v === 'string' && v.startsWith('@')) return t(v.slice(1));
  return String(v ?? '');
}

export function t(key: string, params?: Record<string, unknown>): string {
  let s = LANGS[current].dict[key] ?? LANGS.en.dict[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => param(params[k]));
  return s;
}
