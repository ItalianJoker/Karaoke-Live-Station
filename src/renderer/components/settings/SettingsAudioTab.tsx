import React from 'react';
import {
  Volume2,
  FolderOpen,
  Headphones,
  AudioLines,
  Info,
} from 'lucide-react';
import {
  SOUND_FONT_OTHER_OPTION_ID,
  soundFontPathsEqual,
} from '../../../shared/soundFontPath';
import { coerceAlgorithmicVocalRemoverMethod } from '../../../shared/vocalRemover';
import { coerceDspPitchEngine, type DspPitchEngine } from '../../../shared/dspPitch';
import type { SettingsAudioTabProps } from './settingsTypes';

/**
 * Audio & Playback settings tab: SoundFont, devices, A/V sync, DSP, live vocal, normalize, auto-advance.
 *
 * **Audience (humans):** Cue/master routing, pitch engine, and live playback behaviour.
 *
 * **Audience (AI):** SoundFont path selection stays dialog/IPC-backed via parent handlers.
 * Keep DSP / live vocal logger messages sourcing `SettingsModal`. Do not wire AI methods
 * into live `vocalRemoverAlgorithm`.
 */
export const SettingsAudioTab: React.FC<SettingsAudioTabProps> = ({
  t,
  settings,
  updateSettings,
  isSearching,
  matchSoundfont,
  matchDevices,
  matchAvSync,
  matchDspEngine,
  matchVocalRemoverAlgo,
  matchNormalization,
  matchAutoAdvance,
  audioDevices,
  defaultSystemSf,
  soundFontCatalog,
  soundFontSelectValue,
  handleResetDefaultSoundFont,
  handleSoundFontSelectChange,
  handleSelectSoundFont,
}) => {
  return (
              <div className="space-y-4">
                <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  {t('settings.tabAudio', 'Audio & Riproduzione')}
                </h3>

                {(!isSearching || matchSoundfont) && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <label className="text-slate-400 font-medium">{t('settings.soundfont')}</label>
                        {settings.midiSoundFontPath &&
                          defaultSystemSf &&
                          soundFontPathsEqual(settings.midiSoundFontPath, defaultSystemSf) && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-[10px] font-semibold">
                            {t('settings.soundfontDefaultBadge')}
                          </span>
                        )}
                      </div>
                      {defaultSystemSf &&
                        settings.midiSoundFontPath &&
                        !soundFontPathsEqual(settings.midiSoundFontPath, defaultSystemSf) && (
                        <button
                          type="button"
                          onClick={handleResetDefaultSoundFont}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                        >
                          {t('settings.soundfontUseDefault')}
                        </button>
                      )}
                    </div>
                    <select
                      value={soundFontSelectValue}
                      onChange={(e) => {
                        void handleSoundFontSelectChange(e.target.value);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm"
                      aria-label={t('settings.soundfont')}
                    >
                      {soundFontCatalog.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.displayName}
                          {entry.kind === 'bundled'
                            ? ` (${t('settings.soundfontKindBundled')})`
                            : ` (${t('settings.soundfontKindSystem')})`}
                        </option>
                      ))}
                      <option value={SOUND_FONT_OTHER_OPTION_ID}>
                        {t('settings.soundfontOther')}
                      </option>
                    </select>
                    {soundFontSelectValue === SOUND_FONT_OTHER_OPTION_ID && (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={settings.midiSoundFontPath || ''}
                          placeholder={t('midi.noSoundfontSelected')}
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleSelectSoundFont();
                          }}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 font-semibold transition-colors"
                        >
                          <FolderOpen className="w-4 h-4 text-amber-400" />
                          {t('settings.browse')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(!isSearching || matchDevices) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1 flex items-center gap-1">
                        <Headphones className="w-3.5 h-3.5 text-amber-400" />
                        {t('settings.cueDevice')}
                      </label>
                      <select
                        value={settings.cueAudioDeviceId}
                        onChange={(e) => updateSettings({ cueAudioDeviceId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                      >
                        <option value="default">Default Device</option>
                        {audioDevices.map((dev) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Device ${dev.deviceId.slice(0, 8)}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1">{t('settings.masterDevice')}</label>
                      <select
                        value={settings.masterAudioDeviceId}
                        onChange={(e) => updateSettings({ masterAudioDeviceId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                      >
                        <option value="default">Default Device</option>
                        {audioDevices.map((dev) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Device ${dev.deviceId.slice(0, 8)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {(!isSearching || matchAvSync) && (
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>{t('settings.audioVideoSync')}</span>
                      <span className="font-mono text-indigo-400">{settings.audioVideoSyncOffsetMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min="-500"
                      max="500"
                      step="10"
                      value={settings.audioVideoSyncOffsetMs}
                      onChange={(e) => updateSettings({ audioVideoSyncOffsetMs: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                )}


                {(!isSearching || matchDspEngine) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                    <label className="block font-semibold text-white text-xs flex items-center gap-1.5">
                      <AudioLines className="w-3.5 h-3.5 text-cyan-400" />
                      {t('settings.dspEngine')}
                      <span
                        className="inline-flex text-slate-400"
                        title={t('settings.dspEngineCompareBody')}
                      >
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('settings.dspEngineDesc')}
                    </p>
                    <select
                      value={coerceDspPitchEngine(settings.dspEngine)}
                      onChange={(e) => {
                        const next = coerceDspPitchEngine(e.target.value as DspPitchEngine);
                        updateSettings({ dspEngine: next });
                        if (window.karaokeApi?.logger?.log) {
                          window.karaokeApi.logger.log(
                            'info',
                            'SettingsModal',
                            `DSP pitch engine → ${next}`
                          );
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                    >
                      <option value="soundtouch">{t('settings.dspEngineSoundTouch')}</option>
                      <option value="bungee">{t('settings.dspEngineBungee')}</option>
                    </select>
                    <div className="text-[11px] text-slate-400 leading-relaxed space-y-1 border-t border-slate-800/80 pt-2">
                      <p>
                        <span className="text-indigo-300 font-semibold">Bungee</span>
                        {' — '}
                        {t('settings.dspEngineBungeeBlurb')}
                      </p>
                      <p>
                        <span className="text-amber-300 font-semibold">SoundTouch</span>
                        {' — '}
                        {t('settings.dspEngineSoundTouchBlurb')}
                      </p>
                      <p className="text-slate-500">{t('settings.dspEngineMidiNote')}</p>
                    </div>
                  </div>
                )}

                {(!isSearching || matchVocalRemoverAlgo) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                    <label className="block font-semibold text-white text-xs">
                      {t('settings.vocalRemoverAlgorithm')}
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t('settings.vocalRemoverAlgorithmDesc')}
                    </p>
                    <select
                      value={coerceAlgorithmicVocalRemoverMethod(settings.vocalRemoverAlgorithm)}
                      onChange={(e) => {
                        const next = coerceAlgorithmicVocalRemoverMethod(e.target.value);
                        const prev = coerceAlgorithmicVocalRemoverMethod(
                          settings.vocalRemoverAlgorithm
                        );
                        updateSettings({ vocalRemoverAlgorithm: next });
                        if (prev !== next && window.karaokeApi?.logger?.log) {
                          window.karaokeApi.logger.log(
                            'info',
                            'SettingsModal',
                            `Live vocal remover method → ${next}`
                          );
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                    >
                      <option value="centerCancelBassKeep">{t('settings.vocalAlgoCenterBass')}</option>
                      <option value="centerCancel">{t('settings.vocalAlgoCenter')}</option>
                      <option value="softMid">{t('settings.vocalAlgoSoftMid')}</option>
                    </select>
                  </div>
                )}

                {(!isSearching || matchNormalization) && (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.enableAudioNormalization ?? true}
                        onChange={(e) => updateSettings({ enableAudioNormalization: e.target.checked })}
                        className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                      />
                      <div>
                        <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                          {t('settings.audioNormalization')}
                        </span>
                        <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                          {t('settings.audioNormalizationDesc')}
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {(!isSearching || matchAutoAdvance) && (
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.autoAdvanceNext}
                        onChange={(e) => updateSettings({ autoAdvanceNext: e.target.checked })}
                        className="w-4 h-4 accent-indigo-600 rounded"
                      />
                      <span className="font-semibold text-white">{t('settings.autoAdvance')}</span>
                    </label>
                    <div className={settings.autoAdvanceNext ? 'opacity-100' : 'opacity-50 pointer-events-none'}>
                      <label className="block text-slate-400 mb-1 text-xs">
                        {t('settings.transitionPause')}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="15"
                          step="1"
                          value={settings.transitionPauseSec}
                          onChange={(e) =>
                            updateSettings({ transitionPauseSec: parseInt(e.target.value, 10) || 0 })
                          }
                          className="flex-1 accent-indigo-600"
                        />
                        <input
                          type="number"
                          min="0"
                          max="15"
                          value={settings.transitionPauseSec}
                          onChange={(e) =>
                            updateSettings({ transitionPauseSec: parseInt(e.target.value, 10) || 0 })
                          }
                          className="w-16 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white text-center"
                        />
                        <span className="text-xs text-slate-400">sec</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
  );
};
