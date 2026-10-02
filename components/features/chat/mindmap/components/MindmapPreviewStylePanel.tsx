"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Palette } from "lucide-react";
import { StylePreset, STYLE_PRESETS } from "../mindmap-types";

interface MindmapPreviewStylePanelProps {
  isStyleMenuOpen: boolean;
  setIsStyleMenuOpen: (open: boolean) => void;
  layoutStructure: string;
  setLayoutStructure: (v: string) => void;
  layoutSubOption: number;
  setLayoutSubOption: (v: number) => void;
  activePreset: StylePreset;
  setActivePreset: (p: StylePreset) => void;
  nodeShape: "rounded_rect" | "circle" | "underline";
  setNodeShape: (s: "rounded_rect" | "circle" | "underline") => void;
}

const SKELETON_TYPES = [
  { id: "logical", name: "Logical Structure (Left)" },
  { id: "mindmap", name: "Mind Map" },
  { id: "org_chart", name: "Organization Structure" },
	{ id: "catalog", name: "Treeview Organization" },
  { id: "timeline", name: "Timeline" },
  { id: "vertical_timeline", name: "Vertical Timeline" },
  { id: "fishbone", name: "Fishbone" },
];

const SUB_OPTIONS: Record<string, { id: number; icon: React.ReactNode }[]> = {
  logical: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 6 12 H 14" /><path d="M 14 12 C 20 12, 20 4, 34 4" /><path d="M 14 12 C 20 12, 20 20, 34 20" /><path d="M 14 12 H 34" /><circle cx="6" cy="12" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 6 12 H 16 V 4 H 34" /><path d="M 16 12 H 34" /><path d="M 16 12 V 20 H 34" /><circle cx="6" cy="12" r="2" className="fill-current" /></svg> },
    { id: 3, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 6 12 H 14" /><path d="M 14 12 L 34 4" /><path d="M 14 12 L 34 12" /><path d="M 14 12 L 34 20" /><circle cx="6" cy="12" r="2" className="fill-current" /></svg> }
  ],
  mindmap: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 C 14 12, 14 5, 6 5" /><path d="M 20 12 C 14 12, 14 19, 6 19" /><path d="M 20 12 C 26 12, 26 5, 34 5" /><path d="M 20 12 C 26 12, 26 19, 34 19" /><rect x="17" y="10" width="6" height="4" rx="1" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 H 14 V 5 H 6" /><path d="M 14 12 V 19 H 6" /><path d="M 20 12 H 26 V 5 H 34" /><path d="M 26 12 V 19 H 34" /><rect x="17" y="10" width="6" height="4" rx="1" className="fill-current" /></svg> },
    { id: 3, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 L 6 5" /><path d="M 20 12 L 6 19" /><path d="M 20 12 L 34 5" /><path d="M 20 12 L 34 19" /><rect x="17" y="10" width="6" height="4" rx="1" className="fill-current" /></svg> },
    { id: 4, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 Q 13 18, 6 12 Q 13 6, 20 12" /><path d="M 20 12 Q 27 18, 34 12 Q 27 6, 20 12" /><rect x="18" y="10" width="4" height="4" rx="2" className="fill-current" /></svg> },
    { id: 5, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 L 15 5 H 6" /><path d="M 20 12 L 15 19 H 6" /><path d="M 20 12 L 25 5 H 34" /><path d="M 20 12 L 25 19 H 34" /><rect x="17" y="10" width="6" height="4" rx="1" className="fill-current" /></svg> },
    { id: 6, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 12 H 12 L 12 5 H 6" /><path d="M 12 12 L 12 19 H 6" /><path d="M 20 12 H 28 L 28 5 H 34" /><path d="M 28 12 L 28 19 H 34" /><rect x="17" y="10" width="6" height="4" rx="1" className="fill-current" /></svg> }
  ],
  org_chart: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 4 V 10 H 8 V 20" /><path d="M 20 10 H 32 V 20" /><path d="M 20 10 V 20" /><rect x="16" y="2" width="8" height="4" rx="1" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 4 L 8 20" /><path d="M 20 4 L 20 20" /><path d="M 20 4 L 32 20" /><rect x="16" y="2" width="8" height="4" rx="1" className="fill-current" /></svg> }
  ],
  catalog: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 8 4 V 20" /><path d="M 8 10 Q 8 13, 13 13 H 32" /><path d="M 8 17 Q 8 20, 13 20 H 32" /><rect x="4" y="2" width="8" height="4" rx="1" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 8 4 V 20" /><path d="M 8 13 H 32" /><path d="M 8 20 H 32" /><rect x="4" y="2" width="8" height="4" rx="1" className="fill-current" /></svg> }
  ],
  timeline: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 4 12 H 36" /><path d="M 12 12 V 4 H 20" /><path d="M 22 12 V 20 H 30" /><circle cx="12" cy="12" r="2" className="fill-current" /><circle cx="22" cy="12" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 4 15 H 36" /><path d="M 12 15 V 6 H 20" /><path d="M 24 15 V 6 H 32" /><circle cx="12" cy="15" r="2" className="fill-current" /><circle cx="24" cy="15" r="2" className="fill-current" /></svg> },
    { id: 3, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 4 9 H 36" /><path d="M 12 9 V 18 H 20" /><path d="M 24 9 V 18 H 32" /><circle cx="12" cy="9" r="2" className="fill-current" /><circle cx="24" cy="9" r="2" className="fill-current" /></svg> }
  ],
  vertical_timeline: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 4 V 20" /><path d="M 20 9 H 32" /><path d="M 20 15 H 8" /><circle cx="20" cy="9" r="2" className="fill-current" /><circle cx="20" cy="15" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 14 4 V 20" /><path d="M 14 9 H 30" /><path d="M 14 15 H 30" /><circle cx="14" cy="9" r="2" className="fill-current" /><circle cx="14" cy="15" r="2" className="fill-current" /></svg> },
    { id: 3, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 26 4 V 20" /><path d="M 26 9 H 10" /><path d="M 26 15 H 10" /><circle cx="26" cy="9" r="2" className="fill-current" /><circle cx="26" cy="15" r="2" className="fill-current" /></svg> }
  ],
  fishbone: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 4 12 H 36" /><path d="M 14 12 Q 20 6, 26 6 H 32" /><path d="M 18 12 Q 24 18, 30 18 H 36" /><circle cx="14" cy="12" r="2" className="fill-current" /><circle cx="18" cy="12" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 4 12 H 36" /><path d="M 14 12 L 24 6 H 32" /><path d="M 18 12 L 28 18 H 36" /><circle cx="14" cy="12" r="2" className="fill-current" /><circle cx="18" cy="12" r="2" className="fill-current" /></svg> }
  ],
  flowchart: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 20 4 V 20" /><path d="M 12 10 H 28" /><path d="M 20 10 V 16" /><circle cx="20" cy="4" r="2" className="fill-current" /><circle cx="20" cy="20" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 10 5 H 30 V 19 H 10 Z" /><path d="M 20 5 V 19" /><circle cx="10" cy="12" r="1.8" className="fill-current" /><circle cx="30" cy="12" r="1.8" className="fill-current" /></svg> }
  ],
  swimlane: [
    { id: 1, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 6 6 H 34" /><path d="M 6 12 H 34" /><path d="M 6 18 H 34" /><path d="M 20 6 V 18" /><circle cx="20" cy="12" r="2" className="fill-current" /></svg> },
    { id: 2, icon: <svg viewBox="0 0 40 24" className="w-full h-full stroke-current fill-none" strokeWidth="1.5"><path d="M 6 6 H 34" /><path d="M 6 18 H 34" /><path d="M 14 6 V 18" /><path d="M 26 6 V 18" /><circle cx="20" cy="12" r="2" className="fill-current" /></svg> }
  ]
};

export function MindmapPreviewStylePanel({
  isStyleMenuOpen,
  setIsStyleMenuOpen,
  layoutStructure,
  setLayoutStructure,
  layoutSubOption,
  setLayoutSubOption,
  activePreset,
  setActivePreset,
  nodeShape,
  setNodeShape,
}: MindmapPreviewStylePanelProps) {
  return (
    <div className="relative border-r border-slate-200 dark:border-slate-800 pr-4 style-popover-el">
      <button
        onClick={() => setIsStyleMenuOpen(!isStyleMenuOpen)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
          isStyleMenuOpen
            ? "bg-indigo-650 text-white"
            : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        <Palette className="w-3.5 h-3.5" />
        <span>Style</span>
      </button>

      <AnimatePresence>
        {isStyleMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-11 left-1/2 -translate-x-1/2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-2xl flex flex-col gap-4 z-30"
          >
            {/* Title */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-[11px] font-extrabold text-slate-850 dark:text-white uppercase tracking-wider">Style Settings</span>
              <button
                onClick={() => setIsStyleMenuOpen(false)}
                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-white font-medium"
              >
                Close
              </button>
            </div>

            {/* Structure Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-550 dark:text-slate-400 uppercase tracking-widest block">Skeleton</span>
                <select
                  value={layoutStructure}
                  onChange={(e) => {
                    setLayoutStructure(e.target.value);
                    setLayoutSubOption(1);
                  }}
                  className="text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 outline-none cursor-pointer"
                >
                  {SKELETON_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-2">
                {(SUB_OPTIONS[layoutStructure] || SUB_OPTIONS.logical).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setLayoutSubOption(opt.id)}
                    className={`aspect-[4/3] p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
                      layoutSubOption === opt.id
                        ? "bg-indigo-500/15 border-indigo-500 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/20"
                        : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
                    }`}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-555 dark:text-slate-400 uppercase tracking-widest block">Màu sắc (Color Themes)</span>
              <div className="grid grid-cols-2 gap-1.5">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setActivePreset(preset)}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex flex-col text-left gap-1 ${
                      activePreset.id === preset.id
                        ? "bg-indigo-500/10 border-indigo-550 text-indigo-600 dark:text-indigo-400"
                        : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-550 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="text-[10.5px] font-bold truncate">{preset.name}</span>
                    <div className="flex gap-0.5">
                      {preset.branchColors.slice(0, 4).map((c, idx) => (
                        <span
                          key={idx}
                          className="w-2.5 h-2.5 rounded-full border border-slate-900/30"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Node Style Selection */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-555 dark:text-slate-400 uppercase tracking-widest block">Kiểu dáng Node</span>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "rounded_rect", name: "Hộp bo góc" },
                  { id: "circle", name: "Hình tròn" },
                  { id: "underline", name: "Gạch chân" },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setNodeShape(item.id as "rounded_rect" | "circle" | "underline")}
                    className={`py-1.5 rounded-lg border text-center text-[10.5px] font-bold transition-all cursor-pointer truncate ${
                      nodeShape === item.id
                        ? "bg-indigo-500/10 border-indigo-550 text-indigo-600 dark:text-indigo-400"
                        : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-555 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
