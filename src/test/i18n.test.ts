import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../i18n';

afterEach(() => setLocale('ja'));

describe('i18n', () => {
  it('returns Japanese source when locale is ja', () => {
    setLocale('ja');
    expect(t('設定')).toBe('設定');
  });

  it('translates known UI strings to English', () => {
    setLocale('en');
    expect(t('設定')).toBe('Settings');
    expect(t('ホーム')).toBe('Home');
  });

  it('falls back to the source and interpolates placeholders', () => {
    setLocale('en');
    expect(t('未登録の文言XYZ')).toBe('未登録の文言XYZ');
    expect(t('{0} 件のノート', [3])).toBe('3 notes');
  });
});
