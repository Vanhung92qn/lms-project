import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';
import { isLocale } from './config';

/**
 * Loads messages for the active locale. Called once per request by next-intl.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  if (!isLocale(locale)) notFound();

  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
