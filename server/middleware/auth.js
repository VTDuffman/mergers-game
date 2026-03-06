import { supabase } from '../lib/supabase.js';

/**
 * Express middleware that validates the Supabase JWT from the Authorization header.
 * Attaches the user's public profile row to req.user.
 * Returns 401 if the token is missing, invalid, or the user profile doesn't exist yet.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  // Strip "Bearer " prefix
  const token = authHeader.slice(7);

  // Validate the JWT with Supabase Auth. This makes a lightweight verify call.
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Fetch the user's row from our public.users table (created by the auth trigger on signup).
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return res.status(401).json({ error: 'User profile not found. Has the account been set up?' });
  }

  // Attach to request so route handlers can use it directly.
  req.user = profile;
  next();
}
