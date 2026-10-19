import React, { useCallback, useEffect, useState } from 'react';
import {
  Library,
  Folder,
  FolderOpen,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Cpu,
  Trash2,
} from 'lucide-react';
import {
  WHISPER_MODEL_IDS,
  WHISPER_MODELS,
  coerceWhisperModelId,
  formatBytesApprox,
  type WhisperModelId,
} from '../../../shared/whisperStt';
import {
  clampAiCpuThreadsForUi,
  coerceAiCpuThreads,
} from '../../../shared/aiCpuThreads';
import { coerceInstrumentalVocalRemoverMethod } from '../../../shared/vocalRemover';
import {
  coerceMdxEnableOrt,
  coerceMdxOverlap,
  coerceMdxSegmentSize,
  MDX_OVERLAP_MAX,
  MDX_OVERLAP_MIN,
  MDX_OVERLAP_STEP,
  MDX_OVERLAP_WARN_THRESHOLD,
  MDX_SEGMENT_SIZES,
  isMdxInstrumentalMethod,
} from '../../../shared/mdxAdvancedSettings';
import {
  coerceDemucsOverlap,
  coerceDemucsSegmentSize,
  coerceDemucsShifts,
  DEMUCS_OVERLAP_MAX,
  DEMUCS_OVERLAP_MIN,
  DEMUCS_OVERLAP_STEP,
  DEMUCS_SEGMENT_MAX,
  DEMUCS_SEGMENT_MIN,
  DEMUCS_SHIFTS_OPTIONS,
  isDemucsInstrumentalMethod,
} from '../../../shared/demucsAdvancedSettings';
import { coerceAiEnableGpu } from '../../../shared/aiOrtProviders';
import { coerceAiGpuPreference, type AiGpuPreference } from '../../../shared/aiGpuPreference';
import type { SettingsLibraryTabProps } from './settingsTypes';

/**
 * Library & Download settings tab: path, auto-archive, concurrency, instrumental AI, yt-dlp.
 *
 * **Audience (humans):** Where tracks live, how downloads run, and yt-dlp status.
 *
 * **Audience (AI):** Preserve instrumental method / MDX / Demucs / GPU coerce helpers and
 * logger source `SettingsModal`. Auto-archive off opens the parent confirm modal via
 * `setShowAutoArchiveConfirm` — do not inline that dialog here. Download Instrumental
 * select is AI-only (`aiMdxKaraoke2` | `aiHtDemucs`); live Regia DSP modes stay on Audio.
 * AI acceleration UI: GPU toggle+badge and CPU cores are sibling bordered cards; MDX
 * `mdxEnableOrt` lives in the CPU card (still MDX-method-only).
 * `instrumentalSubtitlesPolicy` select mirrors the modal “remember my choice” (ask/always/never).
 */
export const SettingsLibraryTab: React.FC<SettingsLibraryTabProps> = ({
  t,
  settings,
  updateSettings,
  isSearching,
  matchLibraryPath,
  matchAutoArchive,
  matchMaxDownloads,
  matchInstrumentalVocal,
  matchInstrumentalSubtitles,
  matchAiThreads,
  matchYtdlp,
  cpuCoreCount,
  gpuStatus,
  isCheckingYtdlp,
  ytdlpStatus,
  ytdlpMessage,
  youtubeCookieStatus,
  isYoutubeLoginBusy,
  youtubeCookieMessage,
  setShowAutoArchiveConfirm,
  handleSelectLibraryPath,
  handleCheckYtDlpUpdate,
  handleYouTubeLogin,
  handleClearYouTubeCookies,
}) => {
  const [sttStatus, setSttStatus] = useState<{
    binaryReady: boolean;
    modelsDir: string;
    models: Array<{ modelId: string; present: boolean; bytesOnDisk: number }>;
  } | null>(null);
  const [sttBusyId, setSttBusyId] = useState<string | null>(null);

  const refreshSttStatus = useCallback(async () => {
    try {
      const status = await window.karaokeApi?.karaokeStt?.getStatus();
      if (status) setSttStatus(status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshSttStatus();
    const unsub = window.karaokeApi?.karaokeStt?.onModelProgress?.(() => {
      void refreshSttStatus();
    });
    return () => {
      unsub?.();
    };
  }, [refreshSttStatus]);

  return (
              <div className="space-y-4">
                <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Library className="w-4 h-4 text-emerald-400" />
                  {t('settings.tabLibrary', 'Libreria & Download')}
                </h3>

                {(!isSearching || matchLibraryPath) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
                    <label className="block text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium text-xs">
                      <Folder className="w-4 h-4 text-emerald-400" />
                      {t('settings.libraryPath')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={settings.libraryPath || ''}
                        placeholder={t('settings.noLibraryPathSelected')}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleSelectLibraryPath}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 font-semibold transition-colors"
                      >
                        <FolderOpen className="w-4 h-4 text-emerald-400" />
                        {t('settings.browse')}
                      </button>
                    </div>
                  </div>
                )}

                {(!isSearching || matchAutoArchive) && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoArchiveWebTracks}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setShowAutoArchiveConfirm(true);
                        } else {
                          updateSettings({ autoArchiveWebTracks: true });
                        }
                      }}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span>{t('settings.autoArchive')}</span>
                  </label>
                )}

                {(!isSearching || matchMaxDownloads) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                    <label className="block font-semibold text-white text-xs">
                      {t('settings.maxSimultaneousDownloads')}
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('settings.maxSimultaneousDownloadsDesc')}
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={8}
                        step={1}
                        value={Math.min(8, Math.max(1, settings.maxSimultaneousDownloads || 2))}
                        onChange={(e) =>
                          updateSettings({
                            maxSimultaneousDownloads: Math.min(
                              8,
                              Math.max(1, parseInt(e.target.value, 10) || 2)
                            )
                          })
                        }
                        className="flex-1 accent-indigo-600"
                      />
                      <span className="font-mono text-indigo-300 text-sm w-6 text-center">
                        {Math.min(8, Math.max(1, settings.maxSimultaneousDownloads || 2))}
                      </span>
                    </div>
                  </div>
                )}

                {(!isSearching || matchInstrumentalVocal) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                    <label className="block font-semibold text-white text-xs">
                      {t('settings.instrumentalVocalRemover')}
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('settings.instrumentalVocalRemoverDesc')}
                    </p>
                    <select
                      value={coerceInstrumentalVocalRemoverMethod(
                        settings.instrumentalVocalRemoverMethod
                      )}
                      onChange={(e) => {
                        const next = coerceInstrumentalVocalRemoverMethod(e.target.value);
                        const prev = coerceInstrumentalVocalRemoverMethod(
                          settings.instrumentalVocalRemoverMethod
                        );
                        updateSettings({ instrumentalVocalRemoverMethod: next });
                        if (prev !== next && window.karaokeApi?.logger?.log) {
                          window.karaokeApi.logger.log(
                            'info',
                            'SettingsModal',
                            `Instrumental vocal remover method → ${next}`
                          );
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                    >
                      <option value="aiMdxKaraoke2">{t('settings.vocalAiMdxKaraoke2')}</option>
                      <option value="aiHtDemucs">{t('settings.vocalAiHtDemucs')}</option>
                    </select>

                    {/* MDX-only advanced ETA panel — hidden for Demucs */}
                    {isMdxInstrumentalMethod(
                      coerceInstrumentalVocalRemoverMethod(settings.instrumentalVocalRemoverMethod)
                    ) && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3">
                        <div>
                          <p className="font-semibold text-white text-xs">
                            {t('settings.mdxAdvancedTitle')}
                          </p>
                          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                            {t('settings.mdxAdvancedDesc')}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <label
                            className="block text-[11px] font-medium text-slate-200"
                            title={t('settings.mdxSegmentSizeTooltip')}
                          >
                            {t('settings.mdxSegmentSize')}
                            <span className="ml-2 font-mono text-indigo-300">
                              {coerceMdxSegmentSize(settings.mdxSegmentSize)}
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {t('settings.mdxSegmentSizeTooltip')}
                          </p>
                          <input
                            type="range"
                            min={0}
                            max={MDX_SEGMENT_SIZES.length - 1}
                            step={1}
                            value={Math.max(
                              0,
                              MDX_SEGMENT_SIZES.indexOf(
                                coerceMdxSegmentSize(settings.mdxSegmentSize) as (typeof MDX_SEGMENT_SIZES)[number]
                              )
                            )}
                            onChange={(e) => {
                              const idx = parseInt(e.target.value, 10);
                              const next = MDX_SEGMENT_SIZES[idx] ?? 256;
                              updateSettings({ mdxSegmentSize: coerceMdxSegmentSize(next) });
                            }}
                            className="w-full accent-indigo-600"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateSettings({ mdxSegmentSize: 256 })}
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                coerceMdxSegmentSize(settings.mdxSegmentSize) === 256
                                  ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {t('settings.mdxSegmentChip256')}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSettings({ mdxSegmentSize: 512 })}
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                coerceMdxSegmentSize(settings.mdxSegmentSize) === 512
                                  ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {t('settings.mdxSegmentChip512')}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label
                            className="block text-[11px] font-medium text-slate-200"
                            title={t('settings.mdxOverlapTooltip')}
                          >
                            {t('settings.mdxOverlap')}
                            <span className="ml-2 font-mono text-indigo-300">
                              {coerceMdxOverlap(settings.mdxOverlap).toFixed(2)}
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {t('settings.mdxOverlapTooltip')}
                          </p>
                          <input
                            type="range"
                            min={MDX_OVERLAP_MIN}
                            max={MDX_OVERLAP_MAX}
                            step={MDX_OVERLAP_STEP}
                            value={coerceMdxOverlap(settings.mdxOverlap)}
                            onChange={(e) =>
                              updateSettings({
                                mdxOverlap: coerceMdxOverlap(parseFloat(e.target.value))
                              })
                            }
                            className="w-full accent-indigo-600"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                [0.25, 'settings.mdxOverlapChip025'],
                                [0.5, 'settings.mdxOverlapChip050'],
                                [0.75, 'settings.mdxOverlapChip075']
                              ] as const
                            ).map(([value, labelKey]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  updateSettings({ mdxOverlap: coerceMdxOverlap(value) })
                                }
                                className={`px-2 py-0.5 rounded text-[10px] border ${
                                  Math.abs(coerceMdxOverlap(settings.mdxOverlap) - value) < 0.001
                                    ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                }`}
                              >
                                {t(labelKey)}
                              </button>
                            ))}
                          </div>
                          {coerceMdxOverlap(settings.mdxOverlap) >= MDX_OVERLAP_WARN_THRESHOLD && (
                            <div className="flex items-start gap-1.5 rounded-lg border border-amber-700/60 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-200 leading-relaxed">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                              <span>{t('settings.mdxOverlapHighWarning')}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Demucs-only advanced panel — hidden for MDX */}
                    {isDemucsInstrumentalMethod(
                      coerceInstrumentalVocalRemoverMethod(settings.instrumentalVocalRemoverMethod)
                    ) && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3">
                        <div>
                          <p className="font-semibold text-white text-xs">
                            {t('settings.demucsAdvancedTitle')}
                          </p>
                          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                            {t('settings.demucsAdvancedDesc')}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-medium text-slate-200">
                            {t('settings.demucsShifts')}
                            <span className="ml-2 font-mono text-indigo-300">
                              {coerceDemucsShifts(settings.demucsShifts)}
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {t('settings.demucsShiftsDesc')}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {DEMUCS_SHIFTS_OPTIONS.map((value) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  updateSettings({ demucsShifts: coerceDemucsShifts(value) })
                                }
                                className={`px-2 py-0.5 rounded text-[10px] border ${
                                  coerceDemucsShifts(settings.demucsShifts) === value
                                    ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                }`}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-medium text-slate-200">
                            {t('settings.demucsSegmentSize')}
                            <span className="ml-2 font-mono text-indigo-300">
                              {coerceDemucsSegmentSize(settings.demucsSegmentSize).toFixed(1)}s
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {t('settings.demucsSegmentSizeDesc')}
                          </p>
                          <input
                            type="range"
                            min={DEMUCS_SEGMENT_MIN}
                            max={DEMUCS_SEGMENT_MAX}
                            step={0.5}
                            value={coerceDemucsSegmentSize(settings.demucsSegmentSize)}
                            onChange={(e) =>
                              updateSettings({
                                demucsSegmentSize: coerceDemucsSegmentSize(parseFloat(e.target.value))
                              })
                            }
                            className="w-full accent-indigo-600"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-medium text-slate-200">
                            {t('settings.demucsOverlap')}
                            <span className="ml-2 font-mono text-indigo-300">
                              {coerceDemucsOverlap(settings.demucsOverlap).toFixed(2)}
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {t('settings.demucsOverlapDesc')}
                          </p>
                          <input
                            type="range"
                            min={DEMUCS_OVERLAP_MIN}
                            max={DEMUCS_OVERLAP_MAX}
                            step={DEMUCS_OVERLAP_STEP}
                            value={coerceDemucsOverlap(settings.demucsOverlap)}
                            onChange={(e) =>
                              updateSettings({
                                demucsOverlap: coerceDemucsOverlap(parseFloat(e.target.value))
                              })
                            }
                            className="w-full accent-indigo-600"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Same meaning as InstrumentalSubtitlesModal “Remember my choice” */}
                {(!isSearching || matchInstrumentalSubtitles) && (
                  <div
                    className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2"
                    data-testid="settings-instrumental-subtitles-policy"
                  >
                    <label
                      className="block font-semibold text-white text-xs"
                      htmlFor="settings-instrumental-subtitles-policy"
                    >
                      {t('settings.instrumentalSubtitlesPolicy')}
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('settings.instrumentalSubtitlesPolicyDesc')}
                    </p>
                    <select
                      id="settings-instrumental-subtitles-policy"
                      value={
                        settings.instrumentalSubtitlesPolicy === 'always' ||
                        settings.instrumentalSubtitlesPolicy === 'never'
                          ? settings.instrumentalSubtitlesPolicy
                          : 'ask'
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next =
                          raw === 'always' || raw === 'never' ? raw : 'ask';
                        updateSettings({ instrumentalSubtitlesPolicy: next });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                      data-testid="settings-instrumental-subtitles-policy-select"
                    >
                      <option value="ask">
                        {t('settings.instrumentalSubtitlesPolicyAsk')}
                      </option>
                      <option value="always">
                        {t('settings.instrumentalSubtitlesPolicyAlways')}
                      </option>
                      <option value="never">
                        {t('settings.instrumentalSubtitlesPolicyNever')}
                      </option>
                    </select>
                  </div>
                )}

                {(!isSearching || matchInstrumentalSubtitles) && (
                  <div
                    className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-3"
                    data-testid="settings-stt-whisper"
                  >
                    <div>
                      <label
                        className="block font-semibold text-white text-xs"
                        htmlFor="settings-stt-model"
                      >
                        {t('settings.sttModelTitle')}
                      </label>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                        {t('settings.sttModelDesc')}
                      </p>
                      {sttStatus?.modelsDir ? (
                        <p className="text-[10px] font-mono text-slate-500 break-all mt-1">
                          {sttStatus.modelsDir}
                        </p>
                      ) : null}
                    </div>
                    <select
                      id="settings-stt-model"
                      value={coerceWhisperModelId(settings.sttModelId)}
                      onChange={(e) =>
                        updateSettings({
                          sttModelId: coerceWhisperModelId(e.target.value)
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                      data-testid="settings-stt-model-select"
                    >
                      {WHISPER_MODEL_IDS.map((id) => (
                        <option key={id} value={id}>
                          {id}
                          {WHISPER_MODELS[id].isDefault
                            ? ` (${t('settings.sttModelDefaultBadge')})`
                            : ''}{' '}
                          — {formatBytesApprox(WHISPER_MODELS[id].approxBytes)}
                        </option>
                      ))}
                    </select>
                    <div className="space-y-1.5">
                      <label
                        className="block text-[11px] font-medium text-slate-200"
                        htmlFor="settings-stt-display-mode"
                      >
                        {t('settings.sttDisplayMode')}
                      </label>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        {t('settings.sttDisplayModeDesc')}
                      </p>
                      <select
                        id="settings-stt-display-mode"
                        value={
                          settings.sttDisplayMode === 'stage' ? 'stage' : 'burn-in'
                        }
                        onChange={(e) =>
                          updateSettings({
                            sttDisplayMode:
                              e.target.value === 'stage' ? 'stage' : 'burn-in'
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                        data-testid="settings-stt-display-mode-select"
                      >
                        <option value="burn-in">
                          {t('settings.sttDisplayModeBurnIn')}
                        </option>
                        <option value="stage">
                          {t('settings.sttDisplayModeStage')}
                        </option>
                      </select>
                    </div>
                    <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.sttPreferVocalStem !== false}
                        onChange={(e) =>
                          updateSettings({ sttPreferVocalStem: e.target.checked })
                        }
                        className="mt-0.5 rounded border-slate-600"
                      />
                      <span>{t('settings.sttPreferVocalStem')}</span>
                    </label>
                    <ul className="space-y-2">
                      {WHISPER_MODEL_IDS.map((id) => {
                        const info = sttStatus?.models?.find((m) => m.modelId === id);
                        const present = Boolean(info?.present);
                        const bytes = info?.bytesOnDisk || 0;
                        return (
                          <li
                            key={id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 text-[11px]"
                            data-testid={`settings-stt-row-${id}`}
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-200">{id}</span>
                              {WHISPER_MODELS[id].isDefault ? (
                                <span className="ml-1 text-sky-400">
                                  ({t('settings.sttModelDefaultBadge')})
                                </span>
                              ) : null}
                              <span className="block text-slate-500 truncate">
                                {present
                                  ? t('settings.sttModelReady', {
                                      size: formatBytesApprox(bytes)
                                    })
                                  : t('settings.sttModelNotDownloaded', {
                                      size: formatBytesApprox(
                                        WHISPER_MODELS[id].approxBytes
                                      )
                                    })}
                              </span>
                            </div>
                            {present ? (
                              <button
                                type="button"
                                disabled={sttBusyId === id}
                                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-800/60 text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
                                data-testid={`settings-stt-delete-${id}`}
                                onClick={() => {
                                  const sizeLabel = formatBytesApprox(bytes);
                                  if (
                                    !window.confirm(
                                      t('settings.sttDeleteConfirm', {
                                        model: id,
                                        size: sizeLabel
                                      })
                                    )
                                  ) {
                                    return;
                                  }
                                  setSttBusyId(id);
                                  void window.karaokeApi?.karaokeStt
                                    ?.deleteModel(id as WhisperModelId)
                                    .then(() => refreshSttStatus())
                                    .finally(() => setSttBusyId(null));
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                                {t('settings.sttDelete')}
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      className="text-[11px] text-rose-300/90 hover:text-rose-200 underline-offset-2 hover:underline"
                      data-testid="settings-stt-delete-all"
                      onClick={() => {
                        if (!window.confirm(t('settings.sttDeleteAllConfirm'))) return;
                        setSttBusyId('all');
                        void window.karaokeApi?.karaokeStt
                          ?.deleteAllModels()
                          .then(() => refreshSttStatus())
                          .finally(() => setSttBusyId(null));
                      }}
                    >
                      {t('settings.sttDeleteAll')}
                    </button>
                    <p className="text-[11px] text-amber-200/80 leading-relaxed">
                      {t('settings.sttHonesty')}
                    </p>
                    <p
                      className="text-[11px] text-slate-400 leading-relaxed"
                      data-testid="settings-stt-gpu-cpu-note"
                    >
                      {t('settings.sttGpuCpuNote')}
                    </p>
                  </div>
                )}

                {(!isSearching || matchAiThreads) && (() => {
                  const gpuOn = coerceAiEnableGpu(settings.aiEnableGpu);
                  const gpuPref = coerceAiGpuPreference(settings.aiGpuPreference);
                  // Honest EP: green only when AI worker can actually host WebGPU.
                  const workerWebGpu =
                    gpuStatus?.workerWebGpuAvailable === true || gpuStatus?.isSupported === true;
                  const hardwareGpu =
                    gpuStatus?.hardwareGpuPresent === true ||
                    Boolean(gpuStatus?.gpuName && gpuStatus.gpuName.trim());
                  const effectiveLabel =
                    gpuStatus?.effectiveAdapter?.label?.trim() ||
                    (gpuStatus?.gpuName && gpuStatus.gpuName.trim()) ||
                    '';
                  const hwName = effectiveLabel || t('settings.aiGpuBadgeSupported');
                  const badgeActiveGpu = gpuOn && workerWebGpu;
                  const badgeDetail = badgeActiveGpu
                    ? hwName
                    : t('settings.aiGpuBadgeWasmWorker');
                  const adapters = Array.isArray(gpuStatus?.adapters) ? gpuStatus.adapters : [];
                  const preferDiscrete = gpuPref === 'high-performance';
                  const effectiveClass = gpuStatus?.effectiveAdapter?.class;
                  const mismatchLowPower =
                    preferDiscrete &&
                    badgeActiveGpu &&
                    effectiveClass === 'low-power';
                  return (
                    <div
                      className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-3"
                      data-testid="settings-ai-gpu-card"
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={gpuOn}
                          onChange={(e) =>
                            updateSettings({ aiEnableGpu: coerceAiEnableGpu(e.target.checked) })
                          }
                          className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-white">
                            {t('settings.aiEnableGpu')}
                          </span>
                          <span className="block text-[11px] text-slate-400 leading-relaxed mt-0.5">
                            {t('settings.aiEnableGpuDesc')}
                          </span>
                          <div
                            className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium ${
                              badgeActiveGpu
                                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
                                : 'border-amber-700/60 bg-amber-950/40 text-amber-200'
                            }`}
                            title={
                              gpuStatus?.workerOrtNote ||
                              gpuStatus?.vendor ||
                              undefined
                            }
                            data-testid="settings-ai-gpu-badge"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                badgeActiveGpu ? 'bg-emerald-400' : 'bg-amber-400'
                              }`}
                            />
                            {badgeActiveGpu
                              ? t('settings.aiGpuBadgeGpu', { name: badgeDetail })
                              : t('settings.aiGpuBadgeCpu', { detail: badgeDetail })}
                          </div>
                          {!badgeActiveGpu && hardwareGpu ? (
                            <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
                              {t('settings.aiGpuBadgeHardwareOnly', { name: hwName })}
                            </p>
                          ) : null}
                          <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
                            {t('settings.aiGpuSessionNote')}
                          </p>
                        </div>
                      </label>

                      {gpuOn ? (
                        <div className="space-y-2 pl-7">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={preferDiscrete}
                              onChange={(e) => {
                                const next: AiGpuPreference = e.target.checked
                                  ? 'high-performance'
                                  : 'low-power';
                                updateSettings({ aiGpuPreference: next });
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                              data-testid="settings-ai-gpu-prefer-discrete"
                            />
                            <span className="text-xs text-slate-200 leading-relaxed">
                              <span className="font-semibold block">
                                {t('settings.aiGpuPreferDiscrete')}
                              </span>
                              <span className="text-[11px] text-slate-400 block mt-0.5">
                                {t('settings.aiGpuPreferDiscreteDesc')}
                              </span>
                            </span>
                          </label>
                          <p className="text-[10px] text-amber-200/80 leading-relaxed">
                            {t('settings.aiGpuRestartHint')}
                          </p>
                          {mismatchLowPower ? (
                            <p
                              className="text-[10px] text-amber-300 leading-relaxed"
                              data-testid="settings-ai-gpu-mismatch"
                            >
                              {t('settings.aiGpuMismatchWarning')}
                            </p>
                          ) : null}
                          <div data-testid="settings-ai-gpu-adapters">
                            <span className="block text-[11px] font-semibold text-slate-300 mb-1">
                              {t('settings.aiGpuAdaptersTitle')}
                            </span>
                            {adapters.length === 0 ? (
                              <p className="text-[10px] text-slate-500">
                                {t('settings.aiGpuAdaptersEmpty')}
                              </p>
                            ) : adapters.length === 1 ? (
                              <p className="text-[11px] text-slate-300 font-mono truncate">
                                {adapters[0].label}
                                {adapters[0].selected
                                  ? ` — ${t('settings.aiGpuAdapterEffective')}`
                                  : ''}
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {adapters.map((a) => (
                                  <li
                                    key={a.id}
                                    className={`text-[11px] truncate ${
                                      a.selected
                                        ? 'text-emerald-200 font-semibold'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {a.label}
                                    {a.selected
                                      ? ` — ${t('settings.aiGpuAdapterEffective')}`
                                      : a.class !== 'unknown'
                                        ? ` (${a.class})`
                                        : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {(() => {
                  const isMdxMethod = isMdxInstrumentalMethod(
                    coerceInstrumentalVocalRemoverMethod(settings.instrumentalVocalRemoverMethod)
                  );
                  const showOrt =
                    isMdxMethod && (!isSearching || matchAiThreads || matchInstrumentalVocal);
                  const showCores = !isSearching || matchAiThreads;
                  if (!showOrt && !showCores) return null;

                  const aiCpuThreadsUi =
                    settings.aiCpuThreads == null
                      ? cpuCoreCount
                      : clampAiCpuThreadsForUi(settings.aiCpuThreads, cpuCoreCount);

                  return (
                    <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-3">
                      {showOrt && (
                        <>
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={coerceMdxEnableOrt(settings.mdxEnableOrt)}
                              onChange={(e) =>
                                updateSettings({
                                  mdxEnableOrt: coerceMdxEnableOrt(e.target.checked)
                                })
                              }
                              className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                            />
                            <div>
                              <span className="block text-[11px] font-medium text-slate-200">
                                {t('settings.mdxEnableOrt')}
                              </span>
                              <span className="block text-[10px] text-slate-400 leading-relaxed mt-0.5">
                                {t('settings.mdxEnableOrtDesc')}
                              </span>
                            </div>
                          </label>
                          {showCores && <div className="border-t border-slate-800/80" />}
                        </>
                      )}

                      {showCores && (
                        <>
                          <label className="block font-semibold text-white text-xs flex items-center gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                            {t('settings.aiCpuThreads', 'Core CPU per AI strumentale')}
                          </label>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {t(
                              'settings.aiCpuThreadsDesc',
                              'Numero di core CPU usati da MDX / Demucs durante il download strumentale'
                            )}
                          </p>
                          <p className="text-[11px] text-slate-300 font-medium">
                            {t('settings.aiCpuCoresAvailable', 'Core CPU disponibili: {{count}}', {
                              count: cpuCoreCount
                            })}
                          </p>
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min={1}
                              max={cpuCoreCount}
                              step={1}
                              value={aiCpuThreadsUi}
                              onChange={(e) => {
                                const clamped = clampAiCpuThreadsForUi(
                                  parseInt(e.target.value, 10),
                                  cpuCoreCount
                                );
                                updateSettings({ aiCpuThreads: clamped });
                              }}
                              className="flex-1 accent-indigo-600"
                            />
                            <input
                              type="number"
                              min={1}
                              max={cpuCoreCount}
                              value={aiCpuThreadsUi}
                              onChange={(e) => {
                                const clamped = clampAiCpuThreadsForUi(
                                  parseInt(e.target.value, 10),
                                  cpuCoreCount
                                );
                                updateSettings({ aiCpuThreads: clamped });
                              }}
                              className="w-16 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white text-center text-xs font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateSettings({ aiCpuThreads: coerceAiCpuThreads(null) })
                            }
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                          >
                            {t(
                              'settings.aiCpuThreadsResetMax',
                              'Reimposta su Massimo ({{count}})',
                              { count: cpuCoreCount }
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}

                {(!isSearching || matchYtdlp) && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Download className="w-4 h-4 text-cyan-400" /> {t('settings.ytdlpTitle')}
                      </h3>
                      <button
                        type="button"
                        onClick={handleCheckYtDlpUpdate}
                        disabled={isCheckingYtdlp}
                        className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 rounded-xl flex items-center gap-1.5 font-semibold border border-cyan-800/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isCheckingYtdlp ? 'animate-spin' : ''}`} />
                        <span>{isCheckingYtdlp ? t('settings.ytdlpChecking') : t('settings.ytdlpCheckUpdate')}</span>
                      </button>
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                        <span className="text-slate-400 font-medium">{t('settings.ytdlpStatus')}:</span>
                        {ytdlpStatus?.available ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-950/30 px-2 py-0.5 rounded-lg border border-emerald-800/40">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t('settings.ytdlpInstalled', { version: ytdlpStatus.version || 'OK' })}
                          </span>
                        ) : (
                          <span className="text-amber-400 font-semibold flex items-center gap-1 bg-amber-950/30 px-2 py-0.5 rounded-lg border border-amber-800/40">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {t('settings.ytdlpNotInstalled')}
                          </span>
                        )}
                      </div>

                      {ytdlpStatus?.path && (
                        <div className="space-y-1">
                          <span className="text-slate-400 text-[11px] block">{t('settings.ytdlpPath')}:</span>
                          <div className="font-mono text-[11px] text-slate-400 bg-slate-900/90 rounded-lg p-2 overflow-x-auto select-all border border-slate-800 break-all">
                            {ytdlpStatus.path}
                          </div>
                        </div>
                      )}

                      {ytdlpMessage && (
                        <div className={`text-[11px] p-2 rounded-lg border leading-relaxed ${
                          ytdlpStatus?.error
                            ? 'bg-rose-950/30 border-rose-800/40 text-rose-300'
                            : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                        }`}>
                          {ytdlpMessage}
                        </div>
                      )}

                      <div className="pt-2 mt-1 border-t border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-slate-400 font-medium text-xs">
                            {t('settings.youtubeCookiesTitle')}
                          </span>
                          {youtubeCookieStatus?.valid ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-950/30 px-2 py-0.5 rounded-lg border border-emerald-800/40 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t('settings.youtubeCookiesReady')}
                            </span>
                          ) : (
                            <span className="text-amber-400 font-semibold flex items-center gap-1 bg-amber-950/30 px-2 py-0.5 rounded-lg border border-amber-800/40 text-[11px]">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t('settings.youtubeCookiesMissing')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {t('settings.youtubeCookiesDesc')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleYouTubeLogin()}
                            disabled={isYoutubeLoginBusy}
                            className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 text-rose-200 rounded-xl flex items-center gap-1.5 font-semibold border border-rose-800/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                          >
                            {isYoutubeLoginBusy
                              ? t('settings.youtubeCookiesLoggingIn')
                              : t('settings.youtubeCookiesLogin')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleClearYouTubeCookies()}
                            disabled={isYoutubeLoginBusy || !youtubeCookieStatus?.present}
                            className="px-3 py-1.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 rounded-xl font-semibold border border-slate-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                          >
                            {t('settings.youtubeCookiesClear')}
                          </button>
                        </div>
                        {youtubeCookieMessage && (
                          <div className="text-[11px] p-2 rounded-lg border leading-relaxed bg-slate-900/80 border-slate-700/50 text-slate-300">
                            {youtubeCookieMessage}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
  );
};
