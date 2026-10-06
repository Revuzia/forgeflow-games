import { useQuery } from "@tanstack/react-query";
import { supabase, type Game } from "../lib/supabase";
import { applyGameQuery } from "../lib/seed";

export function useGames(options?: {
  genre?: string;
  search?: string;
  sort?: "popular" | "new" | "top_rated" | "random";
  limit?: number;
  status?: string;
}, seed?: Game[]) {
  const { genre, search, sort = "popular", limit = 50, status = "published" } = options || {};
  // Prerender seed (see src/lib/seed.ts): lets the static HTML contain real game
  // cards. Only for the plain published/unsearched view; everything else fetches.
  const initial = !search && status === "published" ? applyGameQuery(seed, { genre, sort, limit }) : undefined;

  return useQuery({
    initialData: initial,
    initialDataUpdatedAt: initial ? 0 : undefined, // stale at once -> refetch on mount, never serve old counts
    queryKey: ["games", genre, search, sort, limit, status],
    queryFn: async () => {
      let query = supabase
        .from("games")
        .select("*")
        .eq("status", status);

      if (genre) query = query.eq("genre", genre);
      if (search) query = query.ilike("title", `%${search}%`);

      switch (sort) {
        case "popular":
          query = query.order("play_count", { ascending: false });
          break;
        case "new":
          query = query.order("created_at", { ascending: false });
          break;
        case "top_rated":
          query = query.order("rating_sum", { ascending: false });
          break;
        case "random":
          // Supabase doesn't support random ordering natively,
          // fetch all and shuffle client-side
          break;
      }

      query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;

      if (sort === "random" && data) {
        return data.sort(() => Math.random() - 0.5) as Game[];
      }
      return (data || []) as Game[];
    },
    staleTime: 60_000,
  });
}

export function useGame(slug: string, seed?: Game | null) {
  const initial = seed && seed.slug === slug ? seed : undefined;
  return useQuery({
    initialData: initial,
    initialDataUpdatedAt: initial ? 0 : undefined,
    queryKey: ["game", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data as Game;
    },
    enabled: !!slug,
  });
}

export function useFeaturedGames() {
  return useQuery({
    queryKey: ["games", "featured"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("status", "featured")
        .order("play_count", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as Game[];
    },
    staleTime: 300_000,
  });
}

export function useRelatedGames(game: Game | null, seed?: Game[]) {
  const initial = game && seed ? seed : undefined;
  return useQuery({
    initialData: initial,
    initialDataUpdatedAt: initial ? 0 : undefined,
    queryKey: ["games", "related", game?.id],
    queryFn: async () => {
      if (!game) return [];
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("genre", game.genre)
        .neq("id", game.id)
        .eq("status", "published")
        .order("play_count", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []) as Game[];
    },
    enabled: !!game,
    staleTime: 300_000,
  });
}
