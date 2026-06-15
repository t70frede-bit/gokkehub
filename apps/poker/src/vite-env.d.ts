/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** MobilePay recipient phone number (digits only), e.g. "12345678". */
  readonly VITE_MOBILEPAY_NUMBER: string;
  /** App-name prefix shown in tracking codes, e.g. "GokkePoker". */
  readonly VITE_TRACKING_PREFIX: string;
  /** One-time site access code. Defaults to "PokernightAtGokkes" if unset. */
  readonly VITE_SITE_CODE: string;
  /** MobilePay Box pay-in link. Defaults to the group's box if unset. */
  readonly VITE_MOBILEPAY_BOX_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
