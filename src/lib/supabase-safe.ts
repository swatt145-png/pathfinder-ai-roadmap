/**
 * Safe Supabase client that never crashes at module load time.
 *
 * All components should import { supabase } from "@/lib/supabase-safe"
 * instead of from "@/integrations/supabase/client".
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let supabase: SupabaseClient<Database>;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
} else {
  // Provide a dummy client that won't crash the app.
  // In Lovable's deployed environment the auto-generated client at
  // @/integrations/supabase/client has the values injected, so this
  // fallback is only hit during local dev without .env or edge cases.
  supabase = createClient<Database>(
    'https://placeholder.supabase.co',
    'placeholder-key',
    {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
}

export { supabase };
