/**
 * Safe Supabase client wrapper that prevents the app from crashing
 * if environment variables are missing in production builds.
 * 
 * All components should import { supabase } from "@/lib/supabase-safe"
 * instead of from "@/integrations/supabase/client".
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
