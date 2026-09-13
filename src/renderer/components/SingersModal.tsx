import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Users, Star, Music, Plus, Trash2 } from 'lucide-react';
import { SingerProfile } from '../../shared/types';
import { useKaraokeStore } from '../store/karaokeStore';

interface SingersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SingersModal
 *
 * Singer Profile and Rotation Management Modal.
 * Capabilities:
 * - View registered singers, song counts, and VIP favorite status.
 * - Add new singers on the fly.
 * - Toggle permanent VIP / favorite status (starred singers appear at the top of selection lists).
 * - Safely delete singers with an inline confirmation state to avoid accidental clicks.
 * - Syncs changes immediately across the SQLite database and Zustand store.
 */
export const SingersModal: React.FC<SingersModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [singersList, setSingersList] = useState<SingerProfile[]>([]);
  const [newSingerName, setNewSingerName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const getOrCreateSinger = useKaraokeStore((state) => state.getOrCreateSingerProfile);
  const removeSinger = useKaraokeStore((state) => state.removeSingerProfile);

  const loadSingers = async () => {
    if (window.karaokeApi) {
      const data = await window.karaokeApi.db.getAllSingers();
      setSingersList(data);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSingers();
      setConfirmDeleteId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSingerName.trim();
    if (!trimmed) return;

    // Prevent duplicate singers (case-insensitive check)
    const exists = singersList.some(
      (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      alert(t('singers.alreadyExists'));
      return;
    }

    getOrCreateSinger(trimmed);
    setNewSingerName('');
    await loadSingers();
    await useKaraokeStore.getState().loadSingersFromDb();
  };

  const handleToggleFavorite = async (singerId: string, currentVal: boolean) => {
    if (window.karaokeApi) {
      await window.karaokeApi.db.setSingerPermanent(singerId, !currentVal);
      await loadSingers();
      await useKaraokeStore.getState().loadSingersFromDb();
    }
  };

  const handleDeleteSinger = async (singerId: string) => {
    removeSinger(singerId);
    setConfirmDeleteId(null);
    await loadSingers();
    await useKaraokeStore.getState().loadSingersFromDb();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900/95 border border-slate-700/80 rounded-3xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh] backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Users className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-white">{t('singers.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add Form */}
        <form onSubmit={handleAddNew} className="py-4 flex gap-2 border-b border-slate-800">
          <input
            type="text"
            placeholder={t('singers.addPlaceholder')}
            value={newSingerName}
            onChange={(e) => setNewSingerName(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-700/80 rounded-full px-4 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-gradient-to-tr from-indigo-600 to-violet-500 hover:from-indigo-500 hover:to-violet-400 text-white rounded-full text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" /> {t('singers.addBtn')}
          </button>
        </form>

        {/* Singers List */}
        <div className="flex-1 overflow-y-auto py-2 space-y-2 pr-1">
          {singersList.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs italic">
              {t('singers.empty')}
            </div>
          ) : (
            singersList.map((s) => (
              <div
                key={s.id}
                className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(s.id, s.isPermanentFavorite)}
                    title={s.isPermanentFavorite ? t('singers.permanentFavorite') : t('singers.setPermanent')}
                    className={`p-2 rounded-full border transition-all active:scale-95 ${
                      s.isPermanentFavorite
                        ? 'bg-amber-950/60 border-amber-600/80 text-amber-300 shadow-sm shadow-amber-500/20'
                        : 'bg-slate-800/80 border-slate-700/60 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Star className="w-4 h-4 fill-current" />
                  </button>

                  <div>
                    <div className="font-bold text-xs text-white">{s.name}</div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1 font-medium">
                        <Music className="w-3 h-3 text-indigo-400" />
                        {t('singers.songsSung', { count: s.songsSungCount })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {confirmDeleteId === s.id ? (
                    <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-800/80 px-3 py-1.5 rounded-full animate-in fade-in">
                      <span className="text-[11px] text-red-300 font-medium">
                        {t('singers.confirmDelete')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteSinger(s.id)}
                        className="px-2.5 py-0.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-colors shadow-sm"
                      >
                        {t('singers.delete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
                      >
                        {t('singers.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(s.id)}
                      title={t('singers.delete')}
                      className="p-2 rounded-full border border-slate-800 bg-slate-900 text-slate-400 hover:text-red-400 hover:border-red-600/50 hover:bg-red-950/40 transition-all active:scale-95"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-slate-800/90 hover:bg-slate-700 text-white font-semibold rounded-full text-xs transition-colors shadow-sm"
          >
            {t('singers.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
