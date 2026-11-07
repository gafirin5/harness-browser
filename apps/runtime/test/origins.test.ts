import { describe, expect, it } from 'vitest';
import { parseAllowedOrigins } from '../src/lib/origins.js';

describe('parseAllowedOrigins', () => {
  it('memisah koma dan menormalkan tiap entri ke bentuk origin', () => {
    expect(parseAllowedOrigins('https://a.example.com, http://b.example.com:8080/path')).toEqual([
      'https://a.example.com',
      'http://b.example.com:8080'
    ]);
  });

  it('mengabaikan entri kosong dan URL tidak valid', () => {
    expect(parseAllowedOrigins(' , https://ok.example.com , bukan-url, ')).toEqual(['https://ok.example.com']);
  });

  it('mengembalikan array kosong untuk string kosong', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('mempertahankan duplikat (dedup dilakukan saat digabung)', () => {
    expect(parseAllowedOrigins('https://a.example.com,https://a.example.com')).toEqual([
      'https://a.example.com',
      'https://a.example.com'
    ]);
  });
});
