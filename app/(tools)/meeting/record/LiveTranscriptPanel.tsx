"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Languages, ArrowDown, Sparkles } from "lucide-react";
import type { STTSegment } from "@/lib/meeting/stt/types";
import type { LiveSttStatus } from "@/lib/meeting/stt/liveTranscription";
import { TRANSLATE_LANGUAGES } from "@/lib/meeting/translateLanguages";

function formatTimestamp(sec: number): string {
  const s = Math.floor(sec > 86400 ? sec % 86400 : Math.max(0, sec));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mins)}:${pad(secs)}`;
}

function getLiveStatusText(opts: {
  liveTranscriptEnabled: boolean;
  liveSttStatus: LiveSttStatus;
  hasTranscript: boolean;
}): string {
  if (!opts.liveTranscriptEnabled) {
    return opts.hasTranscript
      ? "Live preview is off • Earlier text is kept • Audio is safely recording"
      : "Live preview is disabled • Audio is safely recording";
  }
  if (opts.liveSttStatus === "unavailable") {
    return "Live preview unavailable — full pass runs after ending meeting";
  }
  if (opts.liveSttStatus === "catching-up") {
    return "Catching up…";
  }
  return opts.hasTranscript ? "Live real-time preview active" : "Listening for speech…";
}

function renderTranslationCell(translationEnabled: boolean, translated?: string) {
  if (!translationEnabled) return null;
  if (translated === "—") return <span className="text-xs text-muted-foreground/50">Translation unavailable</span>;
  if (translated) return <p className="text-foreground">{translated}</p>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 italic">
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
      Translating...
    </span>
  );
}

export interface LiveTranscriptPanelProps {
  transcript: STTSegment[];
  translations: Record<number, string>;
  translationEnabled: boolean;
  onTranslationEnabledChange: (enabled: boolean) => void;
  targetLanguage: string;
  onTargetLanguageChange: (lang: string) => void;
  liveSttStatus: LiveSttStatus;
  liveMessage?: string;
  liveLagSec: number;
  liveTranscriptEnabled?: boolean;
  onLiveTranscriptEnabledChange?: (enabled: boolean) => void;
}

export function LiveTranscriptPanel({
  transcript,
  translations,
  translationEnabled,
  onTranslationEnabledChange,
  targetLanguage,
  onTargetLanguageChange,
  liveSttStatus,
  liveMessage,
  liveLagSec,
  liveTranscriptEnabled = true,
  onLiveTranscriptEnabledChange,
}: LiveTranscriptPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom on new transcripts or translations
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, translations, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom !== autoScroll) {
      setAutoScroll(isNearBottom);
    }
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const liveStatusText = getLiveStatusText({
    liveTranscriptEnabled,
    liveSttStatus,
    hasTranscript: transcript.length > 0,
  });

  return (
    <section className="relative flex h-[calc(100dvh-260px)] min-h-[320px] max-h-[520px] w-full flex-col bg-background lg:h-[calc(100vh-140px)] lg:min-h-[540px] lg:max-h-none">
      {/* Minimalist Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Live Transcript & Translation</h2>
            {liveTranscriptEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Off
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{liveStatusText}</p>
        </div>

        {/* Header Controls: Live Transcript Toggle & Translation Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {onLiveTranscriptEnabledChange && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors">
              <input
                type="checkbox"
                checked={liveTranscriptEnabled}
                onChange={(e) => onLiveTranscriptEnabledChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
              />
              <Mic className="h-3.5 w-3.5 text-primary" />
              <span>Live Transcript: {liveTranscriptEnabled ? "On" : "Off"}</span>
            </label>
          )}

          {liveTranscriptEnabled && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer select-none rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors">
                <input
                  type="checkbox"
                  checked={translationEnabled}
                  onChange={(e) => onTranslationEnabledChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                />
                <Languages className="h-3.5 w-3.5 text-primary" />
                <span>Translate to:</span>
              </label>
              <select
                value={targetLanguage}
                onChange={(e) => onTargetLanguageChange(e.target.value)}
                disabled={!translationEnabled}
                className="rounded-lg border border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-40"
              >
                {TRANSLATE_LANGUAGES.map((t) => (
                  <option key={t.code} value={t.label}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Lag or Notice Message */}
      {liveTranscriptEnabled && liveLagSec >= 15 && liveSttStatus !== "unavailable" && (
        <p className="py-1.5 text-xs text-amber-700 dark:text-amber-300">
          Preview is {Math.round(liveLagSec)}s behind audio capture. Full pass runs after stopping.
        </p>
      )}

      {liveMessage && (
        <p className="py-1.5 text-xs text-muted-foreground">
          {liveMessage}
        </p>
      )}

      {!liveTranscriptEnabled && transcript.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center p-8">
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted/50">
            <Mic className="h-6 w-6 text-muted-foreground/60" />
            <span className="absolute top-0 right-0 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">Live Transcript is Turned Off</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Audio recording is active in the background. Full transcription, speaker diarization, and AI summary will run automatically after ending the meeting.
          </p>
          {onLiveTranscriptEnabledChange && (
            <button
              type="button"
              onClick={() => onLiveTranscriptEnabledChange(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Turn on Live Transcript</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Minimalist Header */}
          <div
            className={`gap-8 pt-3 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase border-b border-border/30 ${
              translationEnabled ? "grid grid-cols-1 md:grid-cols-2" : "flex items-center"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Mic className="h-3 w-3 text-muted-foreground" />
              <span>Original Speech (STT)</span>
            </div>
            {translationEnabled && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                <span>Translation ({targetLanguage})</span>
              </div>
            )}
          </div>

          {/* Minimalist Content */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            aria-live="polite"
            className="flex-1 overflow-y-auto py-2 space-y-3"
          >
            {transcript.length === 0 ? (
              <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
                <Mic className="h-8 w-8 text-muted-foreground/30 mb-2 animate-pulse" />
                <p className="text-sm font-medium text-foreground/80">Speak normally to see live transcription</p>
                <p className="mt-1 text-xs text-muted-foreground/70 max-w-sm">
                  Recognized speech and real-time translation will flow here continuously.
                </p>
              </div>
            ) : (
              transcript.map((segment, index) => {
                const translated = translations[index];
                const timestamp = `${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}`;

                return (
                  <div
                    key={`${segment.start}-${index}`}
                    className="group py-2 px-1 rounded-md transition-colors hover:bg-muted/15"
                  >
                    <div className="text-[11px] font-mono text-muted-foreground/50 mb-1">
                      {timestamp}
                    </div>

                    <div
                      className={
                        translationEnabled
                          ? "grid grid-cols-1 md:grid-cols-2 gap-8 items-start"
                          : "space-y-1"
                      }
                    >
                      {/* Left Column: Original STT */}
                      <div className="text-sm leading-relaxed text-foreground select-text">
                        {segment.text}
                      </div>

                      {/* Right Column: Target Translation */}
                      {translationEnabled && (
                        <div className="text-sm leading-relaxed select-text">
                          {renderTranslationCell(translationEnabled, translated)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>

          {/* Floating Scroll to Bottom Button if paused */}
          {!autoScroll && transcript.length > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              <span>Scroll to latest</span>
            </button>
          )}
        </>
      )}
    </section>
  );
}
