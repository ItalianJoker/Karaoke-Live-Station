import React from 'react';
import { Monitor } from 'lucide-react';
import type { StageMessageStyle } from '../../../shared/types';
import {
  STAGE_MESSAGE_KEYS,
  createDefaultStageMessages,
  mergeStageMessages,
  patchStageMessages,
} from '../../../shared/stageMessages';
import type { StageMessageKey } from '../../../shared/stageMessages';
import type { SettingsStageTabProps } from './settingsTypes';

/**
 * Stage screen settings tab: launch, banner timings, overlays, and per-message styles.
 *
 * **Audience (humans):** What the Palco shows for banners, next singer, pitch/speed, messages.
 *
 * **Audience (AI):** Stage message patches must go through `patchStageMessages` /
 * `mergeStageMessages`. Image backdrop uses `dialog.openImageFile` — keep that IPC.
 */
export const SettingsStageTab: React.FC<SettingsStageTabProps> = ({
  t,
  settings,
  updateSettings,
  isSearching,
  matchAutoStage,
  matchBannerIntro,
  matchBannerOutro,
  matchTitleOverlay,
  matchNextSinger,
  matchPitchStage,
  matchSpeedStage,
  matchStageMessages,
}) => {
  return (
              <div className="space-y-4">
                <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-amber-400" />
                  {t('settings.tabStage', 'Schermo Stage')}
                </h3>

                {(!isSearching || matchAutoStage) && (
                  <label className="flex items-start gap-3 cursor-pointer bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
                    <input
                      type="checkbox"
                      checked={settings.autoOpenStageOnLaunch ?? true}
                      onChange={(e) => updateSettings({ autoOpenStageOnLaunch: e.target.checked })}
                      className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                    />
                    <div>
                      <span className="font-semibold text-white text-xs block">
                        {t('settings.autoOpenStage', 'Apri Stage all\'avvio')}
                      </span>
                      <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                        {t(
                          'settings.autoOpenStageDesc',
                          'Apre automaticamente lo schermo Stage all\'avvio dell\'app'
                        )}
                      </span>
                    </div>
                  </label>
                )}

                {(
                  !isSearching ||
                  matchBannerIntro ||
                  matchBannerOutro ||
                  matchTitleOverlay
                ) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(!isSearching || matchBannerIntro) && (
                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.bannerIntro')}</label>
                        <input
                          type="number"
                          min="2"
                          max="15"
                          value={settings.bannerIntroDurationSec}
                          onChange={(e) => updateSettings({ bannerIntroDurationSec: parseInt(e.target.value, 10) || 6 })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        />
                      </div>
                    )}

                    {(!isSearching || matchBannerOutro) && (
                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.bannerOutro')}</label>
                        <input
                          type="number"
                          min="10"
                          max="45"
                          value={settings.bannerOutroTriggerSec}
                          onChange={(e) => updateSettings({ bannerOutroTriggerSec: parseInt(e.target.value, 10) || 20 })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        />
                      </div>
                    )}

                    {(!isSearching || matchTitleOverlay) && (
                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.titleOverlayDuration')}</label>
                        <input
                          type="number"
                          min="2"
                          max="30"
                          value={settings.titleOverlayDurationSec ?? 8}
                          onChange={(e) => updateSettings({ titleOverlayDurationSec: parseInt(e.target.value, 10) || 8 })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        />
                      </div>
                    )}
                  </div>
                )}

                {(
                  !isSearching ||
                  matchNextSinger ||
                  matchPitchStage ||
                  matchSpeedStage
                ) && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-3">
                    {(!isSearching || matchNextSinger) && (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showNextSingerAtIntro ?? true}
                          onChange={(e) => updateSettings({ showNextSingerAtIntro: e.target.checked })}
                          className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium text-slate-200 block">{t('settings.showNextSingerAtIntro')}</span>
                          <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showNextSingerAtIntroDesc')}</span>
                        </div>
                      </label>
                    )}

                    {(!isSearching || matchPitchStage) && (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showPitchOnStage ?? true}
                          onChange={(e) => updateSettings({ showPitchOnStage: e.target.checked })}
                          className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium text-slate-200 block">{t('settings.showPitchOnStage')}</span>
                          <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showPitchOnStageDesc')}</span>
                        </div>
                      </label>
                    )}

                    {(!isSearching || matchSpeedStage) && (
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showSpeedOnStage ?? true}
                          onChange={(e) => updateSettings({ showSpeedOnStage: e.target.checked })}
                          className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium text-slate-200 block">{t('settings.showSpeedOnStage')}</span>
                          <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showSpeedOnStageDesc')}</span>
                        </div>
                      </label>
                    )}
                  </div>
                )}

                {(!isSearching || matchStageMessages) && (
                  <div
                    className="pt-2 border-t border-slate-800/80 space-y-3"
                    data-testid="settings-stage-messages"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200">
                        {t('settings.stageMessagesTitle')}
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        {t('settings.stageMessagesDesc')}
                      </p>
                    </div>

                    {(() => {
                      const stageMessages = mergeStageMessages(settings.stageMessages);
                      const updateStageMessage = (
                        key: StageMessageKey,
                        patch: Partial<StageMessageStyle>
                      ) => {
                        updateSettings({
                          stageMessages: patchStageMessages(settings.stageMessages, {
                            [key]: { ...stageMessages[key], ...patch }
                          })
                        });
                      };
                      const labelKey: Record<StageMessageKey, string> = {
                        nowSinging: 'settings.stageMessageNowSinging',
                        getReady: 'settings.stageMessageGetReady',
                        upNextIntro: 'settings.stageMessageUpNextIntro',
                        nextSong: 'settings.stageMessageNextSong',
                        nextSingerUnassigned: 'settings.stageMessageNextSingerUnassigned',
                        upNextOnStage: 'settings.stageMessageUpNextOnStage',
                        followingSinger: 'settings.stageMessageFollowingSinger'
                      };
                      const bannerKey: Record<StageMessageKey, string> = {
                        nowSinging: 'banner.nowSinging',
                        getReady: 'banner.getReady',
                        upNextIntro: 'banner.upNextIntro',
                        nextSong: 'banner.nextSong',
                        nextSingerUnassigned: 'banner.nextSingerUnassigned',
                        upNextOnStage: 'banner.upNextOnStage',
                        followingSinger: 'banner.followingSinger'
                      };

                      return STAGE_MESSAGE_KEYS.map((key) => {
                        const style = stageMessages[key];
                        const i18nDefault = t(bannerKey[key], { name: '{{name}}' });
                        return (
                          <div
                            key={key}
                            className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2.5"
                            data-testid={`settings-stage-message-${key}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <span className="text-sm font-medium text-slate-200 block">
                                  {t(labelKey[key])}
                                </span>
                                <span className="text-[11px] text-slate-400 block mt-0.5 truncate">
                                  {t('settings.stageMessageDefaultHint')}: {i18nDefault}
                                </span>
                              </div>
                              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={style.enabled}
                                  onChange={(e) =>
                                    updateStageMessage(key, { enabled: e.target.checked })
                                  }
                                  className="w-4 h-4 accent-indigo-600 rounded"
                                />
                                <span className="text-xs text-slate-300">
                                  {t('settings.stageMessageEnabled')}
                                </span>
                              </label>
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                {t('settings.stageMessageText')}
                              </label>
                              <input
                                type="text"
                                value={style.text}
                                onChange={(e) =>
                                  updateStageMessage(key, { text: e.target.value })
                                }
                                placeholder={t('settings.stageMessageTextPlaceholder')}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                                disabled={!style.enabled}
                              />
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={style.bold}
                                  onChange={(e) =>
                                    updateStageMessage(key, { bold: e.target.checked })
                                  }
                                  className="w-3.5 h-3.5 accent-indigo-600 rounded"
                                  disabled={!style.enabled}
                                />
                                <span className="text-xs font-bold text-slate-300">
                                  {t('settings.stageMessageBold')}
                                </span>
                              </label>
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={style.italic}
                                  onChange={(e) =>
                                    updateStageMessage(key, { italic: e.target.checked })
                                  }
                                  className="w-3.5 h-3.5 accent-indigo-600 rounded"
                                  disabled={!style.enabled}
                                />
                                <span className="text-xs italic text-slate-300">
                                  {t('settings.stageMessageItalic')}
                                </span>
                              </label>
                              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                                <span>{t('settings.stageMessageFontSize')}</span>
                                <input
                                  type="number"
                                  min={10}
                                  max={96}
                                  value={style.fontSizePx}
                                  onChange={(e) =>
                                    updateStageMessage(key, {
                                      fontSizePx: parseInt(e.target.value, 10) || style.fontSizePx
                                    })
                                  }
                                  className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                                  disabled={!style.enabled}
                                />
                                <span className="text-slate-400">px</span>
                              </label>
                              <button
                                type="button"
                                className="ml-auto text-[11px] text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline disabled:opacity-40"
                                disabled={!style.enabled}
                                onClick={() =>
                                  updateStageMessage(key, createDefaultStageMessages()[key])
                                }
                              >
                                {t('settings.stageMessageReset')}
                              </button>
                            </div>

                            {/* Per-message Stage backdrop: applies only while this message is visible. */}
                            <div className="pt-2 border-t border-slate-800/60 space-y-2">
                              <label className="block text-[11px] text-slate-400">
                                {t('settings.stageMessageBackground')}
                              </label>
                              <p className="text-[10px] text-slate-400 leading-relaxed">
                                {t('settings.stageMessageBackgroundHint')}
                              </p>
                              <select
                                value={style.backgroundMode || 'none'}
                                onChange={(e) =>
                                  updateStageMessage(key, {
                                    backgroundMode: e.target.value as 'none' | 'color' | 'image'
                                  })
                                }
                                disabled={!style.enabled}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                                data-testid={`settings-stage-message-bg-mode-${key}`}
                              >
                                <option value="none">{t('settings.stageMessageBackgroundNone')}</option>
                                <option value="color">{t('settings.stageMessageBackgroundColor')}</option>
                                <option value="image">{t('settings.stageMessageBackgroundImage')}</option>
                              </select>

                              {(style.backgroundMode || 'none') === 'color' && (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={style.backgroundColor || '#0f172a'}
                                    onChange={(e) =>
                                      updateStageMessage(key, { backgroundColor: e.target.value })
                                    }
                                    disabled={!style.enabled}
                                    className="w-10 h-8 rounded border border-slate-700 bg-slate-900 cursor-pointer"
                                    aria-label={t('settings.stageMessageBackgroundColor')}
                                  />
                                  <input
                                    type="text"
                                    value={style.backgroundColor || '#0f172a'}
                                    onChange={(e) =>
                                      updateStageMessage(key, { backgroundColor: e.target.value })
                                    }
                                    disabled={!style.enabled}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                                  />
                                </div>
                              )}

                              {(style.backgroundMode || 'none') === 'image' && (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={style.backgroundImagePath || ''}
                                    placeholder={t('settings.stageMessageBackgroundImagePlaceholder')}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 truncate"
                                  />
                                  <button
                                    type="button"
                                    disabled={!style.enabled}
                                    className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40"
                                    onClick={async () => {
                                      const path = await window.karaokeApi?.dialog?.openImageFile?.();
                                      if (path) {
                                        updateStageMessage(key, {
                                          backgroundMode: 'image',
                                          backgroundImagePath: path
                                        });
                                      }
                                    }}
                                  >
                                    {t('settings.stageMessageBackgroundBrowse')}
                                  </button>
                                  {style.backgroundImagePath ? (
                                    <button
                                      type="button"
                                      disabled={!style.enabled}
                                      className="shrink-0 px-2 py-1.5 text-xs rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-40"
                                      onClick={() =>
                                        updateStageMessage(key, { backgroundImagePath: '' })
                                      }
                                    >
                                      {t('settings.stageMessageBackgroundClear')}
                                    </button>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
  );
};
