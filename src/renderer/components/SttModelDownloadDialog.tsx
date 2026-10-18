import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, HardDrive } from 'lucide-react';
import {
  WHISPER_MODEL_IDS,
  WHISPER_MODELS,
  coerceWhisperModelId,
  formatBytesApprox,
  type WhisperModelId
} from '../../shared/whisperStt';

interface SttModelDownloadDialogProps {
  isOpen: boolean;
  selectedModelId: WhisperModelId | string;
  modelsDirHint?: string;
  downloading?: boolean;
  progressLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Activation gate before karaoke STT: lists all Whisper models with size / singing
 * quality / HW expectations. Models live only under userData — never in the installer.
 */
export const SttModelDownloadDialog: React.FC<SttModelDownloadDialogProps> = ({
  isOpen,
  selectedModelId,
  modelsDirHint,
  downloading,
  progressLabel,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation();
  const selected = coerceWhisperModelId(selectedModelId);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !downloading) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, downloading, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      data-testid="stt-model-download-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stt-model-download-title"
      onClick={() => {
        if (!downloading) onCancel();
      }}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h3 id="stt-model-download-title" className="font-bold text-base text-white">
              {t('stt.downloadDialogTitle')}
            </h3>
            <p className="text-slate-300 text-xs mt-1 leading-relaxed">
              {t('stt.downloadDialogIntro')}
            </p>
          </div>
        </div>

        <div
          className="flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-3 py-2.5 text-amber-100"
          role="note"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <p className="text-xs leading-relaxed">{t('stt.downloadDialogPathNote')}</p>
        </div>

        {modelsDirHint ? (
          <p
            className="text-[10px] font-mono text-slate-500 break-all"
            data-testid="stt-models-dir-hint"
          >
            {modelsDirHint}
          </p>
        ) : null}

        <ul className="space-y-2" data-testid="stt-model-catalog-list">
          {WHISPER_MODEL_IDS.map((id) => {
            const m = WHISPER_MODELS[id];
            const isSel = id === selected;
            return (
              <li
                key={id}
                className={`rounded-xl border px-3 py-2.5 text-xs ${
                  isSel
                    ? 'border-sky-500/60 bg-sky-950/40 text-sky-50'
                    : 'border-slate-700/80 bg-slate-950/40 text-slate-300'
                }`}
                data-testid={`stt-model-row-${id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {id}
                    {m.isDefault ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-300">
                        {t('settings.sttModelDefaultBadge')}
                      </span>
                    ) : null}
                    {isSel ? (
                      <span className="ml-2 text-[10px] text-emerald-300">
                        {t('stt.downloadDialogSelected')}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-slate-400">{formatBytesApprox(m.approxBytes)}</span>
                </div>
                <p className="mt-1 text-slate-400 leading-relaxed">
                  {t(`stt.modelQuality.${m.qualityKey}`)} · {t(`stt.modelSpeed.${m.speedKey}`)} ·{' '}
                  {t(`stt.modelHw.${m.hwHintKey}`)}
                </p>
              </li>
            );
          })}
        </ul>

        {downloading ? (
          <p className="text-xs text-sky-200" data-testid="stt-model-download-progress">
            {progressLabel || t('stt.downloadDialogDownloading')}
          </p>
        ) : null}

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={downloading}
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-all"
            data-testid="stt-model-download-cancel"
          >
            {t('stt.downloadDialogCancel')}
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={onConfirm}
            className="px-4 py-2 rounded-full text-xs font-semibold text-sky-50 bg-sky-700 hover:bg-sky-600 border border-sky-500/60 disabled:opacity-50 transition-all inline-flex items-center gap-1.5"
            data-testid="stt-model-download-confirm"
          >
            <Download className="w-3.5 h-3.5" />
            {t('stt.downloadDialogConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
