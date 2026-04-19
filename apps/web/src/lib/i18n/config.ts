export const locales = ['vi', 'en'] as const;
export const defaultLocale = 'vi' as const;
export type Locale = (typeof locales)[number];

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (locales as readonly string[]).includes(x);
}
