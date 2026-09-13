import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, Copy, Check, Info, RefreshCw, AlertTriangle } from 'lucide-react';
import { OperatingSystem, FirewallCheckResult, FirewallRuleInfo } from '../../shared/types';

interface FirewallGuideCardProps {
  compact?: boolean;
}

export const FirewallGuideCard: React.FC<FirewallGuideCardProps> = ({ compact = false }) => {
  const { t } = useTranslation();
  const [diag, setDiag] = useState<FirewallCheckResult | null>(null);
  const [selectedOs, setSelectedOs] = useState<OperatingSystem>('linux');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchFirewallInfo = async () => {
    if (!window.karaokeApi?.system?.checkFirewall) return;
    setIsRefreshing(true);
    try {
      const result = await window.karaokeApi.system.checkFirewall();
      setDiag(result);
      if (result.currentPlatform) {
        setSelectedOs(result.currentPlatform);
      }
    } catch (err) {
      console.warn('Could not check firewall:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFirewallInfo();
  }, []);

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const activeRule: FirewallRuleInfo | undefined = diag?.rules?.[selectedOs];
  const isCurrentPlatform = diag?.currentPlatform === selectedOs;

  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 space-y-3 shadow-inner">
      {/* Header & OS Selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {activeRule?.status === 'allowed' ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span className="font-bold text-xs text-white uppercase tracking-wider">
            {t('firewall.title', 'Assistente Firewall & Connessione LAN')}
          </span>
        </div>

        <button
          type="button"
          onClick={fetchFirewallInfo}
          disabled={isRefreshing}
          title={t('firewall.refresh', 'Aggiorna diagnosi')}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* OS Selector Tabs */}
      <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => setSelectedOs('win32')}
          className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            selectedOs === 'win32'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <span>🪟 Windows</span>
          {diag?.currentPlatform === 'win32' && (
            <span className="text-[9px] bg-white/20 px-1 rounded uppercase font-bold">OS</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSelectedOs('darwin')}
          className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            selectedOs === 'darwin'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <span>🍎 macOS</span>
          {diag?.currentPlatform === 'darwin' && (
            <span className="text-[9px] bg-white/20 px-1 rounded uppercase font-bold">OS</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSelectedOs('linux')}
          className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            selectedOs === 'linux'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <span>🐧 Linux</span>
          {diag?.currentPlatform === 'linux' && (
            <span className="text-[9px] bg-white/20 px-1 rounded uppercase font-bold">OS</span>
          )}
        </button>
      </div>

      {/* Diagnostic Status Banner */}
      {isCurrentPlatform && activeRule && (
        <div
          className={`p-2 rounded-xl text-[11px] border flex items-center gap-2 ${
            activeRule.status === 'allowed'
              ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
              : activeRule.status === 'blocked'
              ? 'bg-amber-950/30 border-amber-800/40 text-amber-300'
              : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span className="leading-snug">{activeRule.summary}</span>
        </div>
      )}

      {/* Instructions & Commands per OS */}
      <div className="space-y-2.5 text-[11px] text-slate-300 leading-relaxed">
        {selectedOs === 'win32' && (
          <div className="space-y-2">
            <p className="text-slate-300">
              {t(
                'firewall.winNotice',
                'Al primo avvio, se compare la richiesta di Windows Defender Firewall, seleziona "Reti Private" e premi "Consenti accesso". Se gli smartphone non caricano la pagina, autorizza la porta TCP con questo comando:'
              )}
            </p>
            {activeRule?.command && (
              <div className="relative group">
                <code className="block bg-black/80 border border-slate-800 rounded-lg p-2 font-mono text-[10.5px] text-blue-300 pr-16 select-all break-all">
                  {activeRule.command}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(activeRule.command!, 'win')}
                  className="absolute right-1.5 top-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition-colors"
                >
                  {copiedKey === 'win' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copiato!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" />
                      <span>Copia</span>
                    </>
                  )}
                </button>
              </div>
            )}
            {!compact && (
              <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60 space-y-1">
                <span className="font-semibold text-slate-300 block">Metodo Grafico (GUI):</span>
                <span>
                  Pannello di controllo ➔ Windows Defender Firewall ➔ Consenti app tramite firewall ➔ spunta "Karaoke Live Station" su Reti Private.
                </span>
              </div>
            )}
          </div>
        )}

        {selectedOs === 'darwin' && (
          <div className="space-y-2">
            <p className="text-slate-300">
              {t(
                'firewall.macNotice',
                'Alla prima apertura, macOS mostra un avviso di sicurezza: clicca su "Consenti" per accettare le connessioni in ingresso. Se bloccato, sblocca l\'app nel firewall di macOS:'
              )}
            </p>
            {activeRule?.command && (
              <div className="relative group">
                <code className="block bg-black/80 border border-slate-800 rounded-lg p-2 font-mono text-[10.5px] text-indigo-300 pr-16 select-all break-all">
                  {activeRule.command}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(activeRule.command!, 'mac')}
                  className="absolute right-1.5 top-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition-colors"
                >
                  {copiedKey === 'mac' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copiato!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" />
                      <span>Copia</span>
                    </>
                  )}
                </button>
              </div>
            )}
            {!compact && (
              <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60 space-y-1">
                <span className="font-semibold text-slate-300 block">Metodo Grafico (GUI):</span>
                <span>
                  Impostazioni di Sistema ➔ Rete ➔ Firewall ➔ Opzioni ➔ verifica che "Karaoke Live Station" sia impostata su "Consenti connessioni in entrata".
                </span>
              </div>
            )}
          </div>
        )}

        {selectedOs === 'linux' && (
          <div className="space-y-2">
            <p className="text-slate-300">
              {t(
                'firewall.linuxNotice',
                'Se usi UFW o Firewalld su Linux, autorizza le porte TCP del Guest Portal (3000-3010) per consentire agli smartphone di connettersi:'
              )}
            </p>
            {activeRule?.command && (
              <div className="relative group">
                <code className="block bg-black/80 border border-slate-800 rounded-lg p-2 font-mono text-[10.5px] text-emerald-300 pr-16 select-all break-all">
                  {activeRule.command}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(activeRule.command!, 'linux')}
                  className="absolute right-1.5 top-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition-colors"
                >
                  {copiedKey === 'linux' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copiato!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" />
                      <span>Copia</span>
                    </>
                  )}
                </button>
              </div>
            )}
            {!compact && (
              <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60 space-y-1">
                <span className="font-semibold text-slate-300 block">Per Firewalld (Fedora / RHEL):</span>
                <code className="block font-mono text-[10px] text-slate-300 select-all">
                  sudo firewall-cmd --add-port=3000-3010/tcp --permanent && sudo firewall-cmd --reload
                </code>
              </div>
            )}
          </div>
        )}

        {/* Global Router AP Isolation Tip */}
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/80 pt-1 border-t border-slate-800/60">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
          <span>
            {t(
              'firewall.apIsolationTip',
              'Nota Wi-Fi: Se gli smartphone non caricano la pagina pur essendo connessi allo stesso modem, verifica nelle impostazioni del router che l\'opzione "Isolamento AP" (AP Client Isolation) sia DISATTIVATA.'
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
