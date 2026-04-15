import { useQuery } from "@tanstack/react-query";
import { supabase, type Game } from "../lib/supabase";

export function useGames(options?: {
  genre?: string;
  search?: string;
  sort?: "popular" | "new" | "top_rated" | "random";
  limit?: number;
  status?: string;
}) {
  const { genre, search, sort = "popular", limit = 50, status = "published" } = options || {};

  return useQuery({
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

export function useGame(slug: string) {
  return useQuery({
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

export function useRelatedGames(game: Game | null) {
  return useQuery({
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
