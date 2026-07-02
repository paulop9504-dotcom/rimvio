import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  resolvePublicSupabaseAnonKey,
  resolvePublicSupabaseUrl,
} from "@/lib/supabase/resolve-public-supabase-env";

export { isSupabaseConfigured } from "@/lib/supabase/config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    resolvePublicSupabaseUrl(),
    resolvePublicSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    }
  );
}

export async function tryCreateClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    return await createClient();
  } catch {
    // CLI scripts and other non-request contexts cannot call cookies().
    return null;
  }
}
