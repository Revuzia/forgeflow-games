import { useEffect } from "react";

/**
 * Adds <meta name="robots" content="noindex"> from the CLIENT. Vike's <Head> only
 * renders on the server, so a page that is only discovered to be "not found" in
 * the browser (e.g. the stale-prerender fallback serving the app shell for an
 * unknown /games/<slug>) cannot noindex itself through <Head>. Googlebot renders
 * JavaScript, so it does see a tag added here.
 */
export default function useNoindex(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, follow";
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, [active]);
}
