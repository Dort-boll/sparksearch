import * as cheerio from 'cheerio';

const SEARXNG_INSTANCES = [
  "https://searx.tiekoetter.com",
  "https://searx.be",
  "https://priv.au",
  "https://searx.work",
  "https://searxng.site",
  "https://searx.xyz",
  "https://searx.prvcy.eu",
  "https://searx.space",
  "https://searx.info",
  "https://searx.org",
  "https://search.ononoki.org",
  "https://searx.sethforprivacy.com",
  "https://searx.mx",
  "https://searx.ctis.me",
  "https://searx.dresden.network",
  "https://searx.perennialte.ch",
  "https://searx.rofl.wtf",
  "https://searx.daetalytica.io",
  "https://searx.divided-by-zero.eu",
  "https://searx.stuehmer.dk",
  "https://searx.oakley.xyz",
  "https://search.bus-hit.me",
  "https://searx.fyi",
  "https://searx.me",
  "https://searx.uk",
  "https://searx.net.ua",
  "https://searx.de",
  "https://searx.laquadrature.net",
  "https://searx.nixnet.services",
  "https://searx.ru",
  "https://searx.win",
  "https://searx.gnous.eu",
  "https://searx.tuxcloud.net",
  "https://search.rhscz.eu",
  "https://opnxng.com",
  "https://search.inetol.net",
  "https://searx.web-republic.xyz",
  "https://searx.mastodontech.de",
  "https://searx.hard-limit.com",
  "https://searx.ch",
  "https://searx.cat",
  "https://searx.bar",
  "https://searx.pw",
  "https://searx.neocities.org",
  "https://searx.rocks",
  "https://searx.life",
  "https://searx.work",
  "https://searx.xyz",
  "https://searx.info",
  "https://searx.org",
  "https://searx.me",
  "https://searx.be",
  "https://searx.space",
  "https://searx.fyi",
  "https://searx.mx",
  "https://searx.uk",
  "https://searx.de",
  "https://searx.ru",
  "https://searx.win",
  "https://searx.laquadrature.net",
  "https://searx.nixnet.services",
  "https://searx.net.ua",
  "https://searx.ctis.me",
  "https://searx.dresden.network",
  "https://searx.perennialte.ch",
  "https://searx.rofl.wtf",
  "https://searx.daetalytica.io",
  "https://searx.divided-by-zero.eu",
  "https://searx.stuehmer.dk",
  "https://searx.oakley.xyz",
  "https://search.bus-hit.me",
  "https://searx.gnous.eu",
  "https://searx.tuxcloud.net",
  "https://search.rhscz.eu",
  "https://opnxng.com",
  "https://search.inetol.net",
  "https://searx.web-republic.xyz",
  "https://searx.mastodontech.de",
  "https://searx.hard-limit.com",
  "https://searx.ch",
  "https://searx.cat",
  "https://searx.bar",
  "https://searx.tiekoetter.com",
  "https://priv.au",
  "https://searxng.site",
  "https://searx.prvcy.eu",
  "https://search.ononoki.org",
  "https://searx.sethforprivacy.com"
];

export async function onRequest(context: any) {
  const { request } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const category = url.searchParams.get("category") || 'general';
  const safebased = url.searchParams.get("safe") === 'true';

  if (!query) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const startTime = Date.now();
  const shuffled = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5);
  
  // We'll try instances in batches to avoid hitting subrequest limits and CPU limits
  const BATCH_SIZE = 5;
  const MAX_BATCHES = 8; // Total 40 attempts
  
  let results: any[] = [];
  let enginesUsed: Set<string> = new Set();
  let instanceUsed: string | null = null;

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
  ];

  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = shuffled.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) break;
    
    const batchPromises = batch.map(async (instance) => {
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
      const categoryParam = category === 'general' ? '' : `&categories=${category}`;
      const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
      const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json${categoryParam}${safeParam}`;

      try {
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": randomUA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
          const data: any = await response.json();
          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            let filtered = data.results;
            if (category === 'images') {
              filtered = data.results.filter((r: any) => r.img_src || r.thumbnail || r.template === 'image');
            } else if (category === 'videos') {
              filtered = data.results.filter((r: any) => r.template === 'video' || r.url.includes('youtube.com') || r.url.includes('vimeo.com') || r.url.includes('dailymotion.com'));
            }

            if (filtered.length > 0) {
              return {
                instance,
                results: filtered.map((r: any) => ({
                  type: r.category || category,
                  title: r.title || "No Title",
                  url: r.url || "#",
                  snippet: r.content || r.snippet || "",
                  thumbnail: r.img_src || r.thumbnail || null,
                  favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url || "http://localhost").hostname}&sz=32`,
                  metadata: {
                    domain: new URL(r.url || "http://localhost").hostname,
                    engine: r.engine,
                    score: r.score
                  }
                })),
                engines: data.engines || []
              };
            }
          }
        }
      } catch (e) {
        // Fallback to HTML scraping for this instance if JSON fails
        try {
          const htmlResponse = await fetch(`${instance}/search?q=${encodeURIComponent(query)}${categoryParam}${safeParam}`, {
            headers: { 
              "User-Agent": randomUA,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(8000)
          });

          if (htmlResponse.ok) {
            const html = await htmlResponse.text();
            const $ = cheerio.load(html);
            const scraped: any[] = [];
            
            const selectors = [
              "article.result", 
              ".result", 
              ".result-default", 
              ".result-images", 
              ".result-videos",
              ".result_container",
              ".image-result",
              ".video-result"
            ];

            $(selectors.join(", ")).each((_, el) => {
              const $el = $(el);
              const $link = $el.find("a.result__a, h3 a, h4 a, .result-header a, .title a, a.image-link").first();
              if (!$link.length) return;

              let title = $link.text().trim() || $el.find(".title, .result-title").text().trim();
              let url = $link.attr("href") || "#";
              if (url.startsWith("/")) try { url = new URL(url, instance).toString(); } catch(e) {}

              const snippet = $el.find("p.result__snippet, .content, .snippet, .result-content, .description").first().text().trim();
              let thumbnail = $el.find("img").first().attr("src") || 
                              $el.find("img").first().attr("data-src") ||
                              $el.find(".image img, .thumbnail img, .result-image img").first().attr("src") || null;
              
              if (thumbnail && thumbnail.startsWith("/")) try { thumbnail = new URL(thumbnail, instance).toString(); } catch(e) {}

              let domain = "unknown";
              try { domain = new URL(url).hostname; } catch(e) {}

              scraped.push({
                type: category,
                title: title || "No Title",
                url,
                snippet: snippet || "",
                thumbnail,
                favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
                metadata: { domain }
              });
            });

            if (scraped.length > 0) {
              return { instance, results: scraped, engines: [] };
            }
          }
        } catch (innerE) {}
      }
      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    const successful = batchResults.find(r => r !== null);
    
    if (successful) {
      results = successful.results;
      instanceUsed = successful.instance;
      successful.engines.forEach((e: any) => enginesUsed.add(e.name || e));
      break;
    }
  }

  if (results.length === 0) {
    return new Response(JSON.stringify({ error: "No results found. Please try a different query." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const responseData = {
    results,
    aggregations: {
      count: results.length,
      time: (Date.now() - startTime) / 1000,
      engines: Array.from(enginesUsed),
      instance: instanceUsed ? new URL(instanceUsed).hostname : null
    }
  };

  return new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json" }
  });
}
