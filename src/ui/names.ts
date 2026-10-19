import { t } from '../i18n';
import type { Monster } from '../game/types';

// a boss's display name: a champion or the final boss by its own name, others by title and kind
export const bossName = (m: Monster) => (m.champ ? t('champ.' + m.champ) : `${t('boss.' + m.boss)}${t('m.' + m.type)}`);
