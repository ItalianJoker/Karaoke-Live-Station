import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, Copy, Check, Info, RefreshCw, AlertTriangle, Terminal, Sliders } from 'lucide-react';
import { OperatingSystem, FirewallCheckResult, FirewallRuleInfo } from '../../shared/types';

interface FirewallGuideCardProps {
  compact?: boolean;
}

interface CommandBlockProps {
  label: string;
  command: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (cmd: string, key: string) => void;
  colorClass?: string;
}

const CommandBlock: React.FC<CommandBlockProps> = ({
  label,
  command,
  copyKey,
  copiedKey,
  onCopy,
  colorClass = 'text-cyan-300'
}) => {
  const isCopied = copiedKey === copyKey;
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5 bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold text-slate-300 flex items-center gap-1.5 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <button
          type="button"
          onClick={() => onCopy(command, copyKey)}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-semibold flex items-center gap-1 border border-slate-700 hover:border-slate-600 transition-all shrink-0 cursor-pointer shadow-sm active:scale-95"
          title={t('firewall.copy', 'Copia')}
        >
          {isCopied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-bold">{t('firewall.copied', 'Copiato!')}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-slate-400" />
              <span>{t('firewall.copy', 'Copia')}</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-black/95 border border-slate-800/90 rounded-lg p-2.5 overflow-x-auto select-all shadow-inner custom-scrollbar">
        <code className={`block font-mono text-[11px] ${colorClass} whitespace-pre leading-relaxed tracking-tight`}>
          {command}
        </code>
      </div>
    </div>
  );
};

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
  const activePort = diag?.activePort || 3000;
  const minPort = activePort;
  const maxPort = activePort + 10;

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
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
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
          <div className="space-y-2.5">
            <p className="text-slate-300 leading-relaxed">
              {t(
                'firewall.winNotice',
                'Al primo avvio, se compare la richiesta di Windows Defender Firewall, seleziona "Reti Private" e premi "Consenti accesso". Se gli smartphone non caricano la pagina, autorizza la porta TCP con questo comando:'
              )}
            </p>
            {activeRule?.command && (
              <CommandBlock
                label={t('firewall.commandPrompt', 'PowerShell / CMD (Amministratore):')}
                command={activeRule.command}
                copyKey="win"
                copiedKey={copiedKey}
                onCopy={handleCopy}
                colorClass="text-blue-300"
              />
            )}
            {!compact && (
              <div className="text-[10.5px] text-slate-300 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-[10.5px]">
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t('firewall.guiMethod', 'Metodo Grafico (GUI):')}</span>
                </div>
                <p className="text-slate-400 leading-snug">
                  {t(
                    'firewall.winGui',
                    'Pannello di controllo ➔ Windows Defender Firewall ➔ Consenti app tramite firewall ➔ spunta "Karaoke Live Station" su Reti Private.'
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {selectedOs === 'darwin' && (
          <div className="space-y-2.5">
            <p className="text-slate-300 leading-relaxed">
              {t(
                'firewall.macNotice',
                'Alla prima apertura, macOS mostra un avviso di sicurezza: clicca su "Consenti" per accettare le connessioni in ingresso. Se bloccato, sblocca l\'app nel firewall di macOS:'
              )}
            </p>
            {activeRule?.command && (
              <CommandBlock
                label={t('firewall.commandMac', 'Terminale macOS (sudo):')}
                command={activeRule.command}
                copyKey="mac"
                copiedKey={copiedKey}
                onCopy={handleCopy}
                colorClass="text-indigo-300"
              />
            )}
            {!compact && (
              <div className="text-[10.5px] text-slate-300 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 space-y-1">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-[10.5px]">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{t('firewall.guiMethod', 'Metodo Grafico (GUI):')}</span>
                </div>
                <p className="text-slate-400 leading-snug">
                  {t(
                    'firewall.macGui',
                    'Impostazioni di Sistema ➔ Rete ➔ Firewall ➔ Opzioni ➔ verifica che "Karaoke Live Station" sia impostata su "Consenti connessioni in entrata".'
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {selectedOs === 'linux' && (
          <div className="space-y-2.5">
            <p className="text-slate-300 leading-relaxed">
              {t(
                'firewall.linuxNotice',
                'Se usi UFW o Firewalld su Linux, autorizza le porte TCP del Guest Portal per consentire agli smartphone di connettersi:'
              )}
            </p>
            {activeRule?.command && (
              <CommandBlock
                label={t('firewall.commandUfw', 'Comando UFW (Ubuntu / Debian / Mint):')}
                command={activeRule.command}
                copyKey="linux-ufw"
                copiedKey={copiedKey}
                onCopy={handleCopy}
                colorClass="text-emerald-300"
              />
            )}
            {!compact && (
              <CommandBlock
                label={t('firewall.commandFirewalld', 'Comando Firewalld (Fedora / RHEL / CentOS):')}
                command={`sudo firewall-cmd --add-port=${minPort}-${maxPort}/tcp --permanent && sudo firewall-cmd --reload`}
                copyKey="linux-firewalld"
                copiedKey={copiedKey}
                onCopy={handleCopy}
                colorClass="text-emerald-300"
              />
            )}
          </div>
        )}

        {/* Global Router AP Isolation Tip */}
        <div className="flex items-start gap-2 text-[10.5px] text-amber-300/90 pt-2 border-t border-slate-800/60 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
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
