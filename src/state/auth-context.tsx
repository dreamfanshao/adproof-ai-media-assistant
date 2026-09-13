import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { supabase, supabaseConfigError } from "../lib/supabase";
import { ApiClientError, apiRequest, configureApiAuthRecovery } from "../lib/api-client";

type AuthStatus = "loading" | "anonymous" | "authenticated" | "misconfigured";

interface SignUpResult {
  requiresEmailConfirmation: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

interface ProfileResponse {
  data: UserProfile;
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  configurationError: string | null;
  isAdmin: boolean | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  resendSignUpConfirmation: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function requireClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? "Supabase client is unavailable.");
  }
  return supabase;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(supabase ? "loading" : "misconfigured");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    configureApiAuthRecovery(async () => {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data.session) return null;
      return data.session.access_token;
    });

    let active = true;
    void client.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) {
        setSession(null);
        setStatus("anonymous");
        return;
      }
      let nextSession = data.session;
      const expiresSoon = nextSession?.expires_at
        ? nextSession.expires_at * 1000 <= Date.now() + 60_000
        : false;
      if (nextSession && expiresSoon) {
        const refreshed = await client.auth.refreshSession();
        if (!active) return;
        if (refreshed.error || !refreshed.data.session) {
          await client.auth.signOut({ scope: "local" });
          nextSession = null;
        } else {
          nextSession = refreshed.data.session;
        }
      }
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
    });

    return () => {
      configureApiAuthRecovery(null);
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setProfile(null);
      setProfileError(null);
      setIsAdmin(null);
      return;
    }

    let active = true;
    setProfileError(null);
    void apiRequest<ProfileResponse>("/me", session.access_token)
      .then((response) => {
        if (active) setProfile(response.data);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiClientError && error.status === 401) {
          setProfile(null);
          setProfileError(null);
          setSession(null);
          setStatus("anonymous");
          void requireClient().auth.signOut({ scope: "local" });
          return;
        }
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : "用户资料读取失败。");
      });

    void apiRequest<{ data: { isAdmin: boolean } }>("/operations/access", session.access_token)
      .then((response) => { if (active) setIsAdmin(response.data.isAdmin); })
      .catch(() => { if (active) setIsAdmin(false); });

    return () => { active = false; };
  }, [session?.access_token]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    user: session?.user ?? null,
    profile,
    profileError,
    isAdmin,
    configurationError: supabaseConfigError,
    async signIn(email, password) {
      const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error("登录成功但未获得有效会话，请重试。");
      void fetch("/api/v1/analytics/login", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => undefined);
      setSession(data.session);
      setStatus("authenticated");
    },
    async signUp(email, password) {
      const { data, error } = await requireClient().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      void fetch("/api/v1/analytics/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: data.user?.id }) }).catch(() => undefined);
      return { requiresEmailConfirmation: data.session === null };
    },
    async resendSignUpConfirmation(email) {
      const { error } = await requireClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await requireClient().auth.signOut();
      if (error) throw error;
    },
  }), [isAdmin, profile, profileError, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
