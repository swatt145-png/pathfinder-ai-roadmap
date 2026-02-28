import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: { display_name: string | null } | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInAsGuest: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  isGuest: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<{ display_name: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
      setProfile(data);
    } catch {
      // Supabase not available
    }
  };

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | undefined;

    // Safety timeout: if auth never resolves, stop loading after 5s
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    try {
      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        clearTimeout(timeout);
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchProfile(session.user.id), 500);
        } else {
          setProfile(null);
        }
        setLoading(false);
      });
      subscription = data.subscription;
    } catch {
      clearTimeout(timeout);
      setLoading(false);
    }

    try {
      supabase.auth.getSession().then(({ data: { session } }) => {
        clearTimeout(timeout);
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) fetchProfile(session.user.id);
        setLoading(false);
      }).catch(() => {
        clearTimeout(timeout);
        setLoading(false);
      });
    } catch {
      clearTimeout(timeout);
      setLoading(false);
    }

    return () => {
      clearTimeout(timeout);
      subscription?.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, displayName: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin,
        },
      });
      return { error: error?.message ?? null };
    } catch (e: any) {
      return { error: e?.message ?? "Sign up failed" };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch (e: any) {
      return { error: e?.message ?? "Sign in failed" };
    }
  };

  const signInAsGuest = async () => {
    try {
      const { error } = await supabase.auth.signInAnonymously();
      return { error: error?.message ?? null };
    } catch (e: any) {
      return { error: e?.message ?? "Guest login failed" };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  };

  const isGuest = !!user && !user.email;

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signUp, signIn, signInAsGuest, signOut, isGuest }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
