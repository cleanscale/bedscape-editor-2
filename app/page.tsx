"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type AppState = "landing" | "quiz" | "upload" | "analyzing" | "results" | "match-upload" | "match-analyzing" | "match-results";

type Aesthetic = "minimal" | "coastal" | "cosy" | "luxe" | "boho";
type BudgetRange = "under-100" | "100-250" | "250-500" | "500-plus";
type MatchVerdict = "works-beautifully" | "could-work" | "doesnt-work";

interface QuizAnswers {
  aesthetic: Aesthetic | null;
  budget: BudgetRange | null;
}

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

interface Product {
  name: string;
  price: string;
  url: string;
}

interface StyleResult {
  name: string;
  description: string;
  palette: string[];
  whatToAdd: string[];
  whatToChange: string[];
  products?: Product[];
}

const loadingMessages = [
  "Reading your colours...",
  "Analysing your layers...",
  "Crafting your looks...",
];

export default function Home() {
  const [appState, setAppState] = useState<AppState>("landing");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [styleResults, setStyleResults] = useState<StyleResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswers>({
    aesthetic: null,
    budget: null,
  });
  const [quizStep, setQuizStep] = useState(1);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [matchBedImage, setMatchBedImage] = useState<string | null>(null);
  const [matchItemImage, setMatchItemImage] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [email, setEmail] = useState("");
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit for raw files (will be compressed)
  const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB max for API
  const MAX_DIMENSION = 1200; // Max 1200px on longest side

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

          // Scale to max dimension on longest side
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

          // Use better quality settings
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // Always output as JPEG for compatibility
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
    // Check base64 size (roughly 4/3 of actual data)
    const base64Length = dataUrl.length - dataUrl.indexOf(',') - 1;
    const estimatedBytes = (base64Length * 3) / 4;
    
    if (estimatedBytes <= MAX_OUTPUT_SIZE) {
      return dataUrl;
    }
    
    // Need to compress more aggressively
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
    
    // Last resort: reduce dimensions further
    return compressImage(dataUrl, 800, 0.5);
  }, [compressImage]);

  const processImageFile = useCallback(async (file: File): Promise<string> => {
    setUploadError(null);
    setIsProcessingImage(true);

    try {
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`Image too large. Please use an image under 20MB. Your image is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
      }

      // Check if it's an image (including HEIC)
      const fileName = file.name.toLowerCase();
      const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || 
                     file.type === 'image/heic' || file.type === 'image/heif';
      const isValidType = file.type.startsWith('image/') || isHeic;
      
      if (!isValidType) {
        throw new Error('Please upload an image file (JPG, PNG, HEIC, or WebP).');
      }

      // Read the file
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

      // Always compress and convert to JPEG for consistency
      // This handles HEIC conversion on browsers that support it natively
      const compressed = await compressImage(dataUrl, MAX_DIMENSION, 0.85);
      
      // Ensure we're under the size limit
      const finalImage = await ensureUnderSizeLimit(compressed);
      
      return finalImage;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to process image.');
    } finally {
      setIsProcessingImage(false);
    }
  }, [compressImage, ensureUnderSizeLimit]);

  useEffect(() => {
    if (appState === "analyzing") {
      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 1800);

      return () => {
        clearInterval(interval);
      };
    }
  }, [appState]);

  const analyzeImage = async () => {
    if (!uploadedImage) return;

    setAppState("analyzing");
    setError(null);
    setLoadingMessageIndex(0);

    abortControllerRef.current = new AbortController();

    // Set a 60 second timeout for the API call
    const timeoutId = setTimeout(() => {
      abortControllerRef.current?.abort();
    }, 60000);

    try {
      const response = await fetch("/api/analyze-bed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: uploadedImage, preferences: quizAnswers }),
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

      if (!data.styles || data.styles.length === 0) {
        throw new Error("No styling recommendations received. Please try with a different photo.");
      }

      setStyleResults(data.styles);
      setAppState("results");
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis timed out. Please check your connection and try again.");
        setAppState("upload");
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      setAppState("upload");
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      try {
        const imageData = await processImageFile(file);
        setUploadedImage(imageData);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
      }
    }
  }, [processImageFile]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const imageData = await processImageFile(file);
          setUploadedImage(imageData);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
        }
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [processImageFile]
  );

  const startOver = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setAppState("landing");
    setUploadedImage(null);
    setLoadingMessageIndex(0);
    setStyleResults([]);
    setError(null);
    setUploadError(null);
    setQuizAnswers({ aesthetic: null, budget: null });
    setQuizStep(1);
    setMatchBedImage(null);
    setMatchItemImage(null);
    setMatchResult(null);
    setEmail("");
    setEmailSubmitted(false);
  };

  const analyzeMatch = async () => {
    if (!matchBedImage || !matchItemImage) return;

    setAppState("match-analyzing");
    setError(null);
    setLoadingMessageIndex(0);

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
        body: JSON.stringify({ bedImage: matchBedImage, itemImage: matchItemImage }),
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
      setAppState("match-results");
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis timed out. Please check your connection and try again.");
        setAppState("match-upload");
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      setAppState("match-upload");
    }
  };

  // Landing Screen
  if (appState === "landing") {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 overflow-x-hidden">
        <div className="text-center max-w-xl w-full">
          <h1 className="font-serif text-foreground tracking-tight leading-tight" style={{ fontSize: 'clamp(2.25rem, 8vw, 4.5rem)' }}>
            The Bedscape
            <br />
            <span className="italic font-normal">Editor</span>
          </h1>

          <p className="mt-6 sm:mt-8 text-muted-foreground font-light tracking-wide" style={{ fontSize: 'clamp(1rem, 3vw, 1.25rem)' }}>
            Upload your bed. We&apos;ll style it.
          </p>

          <button
            onClick={() => setAppState("upload")}
            className="mt-10 sm:mt-12 px-8 sm:px-10 min-h-[48px] py-3 bg-primary text-primary-foreground font-medium tracking-wide hover:opacity-90 transition-opacity text-base"
          >
            Style My Bed
          </button>
        </div>

        <footer className="absolute bottom-6 sm:bottom-8 text-sm text-muted-foreground font-light px-4 text-center">
          A curated approach to bedroom styling
        </footer>
      </main>
    );
  }

  // Quiz Screen
  if (appState === "quiz") {
    const aestheticOptions: { value: Aesthetic; label: string; description: string }[] = [
      { value: "minimal", label: "Quiet & Considered", description: "Crisp whites, clean lines, breathing room" },
      { value: "coastal", label: "Breezy & Barefoot", description: "Light linens, natural textures, that beach house feeling" },
      { value: "cosy", label: "Wrapped in Warmth", description: "Soft layers, rich tones, made for slow mornings" },
      { value: "luxe", label: "Boutique Elegance", description: "Hotel-worthy details, sumptuous fabrics, quiet luxury" },
      { value: "boho", label: "Collected & Eclectic", description: "Artful layers, global textures, perfectly imperfect" },
    ];

    const budgetOptions: { value: BudgetRange; label: string }[] = [
      { value: "under-100", label: "Under $150 NZD" },
      { value: "100-250", label: "$150 - $400 NZD" },
      { value: "250-500", label: "$400 - $800 NZD" },
      { value: "500-plus", label: "$800+ NZD" },
    ];

    const canProceed =
      (quizStep === 1 && quizAnswers.aesthetic) ||
      (quizStep === 2 && quizAnswers.budget);

    const handleNext = () => {
      if (quizStep < 2) {
        setQuizStep(quizStep + 1);
      } else {
        analyzeImage();
      }
    };
    
    const handleBack = () => {
      if (quizStep > 1) {
        setQuizStep(quizStep - 1);
      } else {
        setAppState("upload");
      }
    };

    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-x-hidden">
        <div className="w-full max-w-lg">
          <button
            onClick={handleBack}
            className="mb-6 sm:mb-8 min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors font-light flex items-center"
          >
            &larr; Back
          </button>

          {/* Progress indicator */}
          <div className="flex gap-2 mb-8 sm:mb-12 justify-center">
            {[1, 2].map((step) => (
              <div
                key={step}
                className={`w-10 sm:w-12 h-1 transition-colors ${
                  step <= quizStep ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>

          {/* Question 1: Aesthetic */}
          {quizStep === 1 && (
            <div className="text-center">
              <h2 className="font-serif text-foreground mb-3 italic" style={{ fontSize: 'clamp(1.5rem, 5vw, 1.875rem)' }}>
                How do you want to feel?
              </h2>
              <p className="text-muted-foreground font-light mb-8 sm:mb-10 text-sm sm:text-base">
                Choose the mood that calls to you
              </p>
              <div className="grid grid-cols-1 gap-3">
                {aestheticOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() =>
                      setQuizAnswers({ ...quizAnswers, aesthetic: option.value })
                    }
                    className={`min-h-[64px] py-4 px-5 border transition-all text-left ${
                      quizAnswers.aesthetic === option.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <span className={`block font-medium text-base ${
                      quizAnswers.aesthetic === option.value ? "text-foreground" : "text-foreground/80"
                    }`}>
                      {option.label}
                    </span>
                    <span className="block text-sm text-muted-foreground font-light mt-1">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question 2: Budget */}
          {quizStep === 2 && (
            <div className="text-center">
              <h2 className="font-serif text-foreground mb-3 italic" style={{ fontSize: 'clamp(1.5rem, 5vw, 1.875rem)' }}>
                What&apos;s your budget?
              </h2>
              <p className="text-muted-foreground font-light mb-8 sm:mb-10 text-sm sm:text-base">
                We&apos;ll tailor recommendations to fit
              </p>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {budgetOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() =>
                      setQuizAnswers({ ...quizAnswers, budget: option.value })
                    }
                    className={`min-h-[48px] py-3 px-4 sm:px-6 border transition-all text-sm font-medium ${
                      quizAnswers.budget === option.value
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:border-primary/50 text-muted-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Next button */}
          <div className="mt-8 sm:mt-12 text-center">
            <button
              onClick={handleNext}
              disabled={!canProceed}
              className={`px-8 sm:px-10 min-h-[48px] py-3 font-medium tracking-wide transition-all text-base ${
                canProceed
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {quizStep === 2 ? "Analyse My Bed" : "Next"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Upload Screen
  if (appState === "upload") {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-x-hidden">
        <div className="w-full max-w-2xl">
          <button
            onClick={startOver}
            className="mb-6 sm:mb-8 min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors font-light flex items-center"
          >
            &larr; Back
          </button>

          <h2 className="font-serif text-foreground text-center mb-8 sm:mb-12 italic" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)' }}>
            Let&apos;s see your space
          </h2>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative border-2 border-dashed transition-all duration-300
              ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }
              ${uploadedImage ? "p-3 sm:p-4" : "p-8 sm:p-16 md:p-24"}
            `}
          >
            {uploadedImage ? (
              <div className="relative">
                <img
                  src={uploadedImage}
                  alt="Uploaded bed"
                  className="w-full h-auto max-h-[400px] object-contain mx-auto"
                />
                <button
                  onClick={() => setUploadedImage(null)}
                  className="absolute top-2 right-2 w-8 h-8 bg-background/90 hover:bg-background text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center text-xl"
                >
                  &times;
                </button>
              </div>
            ) : isProcessingImage ? (
              <div className="flex flex-col items-center py-8">
                <div className="w-10 h-10 border border-border border-t-primary rounded-full animate-spin mb-4" />
                <span className="text-muted-foreground font-light">Processing image...</span>
              </div>
            ) : (
              <label className="flex flex-col items-center cursor-pointer">
                <div className="w-16 h-16 mb-6 text-muted-foreground/40">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="2" y="10" width="20" height="10" rx="1" />
                    <path d="M4 10V6a2 2 0 012-2h12a2 2 0 012 2v4" />
                    <circle cx="7" cy="15" r="1.5" />
                    <circle cx="17" cy="15" r="1.5" />
                    <path d="M9 10h6" />
                  </svg>
                </div>
                <span className="text-foreground font-medium mb-2">
                  Drop your bed photo here
                </span>
                <span className="text-sm text-muted-foreground font-light mb-1">
                  or click to browse
                </span>
                <span className="text-xs text-muted-foreground/70 font-light">
                  JPG, PNG, HEIC up to 10MB
                </span>
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <div className="mt-8 sm:mt-10 text-center">
            <button
              onClick={() => setAppState("quiz")}
              disabled={!uploadedImage}
              className={`
                px-8 sm:px-10 min-h-[48px] py-3 font-medium tracking-wide transition-all text-base
                ${
                  uploadedImage
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }
              `}
            >
              Continue to Style Quiz
            </button>

            {error && (
              <p className="mt-4 text-sm text-red-600">{error}</p>
            )}

            {uploadError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 text-sm text-red-700">
                {uploadError}
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Match Upload Screen
  if (appState === "match-upload") {
    const handleMatchBedSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const imageData = await processImageFile(file);
          setMatchBedImage(imageData);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
        }
      }
      e.target.value = '';
    };

    const handleMatchItemSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const imageData = await processImageFile(file);
          setMatchItemImage(imageData);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to process image.');
        }
      }
      e.target.value = '';
    };

    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-x-hidden">
        <div className="w-full max-w-2xl">
          <button
            onClick={startOver}
            className="mb-6 sm:mb-8 min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors font-light flex items-center"
          >
            &larr; Back
          </button>

          <h2 className="font-serif text-foreground text-center mb-2 italic" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)' }}>
            Does it match?
          </h2>
          <p className="text-center text-muted-foreground font-light mb-8 sm:mb-12 text-sm sm:text-base">
            Upload both photos and we&apos;ll tell you if they work together
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {/* Bed Photo Upload */}
            <div className={`border-2 border-dashed p-4 transition-all ${matchBedImage ? 'border-primary bg-primary/5' : 'border-border'}`}>
              {matchBedImage ? (
                <div className="relative aspect-square">
                  <img
                    src={matchBedImage}
                    alt="Your bed"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setMatchBedImage(null)}
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
                    onChange={handleMatchBedSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Item Photo Upload */}
            <div className={`border-2 border-dashed p-4 transition-all ${matchItemImage ? 'border-primary bg-primary/5' : 'border-border'}`}>
              {matchItemImage ? (
                <div className="relative aspect-square">
                  <img
                    src={matchItemImage}
                    alt="Item you're considering"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setMatchItemImage(null)}
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
                    onChange={handleMatchItemSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="mt-8 sm:mt-10 text-center">
            <button
              onClick={analyzeMatch}
              disabled={!matchBedImage || !matchItemImage}
              className={`
                px-8 sm:px-10 min-h-[48px] py-3 font-medium tracking-wide transition-all text-base
                ${
                  matchBedImage && matchItemImage
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

  // Match Analyzing Screen
  if (appState === "match-analyzing") {
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

  // Match Results Screen
  if (appState === "match-results" && matchResult) {
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
              {matchBedImage && (
                <img src={matchBedImage} alt="Your bed" className="w-full h-full object-cover" />
              )}
              <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                Your Bed
              </div>
            </div>
            <div className="relative aspect-square border border-border overflow-hidden">
              {matchItemImage && (
                <img src={matchItemImage} alt="Item considered" className="w-full h-full object-cover" />
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

          <div className="mt-10 text-center">
            <button
              onClick={startOver}
              className="min-h-[44px] px-4 py-2 text-muted-foreground hover:text-foreground transition-colors font-light"
            >
              Start over
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Analyzing Screen
  if (appState === "analyzing") {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4 sm:px-6 overflow-x-hidden">
        <div className="text-center w-full max-w-md">
          {/* Gentle Spinner */}
          <div className="relative w-12 sm:w-16 h-12 sm:h-16 mx-auto mb-8 sm:mb-10">
            <div className="absolute inset-0 border border-border rounded-full" />
            <div className="absolute inset-0 border border-transparent border-t-primary rounded-full animate-spin" style={{ animationDuration: '1.5s' }} />
          </div>

          {/* Rotating Message */}
          <p
            key={loadingMessageIndex}
            className="font-serif text-foreground italic animate-fade-in px-4" style={{ fontSize: 'clamp(1.25rem, 5vw, 1.875rem)' }}
          >
            {loadingMessages[loadingMessageIndex]}
          </p>
        </div>

        <style jsx>{`
          @keyframes fade-in {
            0% { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in {
            animation: fade-in 0.5s ease-out;
          }
        `}</style>
      </main>
    );
  }

  // Results Screen
  return (
    <main className="min-h-screen bg-background px-4 sm:px-6 py-8 sm:py-12 md:py-20 overflow-x-hidden">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="font-serif text-foreground mb-4" style={{ fontSize: 'clamp(1.75rem, 6vw, 3rem)' }}>
            Your Styling <span className="italic">Options</span>
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto font-light text-sm sm:text-base px-2">
            Based on your bed, we&apos;ve curated three distinct looks to
            transform your space.
          </p>
        </div>

        {/* Style Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {styleResults.map((style, index) => (
            <StyleCard key={index} style={style} userImage={uploadedImage} />
          ))}
        </div>

        {/* Email Capture */}
        <div className="mt-16 sm:mt-20 pt-10 sm:pt-12 border-t border-border/60">
          <div className="max-w-md mx-auto text-center">
            {emailSubmitted ? (
              <p className="text-foreground font-light">
                We&apos;ll be in touch with your styling summary.
              </p>
            ) : (
              <>
                <p className="text-foreground font-light mb-6">
                  Want to save your results and get new styling ideas?
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!email || emailSubmitting) return;
                    
                    setEmailSubmitting(true);
                    try {
                      await fetch("/api/save-results", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          email,
                          styles: styleResults,
                          preferences: quizAnswers,
                        }),
                      });
                      setEmailSubmitted(true);
                    } catch {
                      // Silent fail - still show thank you
                      setEmailSubmitted(true);
                    } finally {
                      setEmailSubmitting(false);
                    }
                  }}
                  className="flex flex-col sm:flex-row gap-3 items-center justify-center"
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full sm:w-auto min-w-[240px] px-4 py-3 border border-border bg-background text-foreground placeholder:text-muted-foreground font-light focus:outline-none focus:border-primary transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={emailSubmitting}
                    className="w-full sm:w-auto px-6 min-h-[48px] py-3 bg-primary text-primary-foreground font-medium tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {emailSubmitting ? "Sending..." : "Send my results"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* Start Over */}
        <div className="mt-10 sm:mt-16 text-center">
          <button
            onClick={startOver}
            className="min-h-[44px] px-4 py-2 text-muted-foreground hover:text-foreground transition-colors font-light"
          >
            Start over with a new photo
          </button>
        </div>
      </div>
    </main>
  );
}

// Default products if API doesn't return them
const defaultProducts: Product[] = [
  { name: 'Linen Duvet Cover', price: '$189', url: '#' },
  { name: 'Cotton Sheet Set', price: '$145', url: '#' },
  { name: 'Accent Throw Pillow', price: '$68', url: '#' },
];

// Helper to create Picsum Photos URL from item description
function getPicsumThumbnail(itemDescription: string): string {
  // Extract key terms and use as seed for consistent images
  const seed = itemDescription
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(' ')
    .slice(0, 4)
    .join('-');
  return `https://picsum.photos/seed/${seed}/80/80`;
}

// Product thumbnail component with fallback
function ProductThumbnail({ item }: { item: string }) {
  const [hasError, setHasError] = useState(false);
  const imageUrl = getPicsumThumbnail(item);

  return (
    <div className="w-10 h-10 flex-shrink-0 overflow-hidden rounded">
      {hasError ? (
        <div className="w-full h-full bg-muted" />
      ) : (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
          loading="lazy"
        />
      )}
    </div>
  );
}

function MoodBoardImage({ query, className }: { query: string; className?: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    
    async function fetchImage() {
      try {
        const response = await fetch(`/api/unsplash?query=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        if (!cancelled && data.url) {
          setImageUrl(data.url);
        }
      } catch {
        if (!cancelled) {
          // Fallback to Picsum
          const seed = query.toLowerCase().replace(/[^\w\s]/g, '').split(' ').slice(0, 4).join('-');
          setImageUrl(`https://picsum.photos/seed/${seed}/200/200`);
        }
      }
    }
    
    fetchImage();
    return () => { cancelled = true; };
  }, [query]);

  if (hasError || !imageUrl) {
    return <div className={`bg-muted animate-pulse ${className}`} />;
  }

  return (
    <img
      src={imageUrl}
      alt={query}
      className={`object-cover ${className}`}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
}

function StyleCard({ style, userImage }: { style: StyleResult; userImage: string | null }) {
  const products = style.products && style.products.length > 0 ? style.products : defaultProducts;
  
  // Get up to 5 items for the mood board (user photo + 5 inspiration images)
  const moodBoardItems = style.whatToAdd.slice(0, 5);
  // Pad with generic terms if we have fewer than 5 items
  while (moodBoardItems.length < 5) {
    moodBoardItems.push(`${style.name} bedding texture`);
  }

  return (
    <article className="bg-card border border-border flex flex-col h-full overflow-hidden group">
      {/* Mood Board Grid - 2x3 with user photo spanning 2 cells */}
      <div className="grid grid-cols-3 grid-rows-2 gap-1 aspect-[3/2]">
        {/* User's bed photo - spans 2 rows */}
        <div className="col-span-2 row-span-2 relative overflow-hidden">
          {userImage ? (
            <img
              src={userImage}
              alt="Your bed"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
          <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
            Your Bed
          </div>
        </div>
        {/* 4 inspiration images from What to Add items */}
        {moodBoardItems.slice(0, 4).map((item, i) => (
          <div key={i} className="relative overflow-hidden">
            <MoodBoardImage query={item} className="w-full h-full" />
          </div>
        ))}
      </div>

      <div className="p-5 sm:p-8 flex flex-col flex-1">
        {/* Style Name */}
        <h3 className="font-serif text-foreground mb-3 sm:mb-4 italic" style={{ fontSize: 'clamp(1.25rem, 4vw, 1.875rem)' }}>
          {style.name}
        </h3>

        {/* Description */}
        <p className="text-muted-foreground text-sm leading-relaxed mb-8 font-light">
          {style.description}
        </p>

        {/* What to Add */}
        <div className="mb-5">
          <h4 className="text-xs uppercase tracking-[0.2em] text-foreground/70 mb-3 font-medium">
            What to Add
          </h4>
          <ul className="space-y-3">
            {style.whatToAdd.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-3"
              >
                <ProductThumbnail item={item} />
                <span className="text-sm text-muted-foreground font-light">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* What to Change */}
        <div className="mb-8">
          <h4 className="text-xs uppercase tracking-[0.2em] text-foreground/70 mb-3 font-medium">
            What to Change
          </h4>
          <ul className="space-y-2">
            {style.whatToChange.map((item, i) => (
              <li
                key={i}
                className="text-sm text-muted-foreground font-light pl-4 relative before:absolute before:left-0 before:top-[0.6em] before:w-1 before:h-1 before:border before:border-primary/60 before:rounded-full"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Shoppable Products */}
        <div className="mt-auto pt-6 border-t border-border">
          <h4 className="text-xs uppercase tracking-[0.2em] text-foreground/70 mb-4 font-medium">
            Shop the Look
          </h4>
          <div className="space-y-3">
            {products.slice(0, 3).map((product, i) => (
              <a
                key={i}
                href={product.url}
                className="flex items-center justify-between min-h-[48px] py-3 px-4 bg-secondary/50 hover:bg-secondary transition-colors group/product"
              >
                <span className="text-sm text-foreground font-medium group-hover/product:text-primary transition-colors flex-1 pr-2">
                  {product.name}
                </span>
                <span className="text-sm text-muted-foreground font-light whitespace-nowrap">
                  {product.price}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
