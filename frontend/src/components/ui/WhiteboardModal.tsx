import React, { useMemo, useState } from 'react';
import { X, FileText, Briefcase, Eye, Send, Archive } from 'lucide-react';
import { soundFX } from '../../utils/audio';

export interface WhiteboardNote {
  id: string;
  title: string;
  content: string;
  author: string;
  color: 'yellow' | 'cyan' | 'pink' | 'emerald';
  pinned: boolean;
  kind?: string;
  assigneeId?: string;
  status?: string;
  jobId?: string;
}

interface WhiteboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: WhiteboardNote[];
  agents?: Array<{ id: string; name: string; role?: string }>;
  readOnly?: boolean;
  onAssign?: (agentId: string, prompt: string) => Promise<string | null>;
  onArchive?: (id: string) => Promise<void>;
}

function shortId(id?: string): string {
  if (!id) return '';
  const parts = id.split(':');
  return parts[parts.length - 1] || id;
}

function normalizeJobKey(jobId?: string, fallbackId?: string): string {
  const raw = jobId || fallbackId || '';
  return shortId(raw) || 'loose';
}

const colorMap: Record<WhiteboardNote['color'], string> = {
  yellow: 'bg-amber-100/95 border-amber-300 text-amber-950',
  cyan: 'bg-cyan-100/95 border-cyan-300 text-cyan-950',
  pink: 'bg-rose-100/95 border-rose-300 text-rose-950',
  emerald: 'bg-emerald-100/95 border-emerald-300 text-emerald-950',
};

export const WhiteboardModal: React.FC<WhiteboardModalProps> = ({
  isOpen,
  onClose,
  notes,
  agents = [],
  readOnly = true,
  onAssign,
  onArchive,
}) => {
  const [view, setView] = useState<'jobs' | 'cards'>('jobs');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const selectedAgent = agentId === null ? agents[0]?.id || '' : agentId;

  const jobGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        job?: WhiteboardNote;
        tasks: WhiteboardNote[];
        handoffs: WhiteboardNote[];
        results: WhiteboardNote[];
        notes: WhiteboardNote[];
      }
    >();

    const ensure = (key: string) => {
      if (!map.has(key)) {
        map.set(key, { key, tasks: [], handoffs: [], results: [], notes: [] });
      }
      return map.get(key)!;
    };

    for (const note of notes) {
      const key = normalizeJobKey(note.jobId, note.kind === 'Job' ? note.id : undefined);
      const group = ensure(key);
      if (note.kind === 'Job') group.job = note;
      else if (note.kind === 'Task') group.tasks.push(note);
      else if (note.kind === 'Handoff') group.handoffs.push(note);
      else if (note.kind === 'Result') group.results.push(note);
      else group.notes.push(note);
    }

    return Array.from(map.values()).sort((a, b) => {
      const at = a.job?.title || a.key;
      const bt = b.job?.title || b.key;
      return at.localeCompare(bt);
    });
  }, [notes]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-600/70 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/80">
          <div>
            <div className="flex items-center gap-2 text-white font-semibold tracking-tight">
              <FileText className="w-4 h-4 text-amber-300" />
              Quadro da redação
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              {readOnly
                ? 'Somente leitura — visitantes não editam o quadro'
                : 'Modo interativo — atribua uma tarefa ou arquive um card'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-slate-800/80 p-0.5 text-xs font-mono">
              <button
                className={`px-2.5 py-1 rounded-md ${view === 'jobs' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}
                onClick={() => setView('jobs')}
              >
                Jobs
              </button>
              <button
                className={`px-2.5 py-1 rounded-md ${view === 'cards' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}
                onClick={() => setView('cards')}
              >
                Cards
              </button>
            </div>
            <button
              onClick={() => {
                soundFX.playClick();
                onClose();
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!readOnly && (
          <form
            className="px-5 py-3 border-b border-slate-800 space-y-2"
            onSubmit={async event => {
              event.preventDefault();
              if (!onAssign || !prompt.trim()) return;
              setBusy(true);
              setNotice('');
              try {
                const message = await onAssign(selectedAgent, prompt.trim());
                setPrompt('');
                setNotice(message || 'Tarefa enviada.');
              } catch (err) {
                setNotice(err instanceof Error ? err.message : 'Não foi possível enviar.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={selectedAgent}
                onChange={event => setAgentId(event.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200 font-mono"
              >
                <option value="">Nota no quadro (sem responsável)</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.role ? ` · ${agent.role}` : ''}
                  </option>
                ))}
              </select>
              <textarea
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                rows={2}
                placeholder="O que esta pessoa deve fazer?"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={busy || !prompt.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
                Atribuir
              </button>
            </div>
            {notice && <p className="text-[11px] font-mono text-slate-400">{notice}</p>}
          </form>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {view === 'jobs' ? (
            jobGroups.length === 0 ? (
              <p className="text-sm text-slate-400 font-mono">Aguardando a pauta do dia…</p>
            ) : (
              jobGroups.map(group => (
                <div
                  key={group.key}
                  className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 space-y-3"
                >
                  <div className="flex items-start gap-2">
                    <Briefcase className="w-4 h-4 text-cyan-300 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {group.job?.title || `Job ${group.key}`}
                      </h3>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {group.job?.author || 'Office'}
                        {group.job?.status ? ` · ${group.job.status}` : ''}
                      </p>
                      {group.job?.content && (
                        <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap line-clamp-4">
                          {group.job.content}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[...group.tasks, ...group.handoffs, ...group.results, ...group.notes].map(note => (
                      <div
                        key={note.id}
                        className={`rounded-lg border px-3 py-2 text-xs ${colorMap[note.color]}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold">{note.title}</div>
                          {!readOnly && onArchive && (
                            <button
                              type="button"
                              className="opacity-60 hover:opacity-100"
                              title="Arquivar"
                              onClick={() => {
                                soundFX.playClick();
                                void onArchive(note.id);
                              }}
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="opacity-70 mt-0.5">{note.author}</div>
                        {note.content && (
                          <p className="mt-1.5 whitespace-pre-wrap line-clamp-5 opacity-90">{note.content}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {notes.map(note => (
                <div key={note.id} className={`rounded-lg border px-3 py-2 text-xs ${colorMap[note.color]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{note.title}</div>
                    {!readOnly && onArchive && (
                      <button
                        type="button"
                        className="opacity-60 hover:opacity-100"
                        title="Arquivar"
                        onClick={() => {
                          soundFX.playClick();
                          void onArchive(note.id);
                        }}
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="opacity-70 mt-0.5">{note.author}</div>
                  {note.content && (
                    <p className="mt-1.5 whitespace-pre-wrap line-clamp-6 opacity-90">{note.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {agents.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-mono mb-2">Equipe</p>
              <div className="flex flex-wrap gap-2">
                {agents.map(agent => (
                  <span
                    key={agent.id}
                    className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 font-mono"
                  >
                    {agent.name}
                    {agent.role ? ` · ${agent.role}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
