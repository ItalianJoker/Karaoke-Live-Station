import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Pause,
  Music,
  Sliders,
  Sparkles,
  Trash2,
  GripVertical,
  Download,
  Edit2,
  Mic,
  AlertCircle,
  FileX
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  dataTransferHasFiles,
  dispatchOsFileDragEnd
} from '../utils/fsDragDrop';
import { confirmAsync } from '../utils/toast';
import type { KaraokeMediaTrack, QueueItem } from '../../shared/types';
import { TrackKeyBpmBadges } from './TrackKeyBpmBadges';

export interface QueueListProps {
  isPlaying: boolean;
  enableFairQueue: boolean;
  queueFileDropActive: boolean;
  setQueueFileDropActive: (v: boolean) => void;
  onOsFileDrop: (files: FileList | null) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onJumpToTrack: (index: number) => void;
  onSaveToPermanentLibrary: (track: KaraokeMediaTrack) => void;
  savingTrackIds: Set<string>;
  onEditSinger: (item: QueueItem) => void;
}

/**
 * Fair-queue panel: OS file-drop import, reorder DnD, per-row pitch/singer/remove.
 *
 * **Audience (humans):** Right-column Queue tab content for the Regia operator.
 *
 * **Audience (AI):** Files-type drops must not collide with text/plain reorder DnD.
 * Index 0 (now playing) is not draggable. GC of removed items stays in the store —
 * never delete `libraryPath` here. Do not remove `data-testid` hooks used by tests.
 */
export const QueueList: React.FC<QueueListProps> = ({
  isPlaying,
  enableFairQueue,
  queueFileDropActive,
  setQueueFileDropActive,
  onOsFileDrop,
  onPlayPause,
  onStop,
  onJumpToTrack,
  onSaveToPermanentLibrary,
  savingTrackIds,
  onEditSinger
}) => {
  const { t } = useTranslation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  /** Enter/leave depth so child bubbles do not clear the overlay early. */
  const fileDropDepthRef = useRef(0);

  const queue = useKaraokeStore((s) => s.queue);
  const missingTrackIds = useKaraokeStore((s) => s.missingTrackIds);
  /** O(1) membership during row render — avoids O(V·M) includes on large missing sets. */
  const missingTrackIdSet = useMemo(() => new Set(missingTrackIds), [missingTrackIds]);
  const reorderQueue = useKaraokeStore((s) => s.reorderQueue);
  const restoreFairQueueOrder = useKaraokeStore((s) => s.restoreFairQueueOrder);
  const setQueueItemPitch = useKaraokeStore((s) => s.setQueueItemPitch);
  const setLivePitch = useKaraokeStore((s) => s.setLivePitch);
  const removeFromQueue = useKaraokeStore((s) => s.removeFromQueue);
  const clearQueue = useKaraokeStore((s) => s.clearQueue);

  return (
    <div
      className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 shadow-xl backdrop-blur-sm flex-1 min-h-0 flex flex-col overflow-hidden relative"
      data-testid="queue-panel-drop-zone"
      onDragEnter={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        // Crossing into Queue must clear Library overlay (Studio side-by-side).
        dispatchOsFileDragEnd();
        fileDropDepthRef.current += 1;
        setQueueFileDropActive(true);
      }}
      onDragOver={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!queueFileDropActive) setQueueFileDropActive(true);
      }}
      onDragLeave={() => {
        // Depth counter (no Files gate): Chromium often clears types on leave.
        fileDropDepthRef.current = Math.max(0, fileDropDepthRef.current - 1);
        if (fileDropDepthRef.current === 0) {
          setQueueFileDropActive(false);
        }
      }}
      onDrop={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        fileDropDepthRef.current = 0;
        setQueueFileDropActive(false);
        // Clear Library overlay if drag crossed Library before Queue.
        dispatchOsFileDragEnd();
        void onOsFileDrop(e.dataTransfer.files);
      }}
    >
      {queueFileDropActive && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-indigo-400/70 bg-slate-950/80 pointer-events-none"
          data-testid="queue-file-drop-overlay"
          aria-hidden
        >
          <span className="text-sm font-semibold text-indigo-200 px-4 text-center">
            {t('queue.dropToImport')}
          </span>
        </div>
      )}
      {/* Queue Header info */}
      <div className="mb-3 shrink-0 flex items-center justify-between px-3.5 py-2 bg-slate-950/70 rounded-full border border-slate-800/80">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          <span>Scaletta Coda ({queue.length})</span>
        </div>
        <div className="flex items-center gap-2">
          {enableFairQueue && queue.length > 2 && (
            <button
              type="button"
              onClick={() => restoreFairQueueOrder()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 hover:text-white text-[10px] font-semibold transition-all shadow-sm"
              title={t('queue.restoreFairQueueDesc')}
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>{t('queue.restoreFairQueue')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (await confirmAsync(t('queue.confirmClear', "Sei sicuro di voler svuotare l'intera coda dei brani?"))) {
                onStop();
                clearQueue();
              }
            }}
            disabled={queue.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-rose-600/30 text-slate-300 hover:text-rose-300 border border-slate-700/60 hover:border-rose-500/50 text-[10px] font-semibold transition-all disabled:opacity-40 active:scale-95 shadow-sm"
            title={t('queue.clear', 'Svuota coda')}
          >
            <Trash2 className="w-3 h-3 text-rose-400" />
            <span>{t('queue.clear', 'Svuota coda')}</span>
          </button>
          <div className="text-[10px] text-slate-400 font-medium hidden sm:block">
            💡 {t('queue.hintPlayOrDoubleClick', 'Doppio click o Play per avviare')}
          </div>
        </div>
      </div>

      {/* Fair Queue Sorted List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 flex flex-col">
        {queue.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs italic leading-relaxed">
            <Music className="w-8 h-8 opacity-20 mb-2" />
            <span className="max-w-xs">{t('queue.empty')}</span>
          </div>
        ) : (
          queue.map((item, index) => {
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index;
            const isMissing = missingTrackIdSet.has(item.track.id);

            return (
              <div
                key={item.queueId}
                draggable={index > 0}
                onDragStart={(e) => {
                  if (index === 0) return;
                  setDraggedIndex(index);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(index));
                }}
                onDragOver={(e) => {
                  // OS file drops are handled by the queue panel; do not steal them for reorder.
                  if (dataTransferHasFiles(e.dataTransfer)) return;
                  if (draggedIndex === null || draggedIndex === 0 || index === 0) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIndex !== index) {
                    setDragOverIndex(index);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverIndex === index) {
                    setDragOverIndex(null);
                  }
                }}
                onDrop={(e) => {
                  if (dataTransferHasFiles(e.dataTransfer)) return;
                  e.preventDefault();
                  if (draggedIndex !== null && draggedIndex > 0 && index > 0 && draggedIndex !== index) {
                    reorderQueue(draggedIndex, index);
                  }
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDoubleClick={() => onJumpToTrack(index)}
                className={`p-3 rounded-2xl border flex items-center justify-between transition-all duration-150 cursor-pointer select-none group/item ${
                  isMissing
                    ? 'bg-rose-950/40 border-rose-500/70 text-rose-100 shadow-md shadow-rose-950/30'
                    : index === 0
                      ? 'bg-gradient-to-r from-indigo-950/40 via-slate-900/90 to-slate-900/90 border-indigo-500/50 text-indigo-200 shadow-md'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700/80 hover:bg-slate-950/90'
                } ${isDragging ? 'opacity-40 scale-[0.99]' : ''} ${
                  isDragOver ? 'border-indigo-400 ring-2 ring-indigo-500/50 bg-indigo-950/40' : ''
                }`}
                data-missing-file={isMissing ? 'true' : undefined}
              >
                <div className="flex items-center gap-2 overflow-hidden pr-2 flex-1">
                  {index > 0 ? (
                    <div
                      className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 p-1 -ml-1 transition-colors shrink-0"
                      title="Trascina per riordinare la coda"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse shrink-0 -ml-0.5 mr-0.5" title="In esecuzione" />
                  )}
                  {index === 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayPause();
                      }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all border ${
                        isPlaying
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400/50 shadow-indigo-600/30'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/50 shadow-emerald-600/30'
                      }`}
                      title={isPlaying ? t('player.pause') : t('player.play')}
                    >
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToTrack(index);
                      }}
                      className="w-8 h-8 rounded-full bg-slate-800/90 hover:bg-indigo-600 text-slate-400 hover:text-white flex items-center justify-center shrink-0 transition-colors border border-slate-700/50"
                      title="Avvia ora questo brano (o fai doppio click)"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </button>
                  )}

                  <div className="overflow-hidden flex-1">
                    <div className="font-semibold text-xs flex items-center gap-2 truncate">
                      <span className="truncate">{item.track.title}</span>
                      {isMissing && (
                        <span
                          className="inline-flex items-center gap-0.5 text-rose-400 shrink-0"
                          title={t('errors.missingFileTooltip')}
                        >
                          <FileX className="w-3.5 h-3.5" />
                          <AlertCircle className="w-3 h-3 opacity-80" />
                        </span>
                      )}
                      {item.isVIPOverride && (
                        <span className="bg-amber-500/20 text-amber-300 text-[9px] px-2 py-0.5 rounded-full font-bold shrink-0 border border-amber-500/30">
                          VIP
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5 min-w-0">
                      <span className="truncate min-w-0">{item.track.artist}</span>
                      <TrackKeyBpmBadges
                        initialKey={item.track.initialKey}
                        initialBpm={item.track.initialBpm}
                        pitchOffset={item.pitchOffset}
                      />
                      <span>•</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          useKaraokeStore.getState().loadSingersFromDb();
                          onEditSinger(item);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800/90 hover:bg-indigo-900/60 border border-slate-700/60 hover:border-indigo-500/60 text-indigo-300 hover:text-indigo-100 font-medium transition-colors text-[11px] group/singer max-w-[170px]"
                        title="Clicca per assegnare o modificare il cantante"
                      >
                        <Mic className="w-3 h-3 text-indigo-400 group-hover/singer:text-indigo-200 shrink-0" />
                        <span className="truncate">
                          {item.assignedSingerName || (
                            <span className="text-amber-400/90 italic font-normal">+ Assegna cantante</span>
                          )}
                        </span>
                        <Edit2 className="w-2.5 h-2.5 opacity-60 group-hover/singer:opacity-100 text-slate-400 group-hover/singer:text-white shrink-0 ml-0.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      const newPitch = item.pitchOffset - 1;
                      if (index === 0) setLivePitch(newPitch);
                      else setQueueItemPitch(item.queueId, newPitch);
                    }}
                    className="w-6 h-6 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center border border-slate-700/60 transition-colors"
                    title="Abbassa tonalità (-1 semitono)"
                  >
                    -
                  </button>
                  <span className="text-[10px] font-mono bg-slate-800/90 px-2 py-0.5 rounded-full text-indigo-300 font-bold min-w-[40px] text-center border border-slate-700/60">
                    {item.pitchOffset > 0 ? `+${item.pitchOffset}` : item.pitchOffset} ST
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newPitch = item.pitchOffset + 1;
                      if (index === 0) setLivePitch(newPitch);
                      else setQueueItemPitch(item.queueId, newPitch);
                    }}
                    className="w-6 h-6 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center border border-slate-700/60 transition-colors"
                    title="Alza tonalità (+1 semitono)"
                  >
                    +
                  </button>
                  {(item.track.source !== 'local_library' || item.track.localFilePath?.includes('queue_cache')) &&
                    item.track.localFilePath && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSaveToPermanentLibrary(item.track);
                        }}
                        disabled={savingTrackIds.has(item.track.id)}
                        className="p-1 hover:bg-emerald-950/60 rounded text-emerald-400 hover:text-emerald-300 transition-colors ml-0.5"
                        title={t('library.saveToLibrary', 'Salva in Libreria')}
                      >
                        <Download className={`w-3.5 h-3.5 ${savingTrackIds.has(item.track.id) ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (await confirmAsync(t('queue.confirmRemove', 'Rimuovere questo brano dalla coda?'))) {
                        removeFromQueue(item.queueId);
                      }
                    }}
                    className="p-1.5 hover:bg-slate-800 rounded-full text-slate-500 hover:text-red-400 transition-colors ml-1.5"
                    title={t('queue.remove', 'Rimuovi dalla coda')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
