import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileX, Trash2, List } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { confirmAsync, showToast } from '../utils/toast';

/**
 * MissingFileModal
 *
 * Operator dialog when a local media path no longer exists (USB unplugged, moved, deleted
 * outside the app). Never auto-deletes catalog or queue rows — Elimina is explicit.
 *
 * Contexts:
 * - `library` — blocked enqueue; Elimina → `db.deleteTrack`
 * - `queue` — blocked play / jump / auto-advance; Elimina → `removeFromQueue`, optional
 *   also-from-library confirm for `local_library` tracks
 *
 * Lascia keeps the row marked red via `missingTrackIds`.
 */
export const MissingFileModal: React.FC = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const modal = useKaraokeStore((s) => s.missingFileModal);
  const closeMissingFileModal = useKaraokeStore((s) => s.closeMissingFileModal);
  const removeFromQueue = useKaraokeStore((s) => s.removeFromQueue);
  const clearTrackMissing = useKaraokeStore((s) => s.clearTrackMissing);
  const queue = useKaraokeStore((s) => s.queue);

  if (!modal.isOpen) return null;

  const handleKeep = () => {
    // Lascia: keep red mark (already in missingTrackIds from showMissingFileModal)
    closeMissingFileModal();
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (modal.context === 'library') {
        if (modal.trackId && window.karaokeApi?.db?.deleteTrack) {
          const res = await window.karaokeApi.db.deleteTrack(modal.trackId);
          if (!res?.success) {
            showToast(t('library.deleteFailed'), 'error');
            return;
          }
          clearTrackMissing(modal.trackId);
          window.dispatchEvent(
            new CustomEvent('karaoke:track-deleted', {
              detail: { trackId: modal.trackId, localFilePath: modal.filePath }
            })
          );
          window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
          showToast(t('library.deleteSuccess'), 'success');
        }
      } else {
        // Queue context
        if (modal.queueItemId) {
          const item =
            queue.find((q) => q.queueId === modal.queueItemId) ||
            queue.find((q) => q.track.id === modal.trackId);
          removeFromQueue(modal.queueItemId);
          if (modal.trackId) clearTrackMissing(modal.trackId);

          const isLibraryTrack =
            item?.track.source === 'local_library' || item?.track.source === 'midi';
          if (isLibraryTrack && item?.track.id && window.karaokeApi?.db?.deleteTrack) {
            const alsoDelete = await confirmAsync(
              t('errors.missingFileAlsoDeleteLibraryMessage', {
                title: modal.trackTitle
              }),
              {
                confirmLabel: t('errors.missingFileAlsoDeleteLibraryConfirm'),
                cancelLabel: t('errors.missingFileAlsoDeleteLibraryCancel')
              }
            );
            if (alsoDelete) {
              const res = await window.karaokeApi.db.deleteTrack(item.track.id);
              if (res?.success) {
                window.dispatchEvent(
                  new CustomEvent('karaoke:track-deleted', {
                    detail: {
                      trackId: item.track.id,
                      localFilePath: item.track.localFilePath || modal.filePath
                    }
                  })
                );
                window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
                showToast(t('library.deleteSuccess'), 'success');
              }
            }
          }
        }
      }
      closeMissingFileModal();
    } catch (err) {
      console.error('MissingFileModal delete failed:', err);
      showToast(t('library.deleteFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      data-testid="missing-file-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="missing-file-modal-title"
    >
      <div className="bg-slate-900 border border-rose-500/70 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-scale-in">
        <div className="flex items-center gap-3 text-rose-400 mb-3">
          <div className="p-2 rounded-xl bg-rose-950/50 border border-rose-500/40">
            <FileX className="w-5 h-5" />
          </div>
          <h3 id="missing-file-modal-title" className="font-bold text-base text-white">
            {t('errors.missingFileTitle')}
          </h3>
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <div className="font-semibold text-sm text-slate-100 truncate" title={modal.trackTitle}>
              {modal.trackTitle || '—'}
            </div>
            {modal.trackArtist ? (
              <div className="text-xs text-slate-400 truncate mt-0.5">{modal.trackArtist}</div>
            ) : null}
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              {t('errors.missingFilePathLabel')}
            </div>
            <code
              className="block font-mono text-[11px] text-rose-300/90 break-all select-all leading-relaxed"
              title={modal.filePath}
            >
              {modal.filePath || '—'}
            </code>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed flex gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{t('errors.missingFileUsbHint')}</span>
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleKeep}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 disabled:opacity-50"
            data-testid="missing-file-keep"
          >
            <List className="w-3.5 h-3.5" />
            {t('errors.missingFileKeep')}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white border border-rose-400/40 flex items-center gap-1.5 disabled:opacity-50"
            data-testid="missing-file-delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('errors.missingFileDelete')}
          </button>
        </div>
      </div>
    </div>
  );
};
