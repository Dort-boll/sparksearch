import { useState, useEffect, useRef, type FormEvent, type ReactNode, type KeyboardEvent } from 'react';
import { Search, Globe, Image as ImageIcon, Video, Loader2, ExternalLink, Sparkles, Shield, ShieldCheck, Copy, Check, Play, X } from 'lucide-react';
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

const SummaryCard = ({ summary }: { summary: InstantAnswer }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="glass p-8 rounded-3xl border-neon-cyan/20 neon-glow-cyan/10"
  >
    <div className="flex flex-col gap-6">
      {summary.Image && (
        <div className="w-full h-48 rounded-2xl overflow-hidden border border-white/10">
          <img 
            src={summary.Image.startsWith('http') ? summary.Image : `https://duckduckgo.com${summary.Image}`} 
            alt={summary.Heading} 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-neon-cyan" />
          <span className="text-neon-cyan text-[10px] font-black uppercase tracking-[0.3em]">Intelligence Node</span>
        </div>
        <h2 className="text-2xl font-black mb-4 text-white tracking-tight leading-tight">{summary.Heading}</h2>
        <p className="text-white/60 text-sm leading-relaxed mb-6 font-medium">
          {summary.AbstractText}
        </p>
        <a 
          href={summary.AbstractURL} 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-neon-cyan text-xs font-black uppercase tracking-widest hover:underline"
        >
          Source: {summary.AbstractSource} <ExternalLink size={12} />
        </a>
      </div>
    </div>
  </motion.div>
);

export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
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
  const [loadingMap, setLoadingMap] = useState<Record<Category, boolean>>({
    general: false,
    images: false,
    videos: false
  });
  const [errorMap, setErrorMap] = useState<Record<Category, string | null>>({
    general: null,
    images: null,
    videos: null
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<Category>('general');
  const [safeSearch, setSafeSearch] = useState(true);
  const [lastSearch, setLastSearch] = useState({ query: '', safe: true });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const suggestionsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) && 
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestionIndex(-1);
      return;
    }

    if (suggestionsTimeoutRef.current) clearTimeout(suggestionsTimeoutRef.current);

    suggestionsTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
          setSuggestionIndex(-1);
        }
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      }
    }, 300);

    return () => {
      if (suggestionsTimeoutRef.current) clearTimeout(suggestionsTimeoutRef.current);
    };
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && suggestionIndex >= 0) {
      e.preventDefault();
      const selected = suggestions[suggestionIndex];
      setQuery(selected);
      setShowSuggestions(false);
      // Trigger search
      setTimeout(() => handleSearch(undefined), 0);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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

  const fetchSummary = async (q: string, signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/summary?q=${encodeURIComponent(q)}`, { signal });
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
        setSummary(null);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch summary:', err);
      setSummary(null);
    }
  };

  const handleSearch = async (e?: FormEvent, categoryOverride?: Category) => {
    e?.preventDefault();
    const targetQuery = query.trim();
    if (!targetQuery) return;

    setShowSuggestions(false);

    // If it's a tab click and we already have results, don't reload
    if (categoryOverride && resultsMap[categoryOverride].length > 0 && targetQuery === lastSearch.query && safeSearch === lastSearch.safe) {
      setActiveTab(categoryOverride);
      return;
    }

    const isNewSearch = targetQuery !== lastSearch.query || safeSearch !== lastSearch.safe;
    
    // Abort previous requests if it's a new global search
    if (isNewSearch) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
    }
    
    const signal = abortControllerRef.current?.signal;

    setHasSearched(true);
    
    if (isNewSearch) {
      setResultsMap({ general: [], images: [], videos: [] });
      setAggregationsMap({ general: null, images: null, videos: null });
      setSummary(null);
      setErrorMap({ general: null, images: null, videos: null });
      setLastSearch({ query: targetQuery, safe: safeSearch });
      
      // Load all three in parallel
      const categories: Category[] = ['general', 'images', 'videos'];
      categories.forEach(cat => fetchCategory(targetQuery, cat, signal!));
      fetchSummary(targetQuery, signal!);
    } else if (categoryOverride) {
      // Just reload one category if requested specifically
      fetchCategory(targetQuery, categoryOverride, signal!);
    }
  };

  const fetchCategory = async (q: string, category: Category, signal: AbortSignal) => {
    setLoadingMap(prev => ({ ...prev, [category]: true }));
    setErrorMap(prev => ({ ...prev, [category]: null }));

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&category=${category}&safe=${safeSearch}`, { signal });
      const text = await response.text();
      
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Server returned invalid response`);
      }
      
      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }
      
      setResultsMap(prev => ({ ...prev, [category]: data.results || [] }));
      setAggregationsMap(prev => ({ ...prev, [category]: data.aggregations || null }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      
      // Gemini Fallback for Images
      if (category === 'images') {
        try {
          const apiKey = (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY || process.env.API_KEY : undefined) || 
                         (window as any).process?.env?.GEMINI_API_KEY || 
                         (import.meta as any).env?.VITE_GEMINI_API_KEY;
          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
              model: "gemini-3.1-flash-image-preview",
              contents: `Find high-quality image results for: ${q}. Return a list of image URLs and their source titles.`,
              config: {
                tools: [{ 
                  googleSearch: { 
                    searchTypes: {
                      imageSearch: {}
                    }
                  } 
                }]
              }
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks && chunks.length > 0) {
              const geminiResults = chunks
                .filter((c: any) => c.web && (c.web.uri.includes('.jpg') || c.web.uri.includes('.png') || c.web.uri.includes('.webp') || c.web.uri.includes('image')))
                .map((c: any) => ({
                  type: 'images',
                  title: c.web.title || "Image Result",
                  url: c.web.uri,
                  snippet: c.web.title,
                  thumbnail: c.web.uri,
                  favicon: `https://www.google.com/s2/favicons?domain=${new URL(c.web.uri).hostname}&sz=32`,
                  metadata: { domain: new URL(c.web.uri).hostname, engine: 'gemini-vision' }
                }));
              
              if (geminiResults.length > 0) {
                setResultsMap(prev => ({ ...prev, [category]: geminiResults }));
                return;
              }
            }
          }
        } catch (geminiErr) {
          console.error("Gemini Image Fallback failed:", geminiErr);
        }
      }

      // Gemini Fallback for Videos
      if (category === 'videos') {
        try {
          const apiKey = (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY || process.env.API_KEY : undefined) || 
                         (window as any).process?.env?.GEMINI_API_KEY || 
                         (import.meta as any).env?.VITE_GEMINI_API_KEY;
          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
              model: "gemini-3.1-flash-preview",
              contents: `Find high-quality video results for: ${q}. Return a list of video URLs (YouTube, Vimeo, etc.) and their source titles.`,
              config: {
                tools: [{ 
                  googleSearch: {} 
                }]
              }
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks && chunks.length > 0) {
              const geminiResults = chunks
                .filter((c: any) => c.web && (c.web.uri.includes('youtube.com') || c.web.uri.includes('youtu.be') || c.web.uri.includes('vimeo.com') || c.web.uri.includes('dailymotion.com') || c.web.uri.includes('video')))
                .map((c: any) => {
                  let thumb = null;
                  try {
                    const url = new URL(c.web.uri);
                    if (url.hostname.includes('youtube.com')) {
                      const v = url.searchParams.get('v');
                      if (v) thumb = `https://img.youtube.com/vi/${v}/0.jpg`;
                    } else if (url.hostname.includes('youtu.be')) {
                      const v = url.pathname.slice(1);
                      if (v) thumb = `https://img.youtube.com/vi/${v}/0.jpg`;
                    }
                  } catch (e) {}
                  
                  return {
                    type: 'videos',
                    title: c.web.title || "Video Result",
                    url: c.web.uri,
                    snippet: c.web.title,
                    thumbnail: thumb,
                    favicon: `https://www.google.com/s2/favicons?domain=${new URL(c.web.uri).hostname}&sz=32`,
                    metadata: { domain: new URL(c.web.uri).hostname, engine: 'gemini-vision' }
                  };
                });
              
              if (geminiResults.length > 0) {
                setResultsMap(prev => ({ ...prev, [category]: geminiResults }));
                return;
              }
            }
          }
        } catch (geminiErr) {
          console.error("Gemini Video Fallback failed:", geminiErr);
        }
      }

      // Gemini Fallback for General
      if (category === 'general') {
        try {
          const apiKey = (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY || process.env.API_KEY : undefined) || 
                         (window as any).process?.env?.GEMINI_API_KEY || 
                         (import.meta as any).env?.VITE_GEMINI_API_KEY;
          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
              model: "gemini-3.1-flash-preview",
              contents: `Search for: ${q}. Provide a list of relevant web results with titles, URLs, and brief snippets.`,
              config: {
                tools: [{ 
                  googleSearch: {} 
                }]
              }
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks && chunks.length > 0) {
              const geminiResults = chunks
                .filter((c: any) => c.web)
                .map((c: any) => ({
                  type: 'general',
                  title: c.web.title || "Web Result",
                  url: c.web.uri,
                  snippet: c.web.title,
                  favicon: `https://www.google.com/s2/favicons?domain=${new URL(c.web.uri).hostname}&sz=32`,
                  metadata: { domain: new URL(c.web.uri).hostname, engine: 'gemini-search' }
                }));
              
              if (geminiResults.length > 0) {
                setResultsMap(prev => ({ ...prev, [category]: geminiResults }));
                return;
              }
            }
          }
        } catch (geminiErr) {
          console.error("Gemini General Fallback failed:", geminiErr);
        }
      }

      console.error(`Search failed for ${category}:`, err);
      setErrorMap(prev => ({ ...prev, [category]: err.message || 'An unexpected error occurred.' }));
    } finally {
      setLoadingMap(prev => ({ ...prev, [category]: false }));
    }
  };

  const handleTabChange = (tab: Category) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    // If we don't have results for this tab yet (e.g. failed or not started), we could retry
    if (hasSearched && resultsMap[tab].length === 0 && !loadingMap[tab]) {
      handleSearch(undefined, tab);
    }
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setShowToast(true);
    setTimeout(() => {
      setCopiedUrl(null);
      setShowToast(false);
    }, 2000);
  };

  const currentAggregations = aggregationsMap[activeTab];

  return (
    <div className="min-h-screen relative font-sans selection:bg-neon-cyan/30 overflow-x-hidden">
      {/* Global Noise Overlay */}
      <div className="fixed inset-0 pointer-events-none z-[100] opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      
      {/* Scanline Effect */}
      <div className="fixed inset-0 pointer-events-none z-[90] opacity-[0.02] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      
      {/* Background Elements */}
      <div className="blob blob-1 scale-150 blur-[120px]" />
      <div className="blob blob-2 scale-150 blur-[120px]" />
      <div className="fixed inset-0 bg-[#050505] -z-20" />

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] glass px-6 py-3 rounded-2xl border-neon-cyan/30 flex items-center gap-3 shadow-[0_0_50px_rgba(0,243,255,0.2)]"
          >
            <Check className="text-neon-cyan" size={16} />
            <span className="text-white font-bold text-sm tracking-tight">Link copied to clipboard</span>
          </motion.div>
        )}
      </AnimatePresence>

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
        <div className="w-full max-w-2xl flex flex-col gap-4 relative z-50">
          <motion.form 
            layout
            onSubmit={(e) => handleSearch(e)}
            className={cn(
              "w-full glass rounded-2xl p-1.5 flex items-center gap-2 transition-all duration-500",
              "focus-within:ring-1 focus-within:ring-white/20 focus-within:shadow-[0_0_50px_-12px_rgba(0,243,255,0.3)]"
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
              onFocus={() => query.length >= 2 && setShowSuggestions(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search the decentralized web..."
              className="flex-1 bg-transparent border-none outline-none py-4 text-lg text-white placeholder:text-white/10"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSuggestions([]);
                  setShowSuggestions(false);
                  inputRef.current?.focus();
                }}
                className="p-2 text-white/20 hover:text-white/60 transition-colors"
              >
                <X size={18} />
              </button>
            )}
            <button
              type="submit"
              disabled={loadingMap.general && loadingMap.images && loadingMap.videos}
              className="bg-white text-black px-8 py-3.5 rounded-xl font-bold hover:bg-neon-cyan hover:text-black transition-all duration-500 disabled:opacity-50 active:scale-95 shadow-lg group relative overflow-hidden"
            >
              <span className="relative z-10">
                {(loadingMap.general || loadingMap.images || loadingMap.videos) ? <Loader2 className="animate-spin" /> : "Search"}
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan to-neon-purple opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </button>
          </motion.form>

          {/* Suggestions Dropdown */}
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div
                ref={suggestionsRef}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full left-0 right-0 mt-2 glass rounded-2xl overflow-hidden border border-white/10 shadow-2xl z-[100]"
              >
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onMouseEnter={() => setSuggestionIndex(i)}
                    onClick={() => {
                      setQuery(suggestion);
                      setShowSuggestions(false);
                      // Trigger search immediately
                      const fakeEvent = { preventDefault: () => {} } as FormEvent;
                      // We need to use the new query value directly because state update is async
                      setTimeout(() => handleSearch(fakeEvent), 0);
                    }}
                    className={cn(
                      "w-full text-left px-6 py-3 text-white/80 transition-colors flex items-center gap-3 border-b border-white/5 last:border-none",
                      suggestionIndex === i ? "bg-white/10 text-neon-cyan" : "hover:bg-white/5"
                    )}
                  >
                    <Search size={14} className={cn("transition-colors", suggestionIndex === i ? "text-neon-cyan" : "text-white/20")} />
                    <span className="font-medium">{suggestion}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          
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
              className="w-full max-w-[1400px] mt-12 mb-32"
            >
              {/* Tabs & Stats Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 border-b border-white/5 pb-6">
                <div className="flex gap-2 p-1 glass rounded-xl">
                  {[
                    { id: 'general', label: 'Web', icon: Globe },
                    { id: 'images', label: 'Images', icon: ImageIcon },
                    { id: 'videos', label: 'Videos', icon: Video },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id as Category)}
                      className={cn(
                        "flex items-center gap-2 px-5 py-2.5 rounded-lg transition-all duration-300 font-bold text-sm",
                        activeTab === tab.id 
                          ? "bg-white/10 text-neon-cyan neon-text-cyan shadow-[0_0_20px_rgba(0,243,255,0.1)]" 
                          : "text-white/30 hover:text-white/60 hover:bg-white/5"
                      )}
                    >
                      <tab.icon size={16} />
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                {currentAggregations && !loadingMap[activeTab] && (
                  <div className="hidden md:flex items-center gap-4 px-4 py-2 glass rounded-xl border-white/5">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-black tracking-widest uppercase text-white/20">Latency</span>
                      <span className="text-xs font-mono text-neon-cyan">{currentAggregations.time}s</span>
                    </div>
                    <div className="w-px h-8 bg-white/10" />
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-black tracking-widest uppercase text-white/20">Nodes</span>
                      <span className="text-xs font-mono text-white/80">{currentAggregations.engines.length || 1}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10 items-start">
                
                {/* Left Column: Results */}
                <div className="space-y-8 min-w-0">
                  {/* Mobile Summary (shown only on small screens) */}
                  {summary && activeTab === 'general' && !loadingMap['general'] && (
                    <div className="lg:hidden">
                      <SummaryCard summary={summary} />
                    </div>
                  )}

                  <div className="relative min-h-[400px]">
                    {(['general', 'images', 'videos'] as Category[]).map((cat) => (
                      <div 
                        key={cat}
                        className={cn(
                          "w-full transition-all duration-500 ease-in-out",
                          activeTab === cat ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 absolute top-0 left-0 translate-x-12 pointer-events-none"
                        )}
                      >
                        {/* Error State for this tab */}
                        {errorMap[cat] && !loadingMap[cat] && resultsMap[cat].length === 0 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="glass border-red-500/30 p-10 rounded-3xl text-center mb-10"
                          >
                            <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                              <Search size={32} className="text-red-500" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2 text-white">Search Interrupted</h3>
                            <p className="text-white/60 max-w-md mx-auto mb-8">{errorMap[cat]}</p>
                            <button 
                              onClick={() => handleSearch(undefined, cat)}
                              className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-neon-cyan transition-all flex items-center justify-center gap-2 mx-auto"
                            >
                              <Loader2 className={cn("w-4 h-4", loadingMap[cat] && "animate-spin")} />
                              Try Again
                            </button>
                          </motion.div>
                        )}

                        {/* Loading State for this tab */}
                        {loadingMap[cat] && (
                          <div className={cn(
                            "grid gap-6",
                            cat === 'images' 
                              ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" 
                              : "grid-cols-1"
                          )}>
                            {Array.from({ length: 12 }).map((_, i) => (
                              <div key={i} className={cn(
                                "glass rounded-2xl animate-pulse overflow-hidden",
                                cat === 'images' ? "aspect-square" : "p-6 h-48"
                              )}>
                                <div className="w-full h-full bg-white/5" />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Results List for this tab */}
                        {!loadingMap[cat] && resultsMap[cat].length > 0 && (
                          <div className={cn(
                            "grid gap-6",
                            cat === 'images' 
                              ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" 
                              : "grid-cols-1"
                          )}>
                            {resultsMap[cat].map((result, idx) => (
                              <motion.div
                                key={`${cat}-${idx}-${result.url}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                                className={cn(
                                  "glass rounded-2xl hover:border-white/20 transition-all group overflow-hidden",
                                  cat === 'images' ? "p-0" : "p-5 md:p-7"
                                )}
                              >
                                {cat === 'images' ? (
                                  <div className="relative aspect-square">
                                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                                      <img 
                                        src={result.thumbnail || result.url} 
                                        alt={result.title}
                                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        referrerPolicy="no-referrer"
                                        loading="lazy"
                                        onError={(e) => { (e.target as HTMLImageElement).src = "https://picsum.photos/seed/error/400/400?blur=10"; }}
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
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end pointer-events-none">
                                      <p className="text-white text-[10px] font-bold line-clamp-2 leading-tight">{result.title}</p>
                                      <p className="text-white/60 text-[8px] uppercase tracking-tighter mt-1">{result.metadata?.domain}</p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col sm:flex-row gap-6 relative">
                                    {result.thumbnail && (
                                      <div className="w-full sm:w-32 md:w-44 h-44 sm:h-32 md:h-44 flex-shrink-0 rounded-xl overflow-hidden border border-white/10 relative group-hover:border-neon-cyan/30 transition-colors">
                                        <img src={result.thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        {cat === 'videos' && (
                                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                                            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/30 group-hover:scale-110 transition-transform">
                                              <Play size={24} fill="currentColor" />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2 mb-3">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                          {result.favicon && <img src={result.favicon} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" referrerPolicy="no-referrer" />}
                                          <p className="text-white/30 text-[10px] font-black tracking-[0.2em] uppercase truncate">
                                            {result.metadata?.domain || "web"}
                                            {result.metadata?.engine && ` • ${result.metadata.engine}`}
                                          </p>
                                        </div>
                                        <button onClick={() => copyToClipboard(result.url)} className="text-white/10 hover:text-neon-cyan transition-colors flex-shrink-0">
                                          {copiedUrl === result.url ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                      </div>
                                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-xl md:text-2xl font-black text-neon-cyan hover:underline flex items-center gap-2 mb-3 group-hover:neon-text-cyan transition-all line-clamp-2 tracking-tight">
                                        {result.title}
                                        <ExternalLink size={16} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                      </a>
                                      <p className="text-white/60 leading-relaxed line-clamp-2 md:line-clamp-3 text-sm md:text-base font-medium">{result.snippet}</p>
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            ))}
                          </div>
                        )}

                        {/* Empty State for this tab */}
                        {!loadingMap[cat] && resultsMap[cat].length === 0 && !errorMap[cat] && hasSearched && activeTab === cat && (
                          <div className="text-center py-32 glass rounded-3xl">
                            <p className="text-white/40 text-xl font-bold">No results found for "{lastSearch.query}"</p>
                            <p className="text-white/20 text-sm mt-3">Try adjusting your search terms or filters</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column: Sidebar (Desktop Only) */}
                <aside className="hidden lg:block sticky top-8 space-y-8">
                  {summary && activeTab === 'general' && !loadingMap['general'] && (
                    <SummaryCard summary={summary} />
                  )}

                  {/* Quick Stats Card */}
                  <div className="glass p-8 rounded-3xl border-white/5">
                    <h3 className="text-white/20 text-[10px] font-black tracking-[0.3em] uppercase mb-6">Search Intelligence</h3>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <span className="text-white/40 text-sm">Safe Search</span>
                        <span className={cn("text-xs font-bold px-2 py-1 rounded-md", safeSearch ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>
                          {safeSearch ? "ACTIVE" : "DISABLED"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-white/40 text-sm">Privacy Shield</span>
                        <span className="text-xs font-bold px-2 py-1 rounded-md bg-neon-cyan/10 text-neon-cyan">ENCRYPTED</span>
                      </div>
                      <div className="pt-6 border-t border-white/5">
                        <p className="text-white/30 text-[10px] leading-relaxed italic">
                          Spark Search aggregates results from multiple decentralized nodes to ensure your identity remains protected.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Engine Distribution */}
                  {currentAggregations && currentAggregations.engines.length > 0 && (
                    <div className="glass p-8 rounded-3xl border-white/5">
                      <h3 className="text-white/20 text-[10px] font-black tracking-[0.3em] uppercase mb-6">Node Distribution</h3>
                      <div className="flex flex-wrap gap-2">
                        {currentAggregations.engines.map((engine, i) => (
                          <span key={i} className="px-3 py-1.5 glass rounded-lg text-[10px] font-bold text-white/50 border-white/5">
                            {engine}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Actions */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            onClick={scrollToTop}
            className="fixed bottom-32 right-8 p-4 glass rounded-2xl text-neon-cyan hover:bg-neon-cyan/10 transition-all z-50 shadow-[0_0_30px_rgba(0,243,255,0.2)] border border-neon-cyan/20 group"
          >
            <Search className="rotate-180 group-hover:-translate-y-1 transition-transform" size={24} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 w-full p-8 text-center glass-strong border-t border-white/5 pointer-events-none z-[60]">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent -z-10" />
        <p className="text-white/20 text-[10px] font-bold tracking-[0.3em] uppercase">
          Powered by <span className="text-neon-cyan neon-text-cyan">Vayu AGI</span> • Privacy First Search
        </p>
      </footer>
    </div>
  );
}
