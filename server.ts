import express from "express";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";

const SEARXNG_INSTANCES = Array.from(new Set([
  "https://searx.be",
  "https://searxng.site",
  "https://priv.au",
  "https://searx.work",
  "https://search.inetol.net",
  "https://opnxng.com",
  "https://searx.tiekoetter.com",
  "https://search.rhscz.eu",
  "https://searx.xyz",
  "https://searx.space",
  "https://searx.info",
  "https://searx.mx",
  "https://searx.divided-by-zero.eu",
  "https://searx.stuehmer.dk",
  "https://search.bus-hit.me",
  "https://searx.fyi",
  "https://searx.sethforprivacy.com",
  "https://searx.tuxcloud.net",
  "https://searx.gnous.eu",
  "https://searx.ctis.me",
  "https://searx.dresden.network",
  "https://searx.perennialte.ch",
  "https://searx.rofl.wtf",
  "https://searx.daetalytica.io",
  "https://searx.oakley.xyz",
  "https://searx.org",
  "https://search.ononoki.org",
  "https://searx.prvcy.eu",
  "https://searx.mha.fi",
  "https://searx.namei.net.au",
  "https://searx.ninja",
  "https://searx.ru",
  "https://searx.haxtrax.com",
  "https://searx.lre.io",
  "https://searx.be"
]));

// Simple In-Memory Cache for Search Results
const searchCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Proxy for DuckDuckGo Instant Answer to avoid CORS
  app.get("/api/summary", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query required" });
    
    try {
      const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" 
        }
      });
      const data = await response.json();
      res.json(data);
    } catch (e) {
      console.error("Summary fetch error:", e);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  // Search Suggestions API
  app.get("/api/suggestions", async (req, res) => {
    const query = req.query.q as string;
    if (!query || query.length < 2) return res.json([]);

    try {
      const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
      const response = await fetch(suggestUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const data: any = await response.json();
        if (Array.isArray(data) && data[1]) {
          return res.json(data[1]);
        }
      }
      res.json([]);
    } catch (err) {
      console.error('Suggestions fetch failed:', err);
      res.json([]);
    }
  });

  app.get("/api/search", async (req, res) => {
    const query = req.query.q as string;
    const category = (req.query.category as string) || 'general';
    const safebased = req.query.safe === 'true';
    
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    // Check Cache
    const cacheKey = `${query}:${category}:${safebased}`;
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return res.json(cached.data);
    }

    const startTime = Date.now();
    const shuffled = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5);
    
    let results: any[] = [];
    let enginesUsed: Set<string> = new Set();
    let instanceUsed: string | null = null;

    let attempts = 0;
    const maxAttempts = category === 'images' ? 25 : 15; // Even more attempts for images

    for (const instance of shuffled) {
      if (attempts >= maxAttempts) break;
      attempts++;
      
      try {
        // Try both 'images' and 'it' (some instances use 'it' for images)
        // Also try adding specific engines if it's an image search
        const categoriesToTry = category === 'images' ? ['images', 'it'] : [category === 'general' ? '' : category];
        
        for (const catName of categoriesToTry) {
          const categoryParam = catName ? `&categories=${catName}` : '';
          // Try with and without specific engines
          const engineParams = category === 'images' 
            ? ['&engines=google images,bing images,duckduckgo images,qwant images', ''] 
            : [''];
          
          for (const engineParam of engineParams) {
            const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
            const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json${categoryParam}${engineParam}${safeParam}`;
            
            const response = await fetch(searchUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json, text/javascript, */*; q=0.01",
              },
              signal: AbortSignal.timeout(category === 'images' ? 15000 : 10000)
            });

            if (response.ok) {
              const contentType = response.headers.get("content-type");
              if (contentType && contentType.includes("application/json")) {
                const text = await response.text();
                try {
                  const data = JSON.parse(text);
                  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
                    instanceUsed = instance;
                    // Strict filtering based on category
                    let filtered = data.results;
                    if (category === 'images') {
                      filtered = data.results.filter((r: any) => 
                        r.img_src || r.thumbnail || r.template === 'image' || r.category === 'images' || r.content?.includes('img') || r.engine?.includes('images')
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
                } catch (jsonErr) {
                  // Ignore parse errors from specific nodes
                }
              }
            }
            if (results.length > 0) break;
          }
          if (results.length > 0) break;
        }
        if (results.length > 0) break;

        // Fallback to HTML scraping
        const categoryParam = category === 'general' ? '' : `&categories=${category}`;
        const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
        const htmlResponse = await fetch(`${instance}/search?q=${encodeURIComponent(query)}${categoryParam}${safeParam}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(8000)
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

            // Strict filtering for scraping too
            if (category === 'images' && !isImage && !thumbnail) return;
            if (category === 'videos' && !isVideo && !url.includes('youtube.com')) return;
            if (category === 'general' && (isImage || isVideo) && !snippet) return;

            let domain = "unknown";
            try { domain = new URL(url).hostname; } catch(e) {}
            if (scrapedResults.some(r => r.url === url)) return;

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

    if (results.length === 0 && category === 'images') {
      // Fallback: Try general category on multiple instances but extract images
      for (const fallbackInstance of shuffled.slice(0, 8)) {
        try {
          const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
          const fallbackUrl = `${fallbackInstance}/search?q=${encodeURIComponent(query)}&format=json${safeParam}`;
          const fbResponse = await fetch(fallbackUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(10000)
          });
          if (fbResponse.ok) {
            const fbData = await fbResponse.json();
            if (fbData.results) {
              const extracted = fbData.results
                .filter((r: any) => r.img_src || r.thumbnail)
                .map((r: any) => ({
                  type: 'images',
                  title: r.title || "No Title",
                  url: r.url || "#",
                  snippet: r.content || "",
                  thumbnail: r.img_src || r.thumbnail,
                  favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url || "http://localhost").hostname}&sz=32`,
                  metadata: { domain: new URL(r.url || "http://localhost").hostname, engine: r.engine }
                }));
              if (extracted.length > 0) {
                results = extracted;
                instanceUsed = fallbackInstance;
                break;
              }
            }
          }
        } catch (e) {}
      }
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No results found. Please try a different query." });
    }

    const responseData = { 
      query,
      category,
      results,
      aggregations: {
        count: results.length,
        time: (Date.now() - startTime) / 1000,
        engines: Array.from(enginesUsed),
        instance: instanceUsed
      }
    };

    searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    res.json(responseData);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
