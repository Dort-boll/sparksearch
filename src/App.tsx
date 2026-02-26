import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Search, Globe, Image as ImageIcon, Video, Loader2, ExternalLink, Sparkles, Shield, ShieldCheck, Copy, Check, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SearchResult {
  type: string;
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
  favicon?: string;
  metadata?: {
    domain: string;
    engine?: string;
    score?: number;
  };
}

interface InstantAnswer {
  AbstractText: string;
  AbstractSource: string;
  AbstractURL: string;
  Image: string;
  Heading: string;
}

interface SearchAggregations {
  count: number;
  time: number;
  engines: string[];
  instance: string | null;
}

type Category = 'general' | 'images' | 'videos';

export default function App() {
  const [query, setQuery] = useState('');
  const [resultsMap, setResultsMap] = useState<Record<Category, SearchResult[]>>({
    general: [],
    images: [],
    videos: []
  });
  const [aggregationsMap, setAggregationsMap] = useState<Record<Category, SearchAggregations | null>>({
    general: null,
    images: null,
    videos: null
  });
  const [summary, setSummary] = useState<InstantAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<Category>('general');
  const [safeSearch, setSafeSearch] = useState(true);
  const [lastSearch, setLastSearch] = useState({ query: '', safe: true });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fetchSummary = async (q: string) => {
    try {
      const response = await fetch(`/api/summary?q=${encodeURIComponent(q)}`);
      const text = await response.text();
      
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn('Failed to parse summary JSON:', text.slice(0, 100));
      }
      
      if (data.AbstractText) {
        setSummary({
          AbstractText: data.AbstractText,
          AbstractSource: data.AbstractSource,
          AbstractURL: data.AbstractURL,
          Image: data.Image,
          Heading: data.Heading
        });
      } else {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && apiKey !== "undefined" && apiKey.length > 10) {
          try {
            const ai = new GoogleGenAI({ apiKey });
            const result = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `Provide a concise summary for the search query: "${q}". Keep it under 300 characters.`,
              config: { tools: [{ googleSearch: {} }] }
            });

            if (result.text) {
              setSummary({
                AbstractText: result.text,
                AbstractSource: "Spark AI",
                AbstractURL: "#",
                Heading: q,
                Image: ""
              });
            }
          } catch (aiErr) {
            console.error('AI Summary fallback failed:', aiErr);
            setSummary(null);
          }
        } else {
          setSummary(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch summary:', err);
      setSummary(null);
    }
  };

  const handleSearch = async (e?: FormEvent, categoryOverride?: Category) => {
    e?.preventDefault();
    const targetQuery = query.trim();
    if (!targetQuery) return;

    const category = categoryOverride || activeTab;

    // Reset results if query or safe search changed
    const isNewSearch = targetQuery !== lastSearch.query || safeSearch !== lastSearch.safe;
    
    if (!isNewSearch && resultsMap[category].length > 0) {
      console.log('Using existing results for category:', category);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    setError(null);
    
    if (isNewSearch) {
      setResultsMap({ general: [], images: [], videos: [] });
      setAggregationsMap({ general: null, images: null, videos: null });
      setSummary(null);
      setLastSearch({ query: targetQuery, safe: safeSearch });
    } else {
      setResultsMap(prev => ({ ...prev, [category]: [] }));
      setAggregationsMap(prev => ({ ...prev, [category]: null }));
    }
    
    const resultsPromise = fetch(`/api/search?q=${encodeURIComponent(targetQuery)}&category=${category}&safe=${safeSearch}`);
    if (isNewSearch) fetchSummary(targetQuery);

    try {
      const startTime = Date.now();
      const response = await resultsPromise;
      const text = await response.text();
      
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Server returned invalid response: ${text.slice(0, 50)}...`);
      }
      
      if (!response.ok) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && apiKey !== "undefined" && apiKey.length > 10) {
          try {
            const ai = new GoogleGenAI({ apiKey });
            const result = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `Provide a list of 10 search results for the query: "${targetQuery}". Return as a JSON array of objects with title, url, and snippet.`,
              config: { 
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json"
              }
            });

            if (result.text) {
              const aiResults = JSON.parse(result.text);
              if (Array.isArray(aiResults)) {
                const formattedResults = aiResults.map((r: any) => ({
                  type: category,
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet,
                  favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url || "http://localhost").hostname}&sz=32`,
                  metadata: { domain: new URL(r.url || "http://localhost").hostname, engine: "Spark AI" }
                }));
                setResultsMap(prev => ({ ...prev, [category]: formattedResults }));
                setAggregationsMap(prev => ({ ...prev, [category]: {
                  count: formattedResults.length,
                  time: (Date.now() - startTime) / 1000,
                  engines: ["Spark AI"],
                  instance: "Spark AI Grid"
                }}));
                return;
              }
            }
          } catch (aiErr) {
            console.error('AI Search fallback failed:', aiErr);
          }
        }
        throw new Error(data.error || 'Search failed');
      }
      
      setResultsMap(prev => ({ ...prev, [category]: data.results || [] }));
      setAggregationsMap(prev => ({ ...prev, [category]: data.aggregations || null }));
    } catch (err: any) {
      console.error('Search failed:', err);
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (tab: Category) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    if (hasSearched && resultsMap[tab].length === 0) {
      handleSearch(undefined, tab);
    }
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const currentResults = resultsMap[activeTab];
  const currentAggregations = aggregationsMap[activeTab];

  return (
    <div className="min-h-screen relative font-sans selection:bg-neon-cyan/30">
      {/* Background Elements */}
      <div className="blob blob-1" />
      <div className="blob blob-2" />

      <main className={cn(
        "transition-all duration-700 ease-in-out flex flex-col items-center px-4",
        hasSearched ? "pt-8" : "pt-[30vh]"
      )}>
        {/* Logo Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-2 flex items-center justify-center gap-4">
            <span className="bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink bg-clip-text text-transparent">
              SPARK
            </span>
            <Sparkles className="w-12 h-12 text-neon-cyan animate-pulse" />
          </h1>
          {!hasSearched && (
            <p className="text-white/40 font-medium tracking-widest uppercase text-xs">
              Next Generation Privacy Search
            </p>
          )}
        </motion.div>

        {/* Search Bar */}
        <div className="w-full max-w-2xl flex flex-col gap-4">
          <motion.form 
            layout
            onSubmit={(e) => handleSearch(e)}
            className={cn(
              "w-full glass rounded-2xl p-1 flex items-center gap-2 transition-all duration-300",
              "focus-within:ring-2 focus-within:ring-neon-cyan/50 focus-within:neon-glow-cyan"
            )}
          >
            <div className="pl-4 text-white/40">
              <Search size={20} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the decentralized web..."
              className="flex-1 bg-transparent border-none outline-none py-4 text-lg text-white placeholder:text-white/20"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="bg-white text-black px-6 py-3 rounded-xl font-bold hover:bg-neon-cyan hover:text-black transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : "Search"}
            </button>
          </motion.form>
          
          <div className="flex items-center justify-center gap-6">
            <button 
              onClick={() => setSafeSearch(!safeSearch)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all",
                safeSearch ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20" : "bg-white/5 text-white/40 border border-white/10"
              )}
            >
              {safeSearch ? <ShieldCheck size={14} /> : <Shield size={14} />}
              Safe Search: {safeSearch ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Tabs & Results */}
        <AnimatePresence>
          {hasSearched && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-5xl mt-12 mb-20"
            >
              {/* Tabs */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-white/10 pb-4">
                <div className="flex gap-4">
                  {[
                    { id: 'general', label: 'Web', icon: Globe },
                    { id: 'images', label: 'Images', icon: ImageIcon },
                    { id: 'videos', label: 'Videos', icon: Video },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id as Category)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
                        activeTab === tab.id 
                          ? "bg-white/10 text-neon-cyan neon-text-cyan" 
                          : "text-white/40 hover:text-white/60"
                      )}
                    >
                      <tab.icon size={18} />
                      <span className="font-semibold">{tab.label}</span>
                    </button>
                  ))}
                </div>

                {currentAggregations && !isLoading && (
                  <div className="text-[10px] font-bold tracking-widest uppercase text-white/30 flex items-center gap-3">
                    {currentAggregations.instance === "Spark AI Grid" && (
                      <div className="flex items-center gap-1 text-neon-cyan neon-text-cyan">
                        <Sparkles size={10} />
                        <span>AI Enhanced</span>
                      </div>
                    )}
                    <span>{currentAggregations.count} Results</span>
                    <span className="w-1 h-1 rounded-full bg-white/10" />
                    <span>{currentAggregations.time}s</span>
                    {currentAggregations.engines.length > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-white/10" />
                        <span>{currentAggregations.engines.length} Engines</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Summary Section */}
              {summary && activeTab === 'general' && !isLoading && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass p-8 rounded-3xl mb-10 border-neon-cyan/20 neon-glow-cyan/10"
                >
                  <div className="flex flex-col md:flex-row gap-8">
                    {summary.Image && (
                      <div className="w-full md:w-48 h-48 flex-shrink-0 rounded-2xl overflow-hidden border border-white/10">
                        <img 
                          src={summary.Image.startsWith('http') ? summary.Image : `https://duckduckgo.com${summary.Image}`} 
                          alt={summary.Heading} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={16} className="text-neon-cyan" />
                        <span className="text-neon-cyan text-xs font-bold uppercase tracking-widest">Instant Answer</span>
                      </div>
                      <h2 className="text-3xl font-black mb-4 text-white">{summary.Heading}</h2>
                      <p className="text-white/80 text-lg leading-relaxed mb-6">
                        {summary.AbstractText}
                      </p>
                      <a 
                        href={summary.AbstractURL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-neon-cyan font-bold hover:underline"
                      >
                        Source: {summary.AbstractSource} <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Error State */}
              {error && !isLoading && currentResults.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="glass border-red-500/30 p-10 rounded-3xl text-center mb-10"
                >
                  <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Search size={32} className="text-red-500" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-white">Search Interrupted</h3>
                  <p className="text-white/60 max-w-md mx-auto mb-8">
                    {error}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                      onClick={() => handleSearch()}
                      className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-neon-cyan transition-all flex items-center justify-center gap-2"
                    >
                      <Loader2 className={cn("w-4 h-4", isLoading && "animate-spin")} />
                      Try Again
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Results List */}
              <div className={cn(
                "grid gap-4 md:gap-6",
                activeTab === 'images' 
                  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" 
                  : "grid-cols-1"
              )}>
                {isLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className={cn(
                      "glass rounded-2xl animate-pulse overflow-hidden",
                      activeTab === 'images' ? "aspect-square" : "p-4 md:p-6 h-40"
                    )}>
                      {activeTab === 'images' ? (
                        <div className="w-full h-full bg-white/5" />
                      ) : (
                        <div className="flex gap-4 md:gap-6 h-full">
                          <div className="w-24 md:w-40 h-full bg-white/5 rounded-xl hidden sm:block" />
                          <div className="flex-1 space-y-4">
                            <div className="h-4 w-1/4 bg-white/5 rounded" />
                            <div className="h-6 w-3/4 bg-white/5 rounded" />
                            <div className="h-4 w-full bg-white/5 rounded" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : currentResults.length > 0 ? (
                  currentResults.map((result, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.03, 0.5) }}
                      className={cn(
                        "glass rounded-2xl hover:border-white/20 transition-all group overflow-hidden",
                        activeTab === 'images' ? "p-0" : "p-4 md:p-6"
                      )}
                    >
                      {activeTab === 'images' ? (
                        <div className="relative aspect-square">
                          <a 
                            href={result.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="block w-full h-full"
                          >
                            <img 
                              src={result.thumbnail || result.url} 
                              alt={result.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://picsum.photos/seed/error/400/400?blur=10";
                              }}
                            />
                          </a>
                          <div className="absolute top-2 right-2 flex gap-2">
                            <button 
                              onClick={() => copyToClipboard(result.url)}
                              className="p-2 bg-black/50 backdrop-blur-md rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-neon-cyan hover:text-black"
                            >
                              {copiedUrl === result.url ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end pointer-events-none">
                            <p className="text-white text-[10px] font-bold line-clamp-2 leading-tight">{result.title}</p>
                            <p className="text-white/60 text-[8px] uppercase tracking-tighter mt-1">{result.metadata?.domain}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-4 md:gap-6 relative">
                          {result.thumbnail && (
                            <div className="w-full sm:w-32 md:w-40 h-40 sm:h-32 md:h-40 flex-shrink-0 rounded-xl overflow-hidden border border-white/10 relative group-hover:border-neon-cyan/30 transition-colors">
                              <img 
                                src={result.thumbnail} 
                                alt="" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              {activeTab === 'videos' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                                  <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/30 group-hover:scale-110 transition-transform">
                                    <Play size={20} fill="currentColor" />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 overflow-hidden">
                                {result.favicon && (
                                  <img 
                                    src={result.favicon} 
                                    alt="" 
                                    className="w-3 h-3 rounded-sm flex-shrink-0"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                                <p className="text-white/40 text-[9px] font-bold tracking-[0.2em] uppercase truncate">
                                  {result.metadata?.domain || "web"}
                                  {result.metadata?.engine && ` • ${result.metadata.engine}`}
                                </p>
                              </div>
                              <button 
                                onClick={() => copyToClipboard(result.url)}
                                className="text-white/20 hover:text-neon-cyan transition-colors flex-shrink-0"
                                title="Copy Link"
                              >
                                {copiedUrl === result.url ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </div>
                            <a 
                              href={result.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-lg md:text-xl font-bold text-neon-cyan hover:underline flex items-center gap-2 mb-2 group-hover:neon-text-cyan transition-all line-clamp-2"
                            >
                              {result.title}
                              <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                            </a>
                            <p className="text-white/70 leading-relaxed line-clamp-2 md:line-clamp-3 text-xs md:text-sm">{result.snippet}</p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))
                ) : !error && hasSearched && (
                  <div className="col-span-full text-center py-24 glass rounded-3xl">
                    <p className="text-white/40 text-xl">No results found for "{query}" in {activeTab}</p>
                    <p className="text-white/20 text-sm mt-2">Try adjusting your search terms or filters</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Actions */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-24 right-8 p-4 glass rounded-2xl text-neon-cyan hover:bg-white/10 transition-all z-50 shadow-2xl border border-white/10"
          >
            <Search className="rotate-180" size={24} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 w-full p-6 text-center glass border-t-0 pointer-events-none">
        <p className="text-white/20 text-xs font-bold tracking-[0.2em] uppercase">
          Powered by <span className="text-neon-cyan">Vayu AGI</span> • Privacy First Search
        </p>
      </footer>
    </div>
  );
}
