import { describe, expect, it } from 'vitest';
import { paraCsv } from './exportar';

describe('exportação CSV', () => {
  it('usa ponto e vírgula, escapa aspas e quebra de linha', () => {
    const csv = paraCsv([
      { a: 'x', b: 'tem; ponto e vírgula' },
      { a: 'diz "oi"', b: null, c: { k: 1 } },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['a;b;c', 'x;"tem; ponto e vírgula";', '"diz ""oi""";;"{""k"":1}"']);
  });
});
