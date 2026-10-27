// Typed locale and message keys for next-intl (t('customers.cuont') fails to compile)
import type { Locale } from './format';
import type { Messages } from './messages';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
