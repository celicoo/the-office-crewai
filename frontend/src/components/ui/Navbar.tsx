import React from 'react';
import { ViewMode } from '../../types/agent';
import { TopPerformerInfo } from '../3d/AgentScene';
import {
  FileText,
  Volume2,
  VolumeX,
  Compass,
  Footprints,
  Glasses,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { soundFX } from '../../utils/audio';

interface NavbarProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onOpenWhiteboard: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  agentCount: number;
  officeName?: string;
  articlesPerDay?: number;
  blogUrl?: string;
  topPerformer?: TopPerformerInfo | null;
  readOnly?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  onChangeViewMode,
  onOpenWhiteboard,
  soundEnabled,
  onToggleSound,
  agentCount,
  officeName = 'The Office',
  articlesPerDay = 3,
  blogUrl,
  topPerformer,
  readOnly = true,
}) => {
  return (
    <header className="absolute top-0 right-0 left-0 z-40 p-3 sm:p-4 flex items-start justify-between pointer-events-none">
      <div className="pointer-events-none pl-1 pt-10 sm:pt-0">
        <div className="hidden sm:block">
          <h1 className="font-display text-2xl sm:text-3xl text-white drop-shadow-lg tracking-tight">
            {officeName}
          </h1>
          <p className="text-[11px] font-mono text-slate-300/90 mt-1">
            {agentCount} agentes · {articlesPerDay} artigos/dia · {readOnly ? 'somente leitura' : 'interativo'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 pointer-events-auto">
        {topPerformer && (
          <div className="px-2.5 sm:px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 backdrop-blur-md bg-gradient-to-r from-amber-500/20 via-slate-900/90 to-amber-500/20 text-amber-200 border border-amber-400/50 shadow-sm shadow-amber-500/10">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Destaque:</span>
            <span className="font-bold text-white truncate max-w-[90px]">
              {topPerformer.agent.name.split(' ')[0]}
            </span>
          </div>
        )}

        <div className="flex items-center bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded p-0.5 shadow-sm text-xs font-mono">
          <button
            onClick={() => {
              soundFX.playClick();
              onChangeViewMode('isometric');
            }}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              viewMode === 'isometric'
                ? 'bg-slate-700 text-white font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Visão isométrica"
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Iso</span>
          </button>
          <button
            onClick={() => {
              soundFX.playClick();
              onChangeViewMode('first-person');
            }}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              viewMode === 'first-person'
                ? 'bg-slate-700 text-white font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Primeira pessoa (FPS)"
          >
            <Footprints className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">FPS</span>
          </button>
          <button
            onClick={() => {
              soundFX.playClick();
              onChangeViewMode('vr-stereo');
            }}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
              viewMode === 'vr-stereo'
                ? 'bg-slate-700 text-white font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="VR estereoscópico"
          >
            <Glasses className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">VR</span>
          </button>
        </div>

        <button
          onClick={() => {
            soundFX.playClick();
            onOpenWhiteboard();
          }}
          className="px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors backdrop-blur-md bg-slate-900/90 text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-white shadow-sm"
          title={readOnly ? 'Abrir quadro (somente leitura)' : 'Abrir quadro'}
        >
          <FileText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Quadro</span>
        </button>

        {blogUrl && (
          <a
            href={blogUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors backdrop-blur-md bg-slate-900/90 text-emerald-300 border border-emerald-700/50 hover:bg-slate-800 hover:text-white shadow-sm"
            title="Abrir blog publicado"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Blog</span>
          </a>
        )}

        <button
          onClick={() => {
            soundFX.playClick();
            onToggleSound();
          }}
          className="px-2.5 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors backdrop-blur-md bg-slate-900/90 text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-white shadow-sm"
          title={soundEnabled ? 'Silenciar' : 'Ativar som'}
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
