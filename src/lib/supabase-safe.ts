/**
 * Safe Supabase client wrapper that prevents the app from crashing
 * if environment variables are missing (e.g., in published builds
 * where env vars haven't been injected yet).
 */

let supabaseClient: any = null;
let isConfigured = false;

try {
  // This import will throw if VITE_SUPABASE_URL is undefined
  const { supabase } = await import("@/integrations/supabase/client");
  supabaseClient = supabase;
  isConfigured = true;
} catch (e) {
  console.warn("Supabase client not configured. App will run in offline mode.");
}

export const supabase = supabaseClient;
export const isSupabaseConfigured = isConfigured;
