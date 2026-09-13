import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Smartphone, Check, Trash2, Clock } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { KaraokeMediaTrack, GuestSongRequest } from '../../shared/types';

interface GuestRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * GuestRequestsModal
 *
 * Audience Request Approval Queue.
 * Allows the karaoke host to review incoming song requests sent by patrons via the mobile web portal:
 * - Shows singer name, requested track title, requested artist, notes, and submission timestamp.
 * - One-click approval inserts the track directly into the fair queue under the guest's singer profile.
 * - Rejection dismisses the request from the pending list.
 */
export const GuestRequestsModal: React.FC<GuestRequestsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const pendingRequests = useKaraokeStore((state) => state.pendingGuestRequests);
  const approveRequest = useKaraokeStore((state) => state.approveGuestRequest);
  const rejectRequest = useKaraokeStore((state) => state.rejectGuestRequest);

  if (!isOpen) return null;

  const handleApprove = async (req: GuestSongRequest) => {
    let trackToQueue: KaraokeMediaTrack | undefined;

    if (typeof window !== 'undefined' && window.karaokeApi?.db) {
      try {
        const tracks = await window.karaokeApi.db.getTracks();
        if (req.trackId) {
          trackToQueue = tracks.find((t) => t.id === req.trackId);
        }
        if (!trackToQueue) {
          trackToQueue = tracks.find(
            (t) =>
              t.title.toLowerCase() === req.trackTitle.toLowerCase() &&
              t.artist.toLowerCase() === req.trackArtist.toLowerCase()
          );
        }
        if (!trackToQueue) {
          trackToQueue = tracks.find(
            (t) => t.title.toLowerCase() === req.trackTitle.toLowerCase()
          );
        }
      } catch (err) {
        console.error('Failed to query catalog for guest request:', err);
      }
    }

    if (!trackToQueue) {
      trackToQueue = {
        id: req.trackId || `guest_track_${Date.now()}`,
        source: 'local_library',
        title: req.trackTitle,
        artist: req.trackArtist,
        durationSec: 200,
        uri: req.sourceUri || ''
      };
    }
    approveRequest(req.requestId, trackToQueue);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900/95 border border-slate-800/80 rounded-3xl max-w-xl w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-950/60 rounded-xl border border-indigo-800/50">
              <Smartphone className="w-5 h-5 text-indigo-400" />
            </div>
            <h2 className="text-base font-bold text-white">
              {t('guestRequests.title')} ({pendingRequests.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800/80 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Requests List */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs italic">
              {t('guestRequests.empty')}
            </div>
          ) : (
            pendingRequests.map((req) => (
              <div
                key={req.requestId}
                className="p-3.5 bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl flex items-center justify-between gap-3 transition-all"
              >
                <div>
                  <div className="font-bold text-xs text-white flex items-center gap-2">
                    <span>{req.trackTitle}</span>
                    <span className="text-indigo-400 font-normal">({req.trackArtist})</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-0.5 rounded-full text-[10px]">
                      {t('guestRequests.singer')}: {req.singerName}
                    </span>
                    <span className="font-mono text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2 py-0.5 rounded-full text-[10px]">
                      {t('guestRequests.pitch')}: {req.preferredPitch > 0 ? `+${req.preferredPitch}` : req.preferredPitch} ST
                    </span>
                    <span className="flex items-center gap-1 text-slate-400 text-[10px] bg-slate-800/60 px-2 py-0.5 rounded-full">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {new Date(req.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApprove(req)}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-full text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/25 transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> {t('guestRequests.approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectRequest(req.requestId)}
                    className="p-2 bg-slate-800/80 hover:bg-red-950/60 hover:text-red-400 text-slate-400 border border-slate-700/50 rounded-full transition-all"
                    title={t('guestRequests.reject')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-slate-800/80 hover:bg-slate-700 text-white font-semibold rounded-full text-xs transition-all"
          >
            {t('guestRequests.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
