"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";

type MatchState = "upload" | "analyzing" | "results";
type MatchVerdict = "works-beautifully" | "could-work" | "doesnt-work";

interface MatchResult {
  verdict: MatchVerdict;
  explanation: string;
  compositeImage?: string;
}

// Colour and texture keywords used to highlight the key match reasoning
const REASONING_TERMS = [
  "white", "cream", "ivory", "beige", "taupe", "sand", "stone", "greige", "grey", "gray",
  "charcoal", "black", "navy", "blue", "teal", "green", "sage", "olive", "terracotta",
  "rust", "pink", "blush", "mustard", "yellow", "gold", "brown", "tan", "natural", "warm",
  "cool", "neutral", "tone", "tones", "tonal", "palette", "linen", "cotton", "velvet",
  "wool", "knit", "waffle", "silk", "jute", "seagrass", "rattan", "boucle", "bouclé",
  "textured", "texture", "textures", "matte", "woven", "chunky", "soft",
];

const REASONING_TERM_SET = new Set(REASONING_TERMS);

function highlightReasoning(text: string) {
  const pattern = new RegExp(`\\b(${REASONING_TERMS.join("|")})\\b`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    REASONING_TERM_SET.has(part.toLowerCase()) ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function MatchPage() {
  const [matchState, setMatchState] = useState<MatchState>("upload");
  const [bedImage, setBedImage] = useState<string | null>(null);
  const [itemImage, setItemImage] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_OUTPUT_SIZE = 1024 * 1024;
  const MAX_DIMENSION = 1200;

  const compressImage = useCallback((dataUrl: string, maxDimension: number, quality: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const timeout = setTimeout(() => {
        reject(new Error('Image processing timed out. Please try a different photo.'));
      }, 15000);
      
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > height && width > maxDimension) {
            height = (height * maxDimension) / width;
            width = maxDimension;
          } else if (height > maxDimension) {
            width = (width * maxDimension) / height;
            height = maxDimension;
          }

          canvas.width = Math.round(width);
          canvas.height = Math.round(height);

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to create canvas context.');
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to compress image.'));
        }
      };

      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load the image. The format may not be supported by your browser.'));
      };

      img.src = dataUrl;
    });
  }, []);

  const ensureUnderSizeLimit = useCallback(async (dataUrl: string): Promise<string> => {
    const base64Length = dataUrl.length - dataUrl.indexOf(',') - 1;
    const estimatedBytes = (base64Length * 3) / 4;
    
    if (estimatedBytes <= MAX_OUTPUT_SIZE) {
      return dataUrl;
    }
    
    let quality = 0.7;
    let result = dataUrl;
    
    while (quality >= 0.3) {
      result = await compressImage(dataUrl, MAX_DIMENSION, quality);
      const newBase64Length = result.length - result.indexOf(',') - 1;
      const newEstimatedBytes = (newBase64Length * 3) / 4;
      
      if (newEstimatedBytes <= MAX_OUTPUT_SIZE) {
        return result;
      }
      quality -= 0.1;
    }
    
    return compressImage(dataUrl, 800, 0.5);
  }, [compressImage]);

  const processImageFile = useCallback(async (file: File): Promise<string> => {
    setUploadError(null);
    setIsProcessingImage(true);

    try {
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`Image too large. Please use an image under 20MB. Your image is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
      }

      const fileName = file.name.toLowerCase();
      const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || 
                     file.type === 'image/heic' || file.type === 'image/heif';
      const isValidType = file.type.startsWith('image/') || isHeic;
      
      if (!isValidType) {
        throw new Error('Please upload an image file (JPG, PNG, HEIC, or WebP).');
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        
        const timeout = setTimeout(() => {
          reject(new Error('Reading image timed out. Please try again.'));
        }, 30000);
        
        reader.onload = (event) => {
          clearTimeout(timeout);
          const result = event.target?.result as string;
          if (!result) {
            reject(new Error('Failed to read image file.'));
          } else {
            resolve(result);
          }
        };

        reader.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Failed to read the image. Please try another photo.'));
        };

        reader.readAsDataURL(file);
      });

      const compressed = await compressImage(dataUrl, MAX_DIMENSION, 0.85);
      const finalImage = await ensureUnderSizeLimit(compressed);
      
      return finalImage;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to process image.');
    } finally {
      setIsProcessingImage(false);
    }
  }, [compressImage, ensureUnderSizeLimit]);

  const analyzeMatch = async () => {
    if (!bedImage || !itemImage) return;

    setMatchState("analyzing");
    setError(null);

    abortControllerRef.current = new AbortController();

    const timeoutId = setTimeout(() => {
      abortControllerRef.current?.abort();
    }, 60000);

    try {
      const response = await fetch("/api/match-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bedImage, itemImage }),
        signal: abortControllerRef.current.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Analysis failed (${response.status}). Please try again.`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setMatchResult(data);
      setMatchState("results");
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis timed out. Please check your connection and try again.");
        setMatchState("upload");
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      setMatchState("upload");
    }
  };

  const startOver = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMatchState("upload");
    setBedImage(null);
    setItemImage(null);
    setMatchResult(null);
    setError(null);
    setUploadError(null);
  };

  // Upload Screen
  if (matchState === "upload") {
    const handleBedSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const imageData = await processImageFile(file);
          setBedImage(imageData);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
        }
      }
      e.target.value = '';
    };

    const handleItemSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const imageData = await processImageFile(file);
          setItemImage(imageData);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
        }
      }
      e.target.value = '';
    };

    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-x-hidden">
        <div className="w-full max-w-2xl">
          <Link
            href="/"
            className="mb-6 sm:mb-8 min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors font-light flex items-center"
          >
            &larr; Back to Bedscape Editor
          </Link>

          <h1 className="font-serif text-foreground text-center mb-2 italic" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)' }}>
            Does it match?
          </h1>
          <p className="text-center text-muted-foreground font-light mb-8 sm:mb-12 text-sm sm:text-base">
            Upload both photos and we&apos;ll tell you if they work together
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {/* Bed Photo Upload */}
            <div className={`border-2 border-dashed p-4 transition-all ${bedImage ? 'border-primary bg-primary/5' : 'border-border'}`}>
              {bedImage ? (
                <div className="relative aspect-square">
                  <img
                    src={bedImage}
                    alt="Your bed"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setBedImage(null)}
                    className="absolute top-2 right-2 w-8 h-8 bg-background/90 hover:bg-background text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center text-xl"
                  >
                    &times;
                  </button>
                  <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                    Your Bed
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center aspect-square cursor-pointer">
                  <div className="w-12 h-12 mb-4 text-muted-foreground/40">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                      <rect x="2" y="10" width="20" height="10" rx="1" />
                      <path d="M4 10V6a2 2 0 012-2h12a2 2 0 012 2v4" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground mb-1">Your bed at home</span>
                  <span className="text-xs text-muted-foreground">Tap to upload</span>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={handleBedSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Item Photo Upload */}
            <div className={`border-2 border-dashed p-4 transition-all ${itemImage ? 'border-primary bg-primary/5' : 'border-border'}`}>
              {itemImage ? (
                <div className="relative aspect-square">
                  <img
                    src={itemImage}
                    alt="Item you're considering"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setItemImage(null)}
                    className="absolute top-2 right-2 w-8 h-8 bg-background/90 hover:bg-background text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center text-xl"
                  >
                    &times;
                  </button>
                  <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                    Considering
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center aspect-square cursor-pointer">
                  <div className="w-12 h-12 mb-4 text-muted-foreground/40">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground mb-1">The item you&apos;re considering</span>
                  <span className="text-xs text-muted-foreground">Tap to upload</span>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={handleItemSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="mt-8 sm:mt-10 text-center">
            <button
              onClick={analyzeMatch}
              disabled={!bedImage || !itemImage}
              className={`
                px-8 sm:px-10 min-h-[48px] py-3 font-medium tracking-wide transition-all text-base
                ${
                  bedImage && itemImage
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }
              `}
            >
              Check the Match
            </button>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
          )}

          {uploadError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 text-sm text-red-700">
              {uploadError}
            </div>
          )}
        </div>
      </main>
    );
  }

  // Analyzing Screen
  if (matchState === "analyzing") {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 overflow-x-hidden">
        <div className="text-center w-full max-w-md">
          <div className="relative w-12 sm:w-16 h-12 sm:h-16 mx-auto mb-8 sm:mb-10">
            <div className="absolute inset-0 border border-border rounded-full" />
            <div className="absolute inset-0 border border-transparent border-t-primary rounded-full animate-spin" style={{ animationDuration: '1.5s' }} />
          </div>
          <p className="font-serif text-foreground italic px-4" style={{ fontSize: 'clamp(1.25rem, 5vw, 1.875rem)' }}>
            Comparing colours and textures...
          </p>
        </div>
      </main>
    );
  }

  // Results Screen
  if (matchState === "results" && matchResult) {
    const verdictConfig = {
      'works-beautifully': {
        label: 'Works beautifully',
        color: 'text-green-700',
        bg: 'bg-green-50',
        border: 'border-green-200',
        badgeLabel: 'Strong match',
        badgeBg: 'bg-green-100',
        badgeText: 'text-green-800',
        dot: 'bg-green-600'
      },
      'could-work': {
        label: 'Could work',
        color: 'text-amber-700',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        badgeLabel: 'Partial match',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-800',
        dot: 'bg-amber-500'
      },
      'doesnt-work': {
        label: "Doesn't quite work",
        color: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        badgeLabel: 'Weak match',
        badgeBg: 'bg-red-100',
        badgeText: 'text-red-800',
        dot: 'bg-red-600'
      }
    };

    const config = verdictConfig[matchResult.verdict];

    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-x-hidden">
        <div className="w-full max-w-2xl">
          <h2 className="font-serif text-foreground text-center mb-8 sm:mb-12 italic" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)' }}>
            The Verdict
          </h2>

          {/* Composite Image - How it could look */}
          {matchResult.compositeImage && (
            <div className="mb-8">
              <p className="text-sm text-muted-foreground font-light text-center mb-3">
                How it could look
              </p>
              <div className="relative aspect-square max-w-md mx-auto border border-border overflow-hidden">
                <img 
                  src={matchResult.compositeImage} 
                  alt="How the item could look on your bed" 
                  className="w-full h-full object-cover" 
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8">
            <div className="relative aspect-square border border-border overflow-hidden">
              {bedImage && (
                <img src={bedImage} alt="Your bed" className="w-full h-full object-cover" />
              )}
              <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                Your Bed
              </div>
            </div>
            <div className="relative aspect-square border border-border overflow-hidden">
              {itemImage && (
                <img src={itemImage} alt="Item considered" className="w-full h-full object-cover" />
              )}
              <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                Considering
              </div>
            </div>
          </div>

          <div className={`p-6 sm:p-10 border ${config.border} ${config.bg}`}>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <h3 className={`font-serif ${config.color}`} style={{ fontSize: 'clamp(2rem, 8vw, 3.5rem)', fontWeight: 600 }}>
                {config.label}
              </h3>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium font-sans ${config.badgeBg} ${config.badgeText}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                {config.badgeLabel}
              </span>
            </div>
            <p className="font-sans text-foreground/80 font-light leading-relaxed text-base sm:text-lg text-left w-full sm:w-[65%]">
              {highlightReasoning(matchResult.explanation)}
            </p>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={startOver}
              className="min-h-[48px] px-8 py-3 bg-primary text-primary-foreground font-medium tracking-wide hover:opacity-90 transition-opacity"
            >
              Try Another Match
            </button>
            <Link
              href="/"
              className="min-h-[44px] px-4 py-2 text-muted-foreground hover:text-foreground transition-colors font-light"
            >
              Back to Bedscape Editor
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return null;
}
