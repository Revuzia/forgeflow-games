import { usePageContext } from "vike-react/usePageContext";
import { SITE_NAME, canonicalFor, isNoindex } from "../src/config/site";
import { PUBLISHER_ID } from "../src/lib/ads";

// Title, description and og:image are NOT set here — vike-react derives them
// from the `title` / `description` / `image` settings (pages/+config.ts and each
// page). charset + viewport are also emitted by vike-react itself; declaring
// them here too made every page ship them twice.
export default function Head() {
  const { urlPathname } = usePageContext();
  const noindex = isNoindex(urlPathname);
  return (
    <>
      <meta name="theme-color" content="#0a0e1a" />
      <link rel="icon" type="image/png" href="/images/favicon.png" />
      <link rel="canonical" href={canonicalFor(urlPathname)} />
      {noindex && <meta name="robots" content="noindex, follow" />}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:url" content={canonicalFor(urlPathname)} />
      <meta name="twitter:card" content="summary_large_image" />
      {/* Google AdSense site code. AdSense requires it in the <head> of every page to verify
          the site and review it. It only loads Google's library: no ad renders anywhere until
          public/ads-config.json is switched on and the slots exist. The id comes from that same
          file, so it can never drift from ads.txt. */}
      {/^ca-pub-\d{10,20}$/.test(PUBLISHER_ID) && (
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLISHER_ID}`}
          crossOrigin="anonymous"
        ></script>
      )}
      {/* Google Analytics 4 — property 545027229 (forgeflowgames.com) */}
      <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z1R90RFQKP"></script>
      <script
        dangerouslySetInnerHTML={{
          __html:
            "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-Z1R90RFQKP');",
        }}
      />
    </>
  );
}
