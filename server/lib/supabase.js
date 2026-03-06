import { createClient } from '@supabase/supabase-js';

// The service role key bypasses Row Level Security.
// It is ONLY used server-side — never expose it to the client.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

// Server-side Supabase admin client.
// autoRefreshToken and persistSession are disabled — this is a stateless server process.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
