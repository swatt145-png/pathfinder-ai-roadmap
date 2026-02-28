/**
 * Safe Supabase client wrapper that re-exports the Lovable auto-generated
 * client and exposes a configuration check flag.
 *
 * All components should import { supabase } from "@/lib/supabase-safe"
 * instead of from "@/integrations/supabase/client".
 */

import { supabase } from '@/integrations/supabase/client';

export { supabase };
export const isSupabaseConfigured = true;
