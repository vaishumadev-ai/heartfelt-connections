import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}
function pubClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type CourseCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  icon_kind: string | null;
  price_cents: number;
  duration_label: string | null;
  rating: number;
  likes: number;
};

export const listCourses = createServerFn({ method: "GET" }).handler(async (): Promise<CourseCard[]> => {
  const supabase = pubClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes")
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});