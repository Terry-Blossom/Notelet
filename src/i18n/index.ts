export type Locale = 'en' | 'ja';

const modules = import.meta.glob<{ dict: Record<string, string> }>('./dicts/*.ts', {
  eager: true,
});

const en: Record<string, string> = Object.assign(
  {},
  ...Object.values(modules).map((m) => m.dict ?? {})
);

let currentLocale: Locale = 'ja';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 日本語の原文をキーに英語へ翻訳する。英語辞書に無い場合は原文を返す。
 * 動的な値は `{0}` `{1}` のプレースホルダーで埋め込む。
 */
export function t(source: string, vars?: ReadonlyArray<string | number>): string {
  const template = currentLocale === 'en' ? en[source] ?? source : source;
  if (!vars || vars.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = vars[Number(index)];
    return value === undefined ? match : String(value);
  });
}
