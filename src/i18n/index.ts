import en from './en';
import zh from './zh';

export interface LangPack {
  label: string;
  dict: Record<string, string>;
  names: string[];
  num?: (n: number) => string;
}

// add a language by creating a pack file and registering it here
export const LANGS: Record<string, LangPack> = { en, zh };

let current = 'en';

export const getLang = () => current;
export function setLang(l: string) {
  if (LANGS[l]) current = l;
  document.documentElement.lang = l;
}

export function detectLang(saved?: string): string {
  if (saved && LANGS[saved]) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

export function npcName(i: number): string {
  const names = LANGS[current].names;
  const base = names[i % names.length];
  const gen = Math.floor(i / names.length);
  return gen ? `${base} ${['', 'II', 'III', 'IV', 'V'][gen] ?? gen + 1}` : base;
}

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
