import fs from 'fs';
import { execFileSync } from 'child_process';
import { OperatingSystem, FirewallCheckResult, FirewallRuleInfo } from '../../shared/types';

/**
 * FirewallHelper
 *
 * Provides cross-platform firewall inspection, diagnosis, and resolution guides
 * for Windows Defender Firewall, macOS Application Firewall (ALF), and Linux (UFW / Firewalld).
 */
export class FirewallHelper {
  /**
   * Diagnoses firewall settings for the current host OS and returns actionable commands
   * and instructions tailored to Windows, macOS, and Linux.
   */
  public static checkFirewall(activePort: number, lanIp: string): FirewallCheckResult {
    const currentPlatform: OperatingSystem =
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';

    const minPort = activePort;
    const maxPort = activePort + 10;

    // 1. Windows Diagnosis & Rules
    const windowsRule: FirewallRuleInfo = {
      platform: 'win32',
      port: activePort,
      status: 'unknown',
      serviceName: 'Windows Defender Firewall',
      summary: 'Regola di ingresso per porte TCP ' + minPort + '-' + maxPort,
      command: `netsh advfirewall firewall add rule name="Karaoke Live Station" dir=in action=allow protocol=TCP localport=${minPort}-${maxPort}`,
      commandExplanation: 'Esegui questo comando in PowerShell o nel Prompt dei comandi (avviato come Amministratore).',
      guiSteps: [
        'Al primo avvio, se compare il popup di sicurezza di Windows, seleziona "Reti Private (Domestiche)" e clicca su "Consenti accesso".',
        'Se gli smartphone non caricano la pagina: apri "Sicurezza di Windows" ➔ "Firewall e protezione rete".',
        'Clicca su "Consenti a un\'app di passare attraverso il firewall" e verifica che "Karaoke Live Station" sia spuntata su "Privata".'
      ]
    };

    if (currentPlatform === 'win32') {
      try {
        const output = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=Karaoke Live Station'], {
          encoding: 'utf8',
          timeout: 2500,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        if (output && (output.toLowerCase().includes('allow') || output.toLowerCase().includes('consenti') || output.toLowerCase().includes('karaoke live station'))) {
          windowsRule.status = 'allowed';
          windowsRule.summary = 'Regola Windows Firewall attiva per Karaoke Live Station.';
        } else {
          windowsRule.status = 'blocked';
          windowsRule.summary = 'Nessuna regola personalizzata trovata in Windows Defender Firewall.';
        }
      } catch {
        windowsRule.status = 'blocked';
        windowsRule.summary = 'Nessuna regola configurata trovata per Karaoke Live Station.';
      }
    }

    // 2. macOS Diagnosis & Rules
    const macRule: FirewallRuleInfo = {
      platform: 'darwin',
      port: activePort,
      status: 'unknown',
      serviceName: 'macOS Application Firewall',
      summary: 'Connessioni di rete in ingresso per Karaoke Live Station.app',
      command: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Karaoke\\ Live\\ Station.app && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /Applications/Karaoke\\ Live\\ Station.app`,
      commandExplanation: 'Esegui questo comando nel Terminale di macOS con privilegi di amministratore.',
      guiSteps: [
        'Alla prima apertura, macOS mostra un avviso: "Consentire all\'applicazione Karaoke Live Station di accettare connessioni in ingresso?". Clicca su "Consenti".',
        'Se gli smartphone non si collegano: apri Impostazioni di Sistema (System Settings) ➔ Rete (Network) ➔ Firewall.',
        'Clicca su "Opzioni" e assicurati che "Karaoke Live Station" sia impostata su "Consenti connessioni in entrata".'
      ]
    };

    if (currentPlatform === 'darwin') {
      try {
        const output = execFileSync('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], {
          encoding: 'utf8',
          timeout: 2500,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        if (output && output.toLowerCase().includes('disabled')) {
          macRule.status = 'allowed';
          macRule.summary = 'Firewall di macOS disattivato (tutte le connessioni in ingresso sono permesse).';
        } else if (output && output.toLowerCase().includes('enabled')) {
          macRule.status = 'unknown';
          macRule.summary = 'Firewall di macOS attivo. Verifica che l\'app sia autorizzata.';
        }
      } catch {
        macRule.status = 'unknown';
      }
    }

    // 3. Linux Diagnosis & Rules
    const linuxRule: FirewallRuleInfo = {
      platform: 'linux',
      port: activePort,
      status: 'unknown',
      serviceName: 'Linux Firewall (UFW / Firewalld)',
      summary: 'Apertura porte TCP ' + minPort + '-' + maxPort + '/tcp',
      command: `sudo ufw allow ${minPort}:${maxPort}/tcp`,
      commandExplanation: 'Comando per distribuzioni con UFW (Ubuntu, Debian, Linux Mint).',
      guiSteps: [
        `Per UFW (Ubuntu/Debian/Mint): sudo ufw allow ${minPort}:${maxPort}/tcp`,
        `Per Firewalld (Fedora/RHEL/CentOS): sudo firewall-cmd --add-port=${minPort}-${maxPort}/tcp --permanent && sudo firewall-cmd --reload`,
        'Se usi un router con isolamento client AP ("AP Client Isolation"), disattivalo nelle impostazioni Wi-Fi del modem per permettere ai telefoni di raggiungere il PC.'
      ]
    };

    if (currentPlatform === 'linux') {
      try {
        let isUfwEnabled = false;
        if (fs.existsSync('/etc/ufw/ufw.conf')) {
          const conf = fs.readFileSync('/etc/ufw/ufw.conf', 'utf8');
          if (conf.includes('ENABLED=yes')) {
            isUfwEnabled = true;
          }
        }

        if (!isUfwEnabled) {
          linuxRule.status = 'allowed';
          linuxRule.summary = 'UFW non attivo nel sistema (le porte sono accessibili sulla LAN).';
        } else {
          linuxRule.status = 'blocked';
          linuxRule.summary = `UFW è attivo nel sistema: autorizza la porta TCP ${activePort} per consentire l'accesso mobile.`;
        }
      } catch {
        linuxRule.status = 'unknown';
        linuxRule.summary = 'Verifica le regole del firewall con i comandi indicati di seguito.';
      }
    }

    return {
      currentPlatform,
      activePort,
      lanIp,
      rules: {
        win32: windowsRule,
        darwin: macRule,
        linux: linuxRule
      }
    };
  }
}

