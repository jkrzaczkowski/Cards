/// <reference types="astro/client" />

import type { Database } from './db/database.types.ts';
import type { SupabaseClient } from './db/supabase.client.ts';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>;
    }
  }
}

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_KEY: string;
  readonly OPENROUTER_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
