/**
 * Number / time formatting, ported 1:1 from com.dchoc.dollars.utils.text.TextManager
 * (convertNumberToString, convertTimeToString, getStringFromTime, ...). Delimiters/unit names come from the locale
 * (TID_POINTS_DELIMITER, TID_DECIMAL_DELIMETER, TID_TIME_UNIT_*), so en_US gives "100,000" and "1 Hour 5 Mins".
 */
import { getText, t } from './i18n';

export const TRUNCATE_NONE = 0;
export const TRUNCATE_THOUSAND = 1;
export const TRUNCATE_MILLIONS = 2;

const int = Math.trunc;

function pointsDelimiter(): string {
  const d = getText('TID_POINTS_DELIMITER');
  if (d === '<space>') return '';
  return d === 'TID_POINTS_DELIMITER' ? ',' : d; // locale not loaded: en default
}
function decimalDelimiter(): string {
  const d = getText('TID_DECIMAL_DELIMETER');
  return d === 'TID_DECIMAL_DELIMETER' ? '.' : d;
}

/**
 * Coins/numbers with thousands separators. `truncate` TRUNCATE_THOUSAND -> K/M suffix, TRUNCATE_MILLIONS -> M suffix,
 * applied when the integer part has more than `maxDigits` digits. Values < 10 with a fraction keep 2 decimals.
 */
export function convertNumberToString(value: number, truncate = 0, maxDigits = 0): string {
  let suffix = '';
  const len = value.toFixed(0).length;
  if (truncate === TRUNCATE_THOUSAND && len > maxDigits) {
    value /= 1000;
    suffix = 'K';
    if (value >= 1000) {
      value /= 1000;
      suffix = 'M';
    }
  }
  if (truncate === TRUNCATE_MILLIONS && len > maxDigits) {
    value /= 1000000;
    suffix = 'M';
  }
  if (value === 0) return '0';
  const fixed = value < 10 && value !== int(value) ? value.toFixed(2) : value.toFixed(0);
  const delim = pointsDelimiter();
  let out = '';
  let n = 0;
  for (let i = fixed.length - 1; i >= 0; i--) {
    const ch = fixed.charAt(i);
    if (ch === '.') out = decimalDelimiter() + out;
    else {
      if (++n === 4) {
        n = 1;
        out = delim + out;
      }
      out = ch + out;
    }
  }
  return out + suffix;
}

/** Currency-prefixed coin amount, e.g. "$100,000" (TID_COIN_SYMBOL + convertNumberToString). */
export function coins(value: number, truncate = 0, maxDigits = 0): string {
  return getText('TID_COIN_SYMBOL') + convertNumberToString(value, truncate, maxDigits);
}

/** TextManager.convertNumberRanking: 1234567 -> "1.23M", 12345 -> "12K", < 10000 untouched with separators. */
export function convertNumberRanking(value: number): string {
  let s = '';
  let suffix = '';
  const len = value.toFixed(0).length;
  if (len > 4) {
    value /= 1000;
    suffix = 'K';
    s = value.toFixed(0);
    value = int(Number(s));
    if (value >= 1000) {
      value /= 1000;
      if (value < 10) {
        value *= 100;
        s = value.toFixed(0);
        value = int(Number(s));
        value /= 100;
        s = value.toFixed(2);
        if (s.slice(-2) === '00') s = s.substring(0, 1);
      } else if (value < 100) {
        s = value.toFixed(1);
        if (s.slice(-1) === '0') s = s.substring(0, 2);
      } else s = String(int(value));
      suffix = 'M';
    }
    s = s.replace(/\./g, decimalDelimiter());
  }
  let res = s;
  if (value < 1000 && suffix === '') res = String(Math.round(value)); // original returns '' here
  if (value >= 1000) {
    s = value === 0 ? '0' : Math.round(value).toFixed(0);
    res = '';
    const delim = pointsDelimiter();
    let c = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      c++;
      if (c === 4) {
        c = 1;
        res = delim + res;
      }
      res = s.charAt(i) + res;
    }
  }
  return res + suffix;
}

function totalSeconds(ms: number): number {
  let s = int(ms / 1000);
  if (ms % 1000 > 0) s++;
  return s;
}

const unit = (id: string) => getText(id);

/** convertTimeToString(ms, withSeconds, withHoursOnDays): "1 Hour 5 Mins", "2 Days", "5 Mins 3 Secs". */
export function convertTimeToString(ms: number, withSeconds: boolean, daysAndHours = false): string {
  const DAY = 86400;
  let secs = totalSeconds(ms);
  if (secs >= DAY) {
    const days = int(secs / DAY);
    let out = `${days} ${days === 1 ? unit('TID_TIME_UNIT_DAY') : unit('TID_TIME_UNIT_DAYS')}`;
    if (daysAndHours) {
      secs -= DAY * days;
      const h = int(secs / 3600);
      if (h > 0) out += ` ${h} ${h === 1 ? unit('TID_TIME_UNIT_HOUR') : unit('TID_TIME_UNIT_HOURS')}`;
    }
    return out;
  }
  let mins = int(secs / 60);
  secs %= 60;
  const hours = int(mins / 60);
  mins %= 60;
  const hoursStr = () => `${hours} ${hours === 1 ? unit('TID_TIME_UNIT_HOUR') : unit('TID_TIME_UNIT_HOURS')}`;
  if (withSeconds) {
    if (hours > 0) return mins === 0 ? hoursStr() : `${hoursStr()} ${mins} ${unit('TID_TIME_UNIT_MINUTES')}`;
    if (secs === 0) return `${mins} ${unit('TID_TIME_UNIT_MINUTES')}`;
    if (mins === 0) return `${secs} ${unit('TID_TIME_UNIT_SECONDS')}`;
    return `${mins} ${unit('TID_TIME_UNIT_MINUTES')} ${secs} ${unit('TID_TIME_UNIT_SECONDS')}`;
  }
  if (hours > 0) return mins === 0 ? hoursStr() : `${hoursStr()} ${mins} ${unit('TID_TIME_UNIT_MINUTES')}`;
  return `${mins} ${unit('TID_TIME_UNIT_MINUTES')} ${secs} ${unit('TID_TIME_UNIT_SECONDS')}`;
}

/** getTimeUnits: coarse "05 Hours" / "3 Days". */
export function getTimeUnits(ms: number): string {
  const secs = totalSeconds(ms);
  if (secs >= 86400) return `${int(secs / 86400)} ${unit('TID_TIME_UNIT_DAYS')}`;
  const h = int(int(secs / 60) / 60);
  return `${h < 10 ? '0' : ''}${h} ${unit('TID_TIME_UNIT_HOURS')}`;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** getStringFromTime: "01d 02h 03m 04s" with leading zero-units dropped. */
export function getStringFromTime(ms: number): string {
  let secs = totalSeconds(ms);
  let mins = int(secs / 60);
  secs %= 60;
  let hours = int(mins / 60);
  const days = int(hours / 24);
  const d = days < 1 ? '' : `${pad2(days)}d `;
  hours %= 24;
  const h = hours < 1 && days < 1 ? '' : `${pad2(hours)}h `;
  mins %= 60;
  const m = mins < 1 && hours < 1 && days < 1 ? '' : `${pad2(mins)}m `;
  return `${d}${h}${m}${pad2(secs)}s`;
}

/** convertTimeToStringCollon: "hh:mm:ss". */
export function convertTimeToStringCollon(ms: number): string {
  let secs = totalSeconds(ms);
  let mins = int(secs / 60);
  secs %= 60;
  const hours = int(mins / 60);
  mins %= 60;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
}

/** getStringTimeOffer: "<n> <unit> left" via TID_ITEMS_LEFT. */
export function getStringTimeOffer(ms: number): string {
  const secs = totalSeconds(ms);
  let mins = int(secs / 60);
  let hours = int(mins / 60);
  const days = int(hours / 24);
  if (days > 0) return t('TID_ITEMS_LEFT', [`${days} ${days > 1 ? unit('TID_TIME_UNIT_DAYS') : unit('TID_TIME_UNIT_DAY')}`]);
  hours %= 24;
  if (hours > 0) return t('TID_ITEMS_LEFT', [`${hours} ${hours > 1 ? unit('TID_TIME_UNIT_HOURS') : unit('TID_TIME_UNIT_HOUR')}`]);
  mins %= 60;
  if (mins === 0) mins = 1;
  return t('TID_ITEMS_LEFT', [`${mins} ${unit('TID_TIME_UNIT_MINUTES')}`]);
}

/** "+12%" using TID_GEN_PERCENTAGE. */
export function getPercentageText(value: number, withSign = true): string {
  const n = convertNumberToString(Math.abs(value), 0, 0);
  const sign = withSign ? (value > 0 ? '+' : value < 0 ? '-' : '') : '';
  return sign + t('TID_GEN_PERCENTAGE', [n]);
}

const TIME_TABLE: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, z: 1 };
/** convertStringToTime("30m") -> ms; bare digits are ms. */
export function convertStringToTime(s: string): number {
  const last = s.slice(-1);
  const bare = last >= '0' && last <= '9';
  const n = parseInt(bare ? s : s.slice(0, -1), 10) || 0;
  return n * (TIME_TABLE[bare ? 'z' : last] ?? 0);
}
