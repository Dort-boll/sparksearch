export async function onRequest(context: any) {
  const { request } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query || query.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Using Google's autocomplete API (publicly accessible)
    // client=firefox returns a simple JSON array: [query, [suggestions]]
    const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
    const response = await fetch(suggestUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok) {
      const data: any = await response.json();
      if (Array.isArray(data) && data[1]) {
        return new Response(JSON.stringify(data[1]), {
          headers: { 
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600"
          }
        });
      }
    }
  } catch (err) {
    console.error('Suggestions fetch failed:', err);
  }

  return new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" }
  });
}
