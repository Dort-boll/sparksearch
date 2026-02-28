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
  "https://searx.be",
  "https://searx.neocities.org",
  "https://search.disroot.org",
  "https://searx.garudalinux.org",
  "https://searx.tuxcloud.net",
  "https://searx.web-on-fire.eu",
  "https://searx.nakost.it",
  "https://searx.slipfox.xyz",
  "https://searx.ch",
  "https://searx.me",
  "https://searx.pw",
  "https://searx.la",
  "https://searx.eu",
  "https://searx.net",
  "https://searx.bar",
  "https://searx.one",
  "https://searx.run",
  "https://searx.top",
  "https://searx.win",
  "https://searx.fun",
  "https://searx.cool",
  "https://searx.live",
  "https://searx.site",
  "https://searx.xyz",
  "https://searx.space",
  "https://searx.info",
  "https://searx.mx"
]));

// Simple In-Memory Cache for Search Results
const searchCache = new Map<string, { data: any, timestamp: number }>();
const instanceHealth = new Map<string, { failures: number, lastFailure: number }>();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes
const FAILURE_THRESHOLD = 3;
const COOLDOWN_PERIOD = 1000 * 60 * 5; // 5 minutes cooldown for bad instances

async function fetchFromInstance(instance: string, query: string, category: string, safebased: boolean, signal: AbortSignal) {
  const categoriesToTry = category === 'images' 
    ? ['images', 'it'] 
    : category === 'videos' 
      ? ['videos', 'video'] 
      : [category === 'general' ? '' : category];
  const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
  
  for (const catName of categoriesToTry) {
    const categoryParam = catName ? `&categories=${catName}` : '';
    let engineParam = '';
    if (category === 'images') {
      engineParam = '&engines=google images,bing images,duckduckgo images,qwant images';
    } else if (category === 'videos') {
      engineParam = '&engines=youtube,vimeo,dailymotion,google videos,bing videos';
    }
    
    const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json${categoryParam}${engineParam}${safeParam}`;
    
    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json, text/javascript, */*; q=0.01",
        },
        signal
      });

      if (response.ok) {
        const data = await response.json();
        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
          return { data, instance };
        }
      }
    } catch (e) {
      // Continue to next category or fail this instance
    }
  }
  throw new Error("No results from instance");
}

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

  // Health Check API
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      instances: SEARXNG_INSTANCES.length,
      healthy: SEARXNG_INSTANCES.length - instanceHealth.size
    });
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
    
    // Filter healthy instances
    const healthyInstances = SEARXNG_INSTANCES.filter(inst => {
      const health = instanceHealth.get(inst);
      if (!health) return true;
      if (health.failures < FAILURE_THRESHOLD) return true;
      if (Date.now() - health.lastFailure > COOLDOWN_PERIOD) {
        instanceHealth.delete(inst); // Reset health after cooldown
        return true;
      }
      return false;
    });

    const shuffled = [...healthyInstances].sort(() => Math.random() - 0.5);
    
    let results: any[] = [];
    let enginesUsed: Set<string> = new Set();
    let instanceUsed: string | null = null;

    // Parallel fetching in batches
    const batchSize = 8; // Increased batch size for faster discovery
    const maxTotalInstances = 40; // Try more instances in total
    
    for (let i = 0; i < shuffled.length && i < maxTotalInstances; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), category === 'images' ? 12000 : 8000); // Slightly tighter timeouts for speed

      try {
        const batchPromises = batch.map(inst => 
          fetchFromInstance(inst, query, category, safebased, controller.signal)
            .then(res => {
              // On success, we don't need to do anything special here
              return res;
            })
            .catch(err => {
              // Log failure for health tracking
              const health = instanceHealth.get(inst) || { failures: 0, lastFailure: 0 };
              instanceHealth.set(inst, { failures: health.failures + 1, lastFailure: Date.now() });
              throw err;
            })
        );

        // Wait for the first successful response in the batch
        const winner = await Promise.any(batchPromises);
        if (winner) {
          controller.abort(); // Cancel other requests in the batch
          clearTimeout(timeoutId);
          
          const { data, instance } = winner;
          instanceUsed = instance;
          
          let filtered = data.results;
          if (category === 'images') {
            filtered = data.results.filter((r: any) => 
              r.img_src || r.thumbnail || r.template === 'image' || r.category === 'images' || r.content?.includes('img') || r.engine?.includes('images')
            );
          } else if (category === 'videos') {
            filtered = data.results.filter((r: any) => 
              r.template === 'video' || r.category === 'videos' || r.category === 'video' ||
              r.url.includes('youtube.com') || r.url.includes('vimeo.com') || r.url.includes('dailymotion.com') ||
              r.url.includes('youtu.be') || r.iframe_src || r.content?.includes('video')
            );
          }

          if (filtered.length > 0) {
            results = filtered.map((r: any) => {
              if (r.engine) enginesUsed.add(r.engine);
              let domain = "unknown";
              try { domain = new URL(r.url || "http://localhost").hostname; } catch(e) {}
              
              return {
                type: r.category || category,
                title: r.title || "No Title",
                url: r.url || "#",
                snippet: r.content || r.snippet || "",
                thumbnail: r.img_src || r.thumbnail || null,
                favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
                metadata: {
                  domain,
                  engine: r.engine,
                  score: r.score
                }
              };
            });
            break;
          }
        }
      } catch (e) {
        // All instances in batch failed or timed out, continue to next batch
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Fallback to HTML scraping if still no results
    if (results.length === 0) {
      const scraperInstance = shuffled[0];
      if (scraperInstance) {
        try {
          const categoryParam = category === 'general' ? '' : `&categories=${category}`;
          const safeParam = safebased ? '&safesearch=1' : '&safesearch=0';
          const htmlResponse = await fetch(`${scraperInstance}/search?q=${encodeURIComponent(query)}${categoryParam}${safeParam}`, {
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
            instanceUsed = scraperInstance;

            const resultSelectors = ["article.result", ".result", ".result-default", ".result-images", ".result-videos"];
            $(resultSelectors.join(", ")).each((_, el) => {
              const $el = $(el);
              const $link = $el.find("a.result__a, h3 a, h4 a, .result-header a, .title a, a.image-link").first();
              if (!$link.length) return;

              let title = $link.text().trim() || $el.find(".title, .result-title").text().trim();
              let url = $link.attr("href") || "#";
              if (url.startsWith("/")) try { url = new URL(url, scraperInstance).toString(); } catch(e) {}

              const snippet = $el.find("p.result__snippet, .content, .snippet, .result-content, .description").first().text().trim();
              let thumbnail = $el.find("img").first().attr("src") || $el.find("img").first().attr("data-src") || null;
              if (thumbnail && thumbnail.startsWith("/")) try { thumbnail = new URL(thumbnail, scraperInstance).toString(); } catch(e) {}

              let type = category;
              if ($el.hasClass("result-images") || thumbnail) type = 'images';
              if ($el.hasClass("result-videos") || url.includes('youtube.com')) type = 'videos';

              if (category === 'images' && !thumbnail) return;
              if (category === 'videos' && !url.includes('youtube.com')) return;

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
            }
          }
        } catch (e) {}
      }
    }

    if (results.length === 0 && category === 'videos') {
      // Fallback: Try general category on multiple instances but extract videos
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
                .filter((r: any) => 
                  r.template === 'video' || r.category === 'videos' || r.category === 'video' ||
                  r.url.includes('youtube.com') || r.url.includes('youtu.be') || r.url.includes('vimeo.com')
                )
                .map((r: any) => ({
                  type: 'videos',
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
