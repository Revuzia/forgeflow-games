import { CATEGORIES } from "./supabase";

/** The CATEGORIES entry for a registry `genre` value, if there is a category page for it. */
export const categoryFor = (genre: string) => CATEGORIES.find((c) => c.slug === genre);

/**
 * Where a game's breadcrumb / "view all" link should go. Three published games
 * (shooter, simulation, builder) have a genre with NO category page, so linking
 * to /category/<genre> sent players and crawlers to a page that does not exist.
 */
export const categoryHref = (genre: string) => (categoryFor(genre) ? `/category/${genre}` : "/games");

/** Human label for a genre value ("board_game" -> "Board Games" / "shooter" -> "Shooter"). */
export const genreLabel = (genre: string) =>
  categoryFor(genre)?.label || genre.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
