import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

/**
 * Wraps the entire app and provides authentication state to all child components.
 *
 * Handles:
 * - Restoring session from localStorage on page refresh (via getSession)
 * - Listening for auth changes: login, logout, token refresh (via onAuthStateChange)
 * - Exposing signInWithGoogle() and signOut() actions
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  // loading is true until we've checked for an existing session — prevents flash of login page
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for an existing session immediately on mount.
    // This covers the page-refresh case where the token is in localStorage.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Subscribe to auth state changes for the lifetime of the app.
    // This fires on: login, logout, token refresh, OAuth callback redirect.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Initiates the Google OAuth flow.
   * Supabase redirects the user to Google, then back to window.location.origin
   * with tokens in the URL hash. The onAuthStateChange listener above picks them up.
   */
  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) console.error('Google sign-in error:', error.message);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign-out error:', error.message);
  }

  const value = { user, session, loading, signInWithGoogle, signOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/** Hook to consume auth state from any component inside AuthProvider. */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}
