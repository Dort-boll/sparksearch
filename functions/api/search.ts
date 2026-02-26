import * as cheerio from 'cheerio';

const SEARXNG_INSTANCES = [
  "https://search.rhscz.eu",
  "https://searx.tiekoetter.com",
  "https://opnxng.com",
  "https://search.inetol.net",
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
  "https://searx.tuxcloud.net",
  "https://searx.gnous.eu",
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
  "https://searx.me"
];

export async function onRequest(context: any) {
  const { request, env } = context;
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
  
  let results: any[] = [];
  let enginesUsed: Set<string> = new Set();
  let instanceUsed: string | null = null;

  const maxAttempts = 8;
  let attempts = 0;

  for (const instance of shuffled) {
    if (attempts >= maxAttempts) break;
    attempts++;
    
    try {
      const categoryParam = category === 'general' ? '' : `&categories=${category}`;
      const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
      const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json${categoryParam}${safeParam}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json, text/javascript, */*; q=0.01",
        },
        signal: AbortSignal.timeout(6000)
      });

      if (response.ok) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
            if (data.results && Array.isArray(data.results) && data.results.length > 0) {
              instanceUsed = instance;
              let filtered = data.results;
              
              if (category === 'images') {
                filtered = data.results.filter((r: any) => 
                  r.img_src || r.thumbnail || r.template === 'image' || r.category === 'images'
                );
              } else if (category === 'videos') {
                filtered = data.results.filter((r: any) => 
                  r.template === 'video' || r.category === 'videos' || 
                  r.url.includes('youtube.com') || r.url.includes('vimeo.com') || r.url.includes('dailymotion.com')
                );
              }

              if (filtered.length > 0) {
                results = filtered.map((r: any) => {
                  if (r.engine) enginesUsed.add(r.engine);
                  return {
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
                  };
                });
                break;
              }
            }
          } catch (e) {}
        }

        // Scraping fallback
        const htmlResponse = await fetch(`${instance}/search?q=${encodeURIComponent(query)}${categoryParam}${safeParam}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(6000)
        });

        if (htmlResponse.ok) {
          const html = await htmlResponse.text();
          const $ = cheerio.load(html);
          const scrapedResults: any[] = [];
          instanceUsed = instance;

          const resultSelectors = [
            "article.result", 
            ".result", 
            ".result-default", 
            ".result-images", 
            ".result-videos",
            ".result_container",
            ".image-result",
            ".video-result"
          ];
          
          $(resultSelectors.join(", ")).each((_, el) => {
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

            let type = category;
            const isImage = $el.hasClass("result-images") || $el.find(".result-images").length > 0 || $el.hasClass("image-result");
            const isVideo = $el.hasClass("result-videos") || $el.find(".result-videos").length > 0 || $el.hasClass("video-result") || url.includes('youtube.com');

            if (isImage) type = 'images';
            else if (isVideo) type = 'videos';

            if (category === 'images' && !isImage && !thumbnail) return;
            if (category === 'videos' && !isVideo && !url.includes('youtube.com')) return;
            if (category === 'general' && (isImage || isVideo) && !snippet) return;

            let domain = "unknown";
            try { domain = new URL(url).hostname; } catch(e) {}
            
            scrapedResults.push({
              type,
              title: title || "No Title",
              url,
              snippet: snippet || "",
              thumbnail,
              favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
              metadata: { domain }
            });
          });

        if (scrapedResults.length > 0) {
          results = scrapedResults;
          break;
        }
      }
    } catch (e) {
      continue;
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
