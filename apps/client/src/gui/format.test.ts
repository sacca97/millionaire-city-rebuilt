import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  convertNumberRanking,
  convertNumberToString,
  convertStringToTime,
  convertTimeToString,
  convertTimeToStringCollon,
  getStringFromTime,
  getTimeUnits,
  coins,
  TRUNCATE_MILLIONS,
  TRUNCATE_THOUSAND,
} from './format';
import { setLocale, t, getText, parseColorSpans, replaceParams, tidIndex } from './i18n';
import { fontSpecFor, fontCss } from './fontmap';
import { TID } from './tids';

const EN = fileURLToPath(new URL('../../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Locale/EN.txt', import.meta.url));
const haveEn = existsSync(EN);

beforeAll(() => {
  if (haveEn) setLocale(readFileSync(EN, 'utf8'));
  else {
    const l: string[] = [];
    l[TID.TID_POINTS_DELIMITER] = ',';
    l[TID.TID_DECIMAL_DELIMETER] = '.';
    l[TID.TID_COIN_SYMBOL] = '$';
    l[TID.TID_TIME_UNIT_DAYS] = 'Days';
    l[TID.TID_TIME_UNIT_DAY] = 'Day';
    l[TID.TID_TIME_UNIT_HOURS] = 'Hours';
    l[TID.TID_TIME_UNIT_HOUR] = 'Hour';
    l[TID.TID_TIME_UNIT_MINUTES] = 'Mins';
    l[TID.TID_TIME_UNIT_SECONDS] = 'Secs';
    setLocale(l);
  }
});

describe('convertNumberToString', () => {
  it('groups thousands', () => {
    expect(convertNumberToString(0)).toBe('0');
    expect(convertNumberToString(999)).toBe('999');
    expect(convertNumberToString(1000)).toBe('1,000');
    expect(convertNumberToString(100000)).toBe('100,000');
    expect(convertNumberToString(1234567)).toBe('1,234,567');
  });
  it('keeps 2 decimals below 10', () => {
    expect(convertNumberToString(2.5)).toBe('2.50');
    expect(convertNumberToString(12.5)).toBe('13');
  });
  it('truncates with K/M', () => {
    expect(convertNumberToString(12345, TRUNCATE_THOUSAND, 4)).toBe('12K');
    expect(convertNumberToString(5000000, TRUNCATE_THOUSAND, 4)).toBe('5M');
    expect(convertNumberToString(5000000000, TRUNCATE_THOUSAND, 4)).toBe('5,000M');
    expect(convertNumberToString(12345678, TRUNCATE_MILLIONS, 6)).toBe('12M');
    expect(convertNumberToString(12345678, TRUNCATE_MILLIONS, 8)).toBe('12,345,678');
    expect(convertNumberToString(1234, TRUNCATE_THOUSAND, 4)).toBe('1,234');
  });
  it('coin prefix', () => expect(coins(2500)).toBe('$2,500'));
});

describe('ranking', () => {
  it('abbreviates', () => {
    expect(convertNumberRanking(950)).toBe('950');
    expect(convertNumberRanking(1234)).toBe('1,234');
    expect(convertNumberRanking(12345)).toBe('12K');
    expect(convertNumberRanking(1500000)).toBe('1.50M');
  });
});

describe('time', () => {
  const MIN = 60000;
  const H = 60 * MIN;
  it('convertTimeToString', () => {
    expect(convertTimeToString(2 * H + 3 * MIN, false)).toBe('2 Hours 3 Mins');
    expect(convertTimeToString(H, false)).toBe('1 Hour');
    expect(convertTimeToString(5 * MIN + 3000, true)).toBe('5 Mins 3 Secs');
    expect(convertTimeToString(2 * 86400000, false)).toBe('2 Days');
    expect(convertTimeToString(86400000 + 3 * H, true, true)).toBe('1 Day 3 Hours');
  });
  it('rounds partial seconds up', () => expect(convertTimeToStringCollon(1001)).toBe('00:00:02'));
  it('getStringFromTime', () => {
    expect(getStringFromTime(45 * 1000)).toBe('45s');
    expect(getStringFromTime(5 * MIN + 7000)).toBe('05m 07s');
    expect(getStringFromTime(26 * H + MIN)).toBe('01d 02h 01m 00s');
  });
  it('getTimeUnits / parse', () => {
    expect(getTimeUnits(5 * H)).toBe('05 Hours');
    expect(convertStringToTime('30m')).toBe(30 * MIN);
    expect(convertStringToTime('2h')).toBe(2 * H);
    expect(convertStringToTime('500')).toBe(500);
  });
});

describe('i18n', () => {
  it('replaces %U params like TextManager', () => {
    expect(replaceParams('a %U b %U1 c', ['X', 'Y'])).toBe('a X b Y c');
    expect(replaceParams('%U1 %U', ['A', 'B'])).toBe('B A');
  });
  it('colour spans', () => {
    expect(parseColorSpans('need {0x009932}5{/} more')).toEqual([
      { text: 'need ' },
      { text: '5', color: '#009932' },
      { text: ' more' },
    ]);
  });
  it('tid lookup by name', () => {
    expect(tidIndex('TID_COIN_SYMBOL')).toBe(795);
    expect(tidIndex('COIN_SYMBOL')).toBe(795);
    expect(tidIndex('nope')).toBe(-1);
  });
  it.runIf(haveEn)('en_US texts', () => {
    expect(getText('TID_BUY_FOR')).toBe('Buy For:');
    expect(t('TID_NOT_ENOUGH_CASH', ['5', '$2,500'])).toContain('exchange {0xFF6600}5{/}');
  });
});

describe('fontmap', () => {
  it('maps embedded faces', () => {
    // the extracted original fonts first, the stand-in webfonts as fallback
    expect(fontSpecFor('Challenge Bold LET').family).toContain('MC Challenge Bold LET');
    expect(fontSpecFor('Challenge Bold LET').family).toContain('Lilita One');
    expect(fontSpecFor('Challenge Bold LET').style).toBe('normal');
    expect(fontSpecFor('HelveticaRounded LT Std Bd').family).toContain('MC Helvetica Rounded Bd');
    expect(fontSpecFor('HelveticaRounded LT Std Blk').family).toContain('MC Helvetica Rounded Bd');
    expect(fontSpecFor('Helvetica Rounded LT Std Bold Condensed').family).toContain('Nunito');
    expect(fontSpecFor('Arial', true).weight).toBe(700);
    expect(fontSpecFor('').family).toContain('Arial');
  });
  it('css', () => expect(fontCss(fontSpecFor('Arial'), 12)).toContain('font-size:12px'));
});

import { shrinkSize } from './textfit';
describe('textfit', () => {
  it('shrinks to the largest fitting size, never below min', () => {
    expect(shrinkSize(28, 10, (s) => s * 5 > 100)).toBe(20);
    expect(shrinkSize(28, 10, () => true)).toBe(10);
    expect(shrinkSize(12, 10, () => false)).toBe(12);
  });
});

import { fillWidth } from './progress';
describe('progress', () => {
  it('fillWidth matches DCFillBar', () => {
    expect(fillWidth(0, 0, 100, 201)).toBe(1);
    expect(fillWidth(100, 0, 100, 201)).toBe(201);
    expect(fillWidth(50, 0, 100, 201)).toBe(101);
    expect(fillWidth(500, 0, 100, 201)).toBe(201);
    expect(fillWidth(-5, 0, 100, 201)).toBe(1);
  });
});

import { clampScroll, handleMetrics } from './scroll';
describe('scroll', () => {
  it('clamps and sizes handle', () => {
    expect(clampScroll(-5, 500, 100)).toBe(0);
    expect(clampScroll(900, 500, 100)).toBe(400);
    expect(clampScroll(10, 50, 100)).toBe(0);
    expect(handleMetrics(0, 400, 100, 100)).toEqual({ len: 25, off: 0 });
    expect(handleMetrics(300, 400, 100, 100).off).toBe(75);
    expect(handleMetrics(0, 50, 100, 100)).toEqual({ len: 100, off: 0 });
  });
});
