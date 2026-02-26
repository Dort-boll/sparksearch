export async function onRequest(context: any) {
  const { request } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return new Response(JSON.stringify({
          AbstractText: data.AbstractText,
          AbstractSource: data.AbstractSource,
          AbstractURL: data.AbstractURL,
          Image: data.Image,
          Heading: data.Heading
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  } catch (err) {
    console.error('DuckDuckGo fetch failed:', err);
  }

  return new Response(JSON.stringify({}), {
    headers: { "Content-Type": "application/json" }
  });
}
