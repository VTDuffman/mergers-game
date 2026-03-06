import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in client environment');
}

// Singleton browser Supabase client.
// Used for auth (Google OAuth flow) and all future REST/realtime operations.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
