export default function Head() {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content="ForgeFlow Games - Play 55+ free premium browser games. Platformers, RPGs, adventure, strategy, and board games. No downloads, no signups, just play." />
      <meta name="theme-color" content="#0a0e1a" />
      <link rel="icon" type="image/png" href="/images/favicon.png" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="ForgeFlow Games" />
      <meta property="og:image" content="/images/og-default.png" />
      <meta name="twitter:card" content="summary_large_image" />
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
