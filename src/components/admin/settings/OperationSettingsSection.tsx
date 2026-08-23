import React from 'react';
import { tx } from '../../../i18n';
import type { PrintSettingsState, ZReportReceiptSettingsState, BeverageServiceSettingsState, TableServiceSettingsState } from './types';
import type { LocalPrintAgentPrinter } from '../../../lib/local_print_agent';
import { isAgentVersionOutdated } from '../../../lib/local_print_agent';

export interface OperationSettingsSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;

  // Print settings
  printSettings: PrintSettingsState;
  setPrintSettings: React.Dispatch<React.SetStateAction<PrintSettingsState>>;
  savePrintSettings: () => Promise<void>;

  // Printer-related state
  systemPrinters: LocalPrintAgentPrinter[];
  customPrinterMode: boolean;
  setCustomPrinterMode: React.Dispatch<React.SetStateAction<boolean>>;
  testingPrint: 'cashier' | 'kitchen' | null;
  handleTestPrint: (type: 'cashier' | 'kitchen') => Promise<void>;
  checkPrintAgentStatus: () => Promise<void>;
  printAgentHealth: 'unknown' | 'checking' | 'online' | 'offline';
  printAgentVersion: string;
  printAgentMinVersion: string;
  qzHealth: 'unknown' | 'checking' | 'online' | 'offline';
  qzPrintersCount: number;
  printAgentModalOpen: boolean;
  setPrintAgentModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  downloadPrintAgentWindowsZip: () => Promise<void>;
  downloadPrintAgentSetup: () => Promise<void>;

  // Z-Report receipt settings
  zReportReceiptSettings: ZReportReceiptSettingsState;
  setZReportReceiptSettings: React.Dispatch<React.SetStateAction<ZReportReceiptSettingsState>>;
  saveZReportReceiptSettings: () => Promise<void>;

  // Table service settings
  tableServiceSettings: TableServiceSettingsState;
  setTableServiceSettings: React.Dispatch<React.SetStateAction<TableServiceSettingsState>>;
  saveTableServiceSettings: () => Promise<void>;

  // Beverage service settings
  beverageServiceSettings: BeverageServiceSettingsState;
  setBeverageServiceSettings: React.Dispatch<React.SetStateAction<BeverageServiceSettingsState>>;
  saveBeverageServiceSettings: () => Promise<void>;
}

export function OperationSettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  notify: _notify,
  printSettings,
  setPrintSettings,
  savePrintSettings,
  systemPrinters,
  customPrinterMode,
  setCustomPrinterMode,
  testingPrint,
  handleTestPrint,
  checkPrintAgentStatus,
  printAgentHealth,
  printAgentVersion,
  printAgentMinVersion,
  qzHealth,
  qzPrintersCount,
  printAgentModalOpen,
  setPrintAgentModalOpen,
  downloadPrintAgentWindowsZip,
  downloadPrintAgentSetup,
  zReportReceiptSettings,
  setZReportReceiptSettings,
  saveZReportReceiptSettings,
  tableServiceSettings,
  setTableServiceSettings,
  saveTableServiceSettings,
  beverageServiceSettings,
  setBeverageServiceSettings,
  saveBeverageServiceSettings,
}: OperationSettingsSectionProps) {
  return (
    <>
      {/* ═══ Print Settings ═══ */}
      <div id="sec-print" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Çap Ayarları', 'Настройки печати', 'Print Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Ən sərfəli səssiz çap yolu iRonWaves Print Agent-dir. Agent bu kompüterdə işləyirsə POS, masa çeki və Z-report əvvəlcə ona göndərilir; agent yoxdursa QZ/browser fallback qalır.',
            'Самый выгодный способ тихой печати — iRonWaves Print Agent. Если агент запущен на этом компьютере, POS, чеки столов и Z-отчет сначала отправляются ему; если агента нет, остается QZ/browser fallback.',
            'The most cost-effective silent printing path is iRonWaves Print Agent. If it is running on this computer, POS, table receipts, and Z-report print through it first; otherwise QZ/browser fallback remains.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Kassa Çek Printeri */}
          <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <label className="text-xs font-bold text-slate-200">
              🧾 {tx(lang, 'Kassa Çek Printeri (Müştəri çeki)', 'Принтер кассовых чеков (Клиентский чек)', 'Cashier Receipt Printer (Customer receipt)')}
            </label>
            {systemPrinters.length > 0 ? (
              <>
                <select
                  className="neon-input bg-slate-900 border border-slate-700/60 rounded-xl"
                  value={customPrinterMode ? '__custom__' : (printSettings.printer_name || '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__custom__') {
                      setCustomPrinterMode(true);
                    } else {
                      setCustomPrinterMode(false);
                      setPrintSettings((prev) => ({ ...prev, printer_name: val }));
                    }
                  }}
                >
                  <option value="">
                    {tx(
                      lang,
                      'Lokal default printer (Windows/Mac default)',
                      'Локальный принтер по умолчанию (Windows/Mac default)',
                      'Local default printer (Windows/Mac default)',
                    )}
                  </option>
                  {systemPrinters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.default ? tx(lang, '(Sistem Default)', '(Системный по умолчанию)', '(System Default)') : ''}
                    </option>
                  ))}
                  {printSettings.printer_name && !systemPrinters.some(p => p.name.trim().toLowerCase() === printSettings.printer_name.trim().toLowerCase()) && (
                    <option value={printSettings.printer_name}>
                      {printSettings.printer_name} {tx(lang, '(Yadda saxlanılan)', '(Сохраненный)', '(Saved)')}
                    </option>
                  )}
                  <option value="__custom__">
                    {tx(
                      lang,
                      'Xüsusi printer daxil et... (Manual)',
                      'Ввести имя принтера вручную...',
                      'Enter custom printer name... (Manual)',
                    )}
                  </option>
                </select>
                {customPrinterMode && (
                  <input
                    className="neon-input transition-all duration-300 mt-2"
                    value={printSettings.printer_name}
                    onChange={(e) => setPrintSettings((prev) => ({ ...prev, printer_name: e.target.value }))}
                    placeholder={tx(lang, 'Kassa printer adı daxil edin', 'Введите имя кассового принтера', 'Enter cashier printer name')}
                  />
                )}
              </>
            ) : (
              <input
                className="neon-input"
                value={printSettings.printer_name}
                onChange={(e) => setPrintSettings((prev) => ({ ...prev, printer_name: e.target.value }))}
                placeholder={tx(lang, 'Kassa printer adı (məs. POS-80)', 'Имя кассового принтера (напр. POS-80)', 'Cashier printer name (e.g. POS-80)')}
              />
            )}
            <label className="flex items-center gap-2 text-xs text-slate-300 mt-2">
              <input
                type="checkbox"
                checked={printSettings.auto_print_receipt !== false}
                onChange={(e) => setPrintSettings((prev) => ({ ...prev, auto_print_receipt: e.target.checked }))}
              />
              <span>{tx(lang, 'Ödənişdə avtomatik kassa çeki çap et', 'Автоматически печатать чек при оплате', 'Auto-print receipt on payment')}</span>
            </label>
          </div>

          {/* Mətbəx Çek Printeri */}
          <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <label className="text-xs font-bold text-amber-300">
              🍳 {tx(lang, 'Mətbəx Çek Printeri (Kitchen Ticket / Runner)', 'Принтер чеков кухни (Kitchen Ticket / Runner)', 'Kitchen Ticket Printer (Runner slip)')}
            </label>
            {systemPrinters.length > 0 ? (
              <select
                className="neon-input bg-slate-900 border border-slate-700/60 rounded-xl"
                value={printSettings.kitchen_printer_name || ''}
                onChange={(e) => setPrintSettings((prev) => ({ ...prev, kitchen_printer_name: e.target.value }))}
              >
                <option value="">
                  {tx(
                    lang,
                    'Kassa printeri ilə eyni (və ya Default)',
                    'Такой же как кассовый (или Default)',
                    'Same as cashier printer (or Default)',
                  )}
                </option>
                {systemPrinters.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.default ? tx(lang, '(Sistem Default)', '(Системный по умолчанию)', '(System Default)') : ''}
                  </option>
                ))}
                {printSettings.kitchen_printer_name && !systemPrinters.some(p => p.name.trim().toLowerCase() === printSettings.kitchen_printer_name.trim().toLowerCase()) && (
                  <option value={printSettings.kitchen_printer_name}>
                    {printSettings.kitchen_printer_name} {tx(lang, '(Yadda saxlanılan)', '(Сохраненный)', '(Saved)')}
                  </option>
                )}
              </select>
            ) : (
              <input
                className="neon-input"
                value={printSettings.kitchen_printer_name || ''}
                onChange={(e) => setPrintSettings((prev) => ({ ...prev, kitchen_printer_name: e.target.value }))}
                placeholder={tx(lang, 'Mətbəx printer adı və ya IP (məs. Kitchen-80)', 'Имя принтера кухни или IP (напр. Kitchen-80)', 'Kitchen printer name or IP (e.g. Kitchen-80)')}
              />
            )}
            <label className="flex items-center gap-2 text-xs text-amber-200 mt-2">
              <input
                type="checkbox"
                checked={printSettings.auto_print_kitchen_ticket !== false}
                onChange={(e) => setPrintSettings((prev) => ({ ...prev, auto_print_kitchen_ticket: e.target.checked }))}
              />
              <span>{tx(lang, 'Mətbəxə göndərildikdə avtomatik mətbəx çeki çıxar', 'Автоматически печатать чек при отправке на кухню', 'Auto-print ticket when sent to kitchen')}</span>
            </label>
          </div>
        </div>

        {/* Termal Presetlər və Çap Rejimi */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-cyan-300">
              📏 {tx(lang, 'Kağız Eni (Termal Format)', 'Ширина бумаги (Термо формат)', 'Paper Width (Thermal Preset)')}
            </label>
            <select
              className="neon-input bg-slate-900 border border-slate-700/60 rounded-xl"
              value={printSettings.paper_width}
              onChange={(e) => setPrintSettings((prev) => ({ ...prev, paper_width: e.target.value as any }))}
            >
              <option value="58mm">58 mm (XP-58, POS-58 - Standart Balaca Termal)</option>
              <option value="80mm">80 mm (XP-80, Epson TM-T20/T88 - Standart Böyük Termal)</option>
            </select>
            <span className="text-[11px] text-slate-400">
              {printSettings.paper_width === '58mm'
                ? tx(lang, '48mm çap sahəsi (32 simvol sətir). Hərflərin kəsilməsini aradan qaldırır.', 'Ширина печати 48мм (32 символа). Предотвращает обрезку строк.', '48mm printable area (32 chars/line). Prevents cropped text.')
                : tx(lang, '72mm çap sahəsi (42-48 simvol sətir). Geniş çəklər üçün.', 'Ширина печати 72мм (42-48 символов). For wide tickets.')}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-purple-300">
              ⚡ {tx(lang, 'Çap Rejimi (Print Engine)', 'Режим печати (Print Engine)', 'Print Engine Mode')}
            </label>
            <select
              className="neon-input bg-slate-900 border border-slate-700/60 rounded-xl"
              value={printSettings.print_engine}
              onChange={(e) => setPrintSettings((prev) => ({ ...prev, print_engine: e.target.value as any }))}
            >
              <option value="raw_escpos">{tx(lang, 'ESC/POS Raw (Tövsiyə olunur - Ultra Sürətli & Heç vaxt boş çıxmaz)', 'ESC/POS Raw (Рекомендуется - Ультра быстро и без сбоев)', 'ESC/POS Raw (Recommended - Ultra fast & never blank)')}</option>
              <option value="pixel_html">{tx(lang, 'Standart HTML / Qrafik Çap', 'Стандартный HTML / Графическая печать', 'Standard HTML / Pixel Graphics')}</option>
            </select>
            <span className="text-[11px] text-slate-400">
              {printSettings.print_engine === 'raw_escpos'
                ? tx(lang, 'Birbaşa termal printer başlığına əmrlər göndərir. 0.05 san sürət, təmiz kəsim.', 'Прямые команды на головку термопринтера. 0.05 сек, чистый отрез.', 'Direct ESC/POS commands to thermal printhead. Instant and flawless.')
                : tx(lang, 'Qrafik formatda HTML çapı.', 'Графическая печать HTML.', 'Pixel HTML graphics print.')}
            </span>
          </div>
        </div>

        {/* Canlı Test Çapı Bölməsi */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
          <span className="text-xs font-bold text-slate-300 mr-2">🧪 {tx(lang, 'Canlı Test Çapı:', 'Тестовая печать:', 'Live Test Print:')}</span>
          <button
            type="button"
            disabled={testingPrint !== null}
            onClick={() => void handleTestPrint('cashier')}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-500/30 transition active:scale-95 flex items-center gap-2"
          >
            {testingPrint === 'cashier' ? <span className="animate-spin">⏳</span> : '🧾'}
            {tx(lang, 'Kassa Test Çeki Çap Et', 'Тест кассового чека', 'Print Cashier Test')}
          </button>
          <button
            type="button"
            disabled={testingPrint !== null}
            onClick={() => void handleTestPrint('kitchen')}
            className="rounded-xl border border-amber-500/40 bg-amber-500/20 px-3.5 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/30 transition active:scale-95 flex items-center gap-2"
          >
            {testingPrint === 'kitchen' ? <span className="animate-spin">⏳</span> : '🍳'}
            {tx(lang, 'Mətbəx Test Çeki Çap Et', 'Тест чека кухни', 'Print Kitchen Test')}
          </button>
        </div>

        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={printSettings.use_qz} onChange={(e) => setPrintSettings((prev) => ({ ...prev, use_qz: e.target.checked }))} />
            <span>{tx(lang, 'QZ Tray fallback istifadə et', 'Использовать fallback QZ Tray', 'Use QZ Tray fallback')}</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-3.5 py-2.5 text-xs font-bold text-cyan-100 transition hover:bg-cyan-500/30 active:scale-95 flex items-center gap-2"
            onClick={() => void checkPrintAgentStatus()}
          >
            <span className={printAgentHealth === 'checking' || qzHealth === 'checking' ? 'animate-spin' : ''}>🔄</span>
            {tx(lang, 'Printer və Agentləri Yoxla', 'Проверить принтеры и агенты', 'Check Printers & Agents')}
          </button>

          <button
            type="button"
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            onClick={() => {
              setPrintAgentModalOpen(true);
              void checkPrintAgentStatus();
            }}
          >
            {tx(lang, 'Lokal Agent Yüklə', 'Установить локальный агент', 'Download Local Agent')}
          </button>

          {/* iRonWaves Print Agent Status Badge */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-xs shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${printAgentHealth === 'online' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : printAgentHealth === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className="text-slate-400 font-medium">Lokal Agent (17777):</span>
            <span className={`font-bold ${printAgentHealth === 'online' ? 'text-emerald-300' : 'text-slate-400'}`}>
              {printAgentHealth === 'online' ? `Online (v${printAgentVersion || '0.2.0'})` : printAgentHealth === 'checking' ? 'Yoxlanır...' : 'Offline'}
            </span>
          </div>

          {/* QZ Tray Status Badge */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-xs shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${qzHealth === 'online' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : qzHealth === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-400 font-medium">QZ Tray:</span>
            <span className={`font-bold ${qzHealth === 'online' ? 'text-emerald-300' : 'text-rose-400'}`}>
              {qzHealth === 'online' ? `Online (${qzPrintersCount} printer tapıldı)` : qzHealth === 'checking' ? 'Yoxlanır...' : 'Offline'}
            </span>
          </div>
        </div>

        {qzHealth === 'offline' && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            💡 <b>QZ Tray açıqdırsa, amma Offline görünürsə:</b>
            <ul className="mt-1 list-disc list-inside space-y-0.5 text-slate-300">
              <li>QZ Tray ikonunun sistem zolağında (System Tray) <b>yaşıl</b> rəngdə olduğundan əmin olun.</li>
              <li>Əgər brauzer QZ Tray sertifikatına blok qoyubsa, brauzerdə <a href="https://localhost:8181" target="_blank" rel="noreferrer" className="text-cyan-300 underline font-bold">https://localhost:8181</a> linkini açıb <i>&quot;Davam et (təhlükəli deyil / Advanced ➔ Proceed)&quot;</i> klikləyin.</li>
              <li>Sonra yuxarıdakı <b>&quot;Printer və Agentləri Yoxla&quot;</b> düyməsinə klikləyin.</li>
            </ul>
          </div>
        )}
        {printSettings.use_qz && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-slate-300 space-y-3">
            <span className="font-semibold text-emerald-400 block text-sm">
              🔒 {tx(lang, 'QZ Tray — Sessiz Çap Quraşdırması', 'QZ Tray — Настройка тихой печати', 'QZ Tray — Silent Print Setup')}
            </span>

            {/* One-click download buttons */}
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-emerald-200">
                {tx(lang, '⚡ Ən sadə yol (1 dəqiqə):', 'Самый простой способ (1 минута):', '⚡ Easiest way (1 minute):')}
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={URL.createObjectURL(new Blob(['7b202bd54bf3dbc7c9394001d2edbdaec85dd8df\n'], { type: 'text/plain' }))}
                  download="allowed.dat"
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-400/50 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 active:scale-95"
                >
                  📥 {tx(lang, 'allowed.dat yüklə', 'Скачать allowed.dat', 'Download allowed.dat')}
                </a>
                <a
                  href="/downloads/qz-digital-certificate.txt"
                  download="qz-digital-certificate.txt"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/50 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700/60 active:scale-95"
                >
                  📄 {tx(lang, 'Sertifikat yüklə', 'Скачать сертификат', 'Download certificate')}
                </a>
              </div>
              <div className="space-y-2 text-xs text-emerald-200/80">
                <p className="font-bold">{tx(lang, 'Quraşdırma addımları:', 'Шаги установки:', 'Setup steps:')}</p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    {tx(lang,
                      'Yuxarıdakı "allowed.dat yüklə" düyməsinə basın',
                      'Нажмите кнопку "Скачать allowed.dat" выше',
                      'Click "Download allowed.dat" button above')}
                  </li>
                  <li>
                    <strong>Windows:</strong> {tx(lang,
                      'Faylı bura kopyalayın:',
                      'Скопируйте файл сюда:',
                      'Copy file to:')} <code className="rounded bg-black/40 px-1.5 py-0.5">C:\ProgramData\QZ Tray\allowed.dat</code>
                  </li>
                  <li>
                    <strong>macOS:</strong> {tx(lang,
                      'Faylı bura kopyalayın:',
                      'Скопируйте файл сюда:',
                      'Copy file to:')} <code className="rounded bg-black/40 px-1.5 py-0.5">/Library/Application Support/qz/allowed.dat</code>
                  </li>
                  <li>
                    {tx(lang,
                      'QZ Tray-i restart edin (system tray → sağ klik → Exit → yenidən açın)',
                      'Перезапустите QZ Tray (system tray → правый клик → Exit → откройте снова)',
                      'Restart QZ Tray (system tray → right-click → Exit → reopen)')}
                  </li>
                </ol>
                <p className="mt-2 text-emerald-300/70 italic">
                  ✅ {tx(lang,
                    'Bir dəfə quraşdırıldıqdan sonra heç bir dialog gəlməyəcək. Bütün çap əməliyyatları sessiz olacaq.',
                    'После установки ни одно окно подтверждения больше не появится. Вся печать будет бесшумной.',
                    'Once installed, no confirmation dialogs will appear. All printing will be silent.')}
                </p>
              </div>
            </div>

            {/* Alternative: Site Manager method */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200 transition">
                {tx(lang, '📖 Alternativ yol: QZ Tray Site Manager', '📖 Альтернативный способ: QZ Tray Site Manager', '📖 Alternative: QZ Tray Site Manager')}
              </summary>
              <ol className="mt-2 list-decimal pl-4 space-y-1 text-xs text-slate-400">
                <li>
                  {tx(lang, 'Sertifikat faylını yükləyin (yuxarıdakı "Sertifikat yüklə" düyməsi)', 'Скачайте файл сертификата (кнопка "Скачать сертификат" выше)', 'Download the certificate file (button above)')}
                </li>
                <li>
                  {tx(lang, 'QZ Tray ikonuna sağ klikləyin → Advanced → Site Manager', 'Правый клик по иконке QZ Tray → Advanced → Site Manager', 'Right-click QZ Tray icon → Advanced → Site Manager')}
                </li>
                <li>
                  {tx(lang, '"+" düyməsinə basıb sertifikat faylını seçin', 'Нажмите "+" и выберите файл сертификата', 'Click "+" and select the certificate file')}
                </li>
              </ol>
            </details>
          </div>
        )}
        {renderPanelSuccess('print')}
        <div className="flex justify-end">
          <button onClick={() => { void savePrintSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {/* ═══ Z-Report Receipt Settings ═══ */}
      <div id="sec-zreport" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Z-Hesabat Çek Ayarları', 'Настройки чека Z-отчёта', 'Z-report receipt settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Admin buradan Z-Hesabat çekində hansı hissələrin görünəcəyini seçə bilər. Maaş, xərclər, giriş pulları, depozit və kassir breakdown-u checkbox ilə idarə olunur.',
            'Здесь администратор выбирает, какие секции будут показаны в чеке Z-отчёта. Зарплата, расходы, поступления, депозиты и разбивка по кассирам управляются чекбоксами.',
            'Choose which sections appear on the Z-report receipt. Wage, expenses, inflows, deposits, and cashier breakdown are controlled here.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {([
            ['show_operator', tx(lang, 'Operator görünsün', 'Показывать оператора', 'Show operator')],
            ['show_date_range', tx(lang, 'Tarix aralığı görünsün', 'Показывать диапазон дат', 'Show date range')],
            ['show_sales_summary', tx(lang, 'Satış xülasəsi görünsün', 'Показывать сводку продаж', 'Show sales summary')],
            ['show_profit_summary', tx(lang, 'Maya və mənfəət görünsün', 'Показывать себестоимость и прибыль', 'Show COGS and profit')],
            ['show_wage', tx(lang, 'Maaş çıxışı görünsün', 'Показывать списание зарплаты', 'Show wage deduction')],
            ['show_shift_cash', tx(lang, 'Açılış və bağlanış kassası görünsün', 'Показывать открытие и закрытие кассы', 'Show opening and closing cash')],
            ['show_cash_movements', tx(lang, 'Kassa giriş/çıxışları görünsün', 'Показывать движения по кассе', 'Show cash movements')],
            ['show_other_income', tx(lang, 'Digər giriş pulları görünsün', 'Показывать прочие поступления', 'Show other income')],
            ['show_other_expense', tx(lang, 'Digər xərclər görünsün', 'Показывать прочие расходы', 'Show other expenses')],
            ['show_deposit_summary', tx(lang, 'Depozit xülasəsi görünsün', 'Показывать сводку депозитов', 'Show deposit summary')],
            ['show_cashier_breakdown', tx(lang, 'Kassir breakdown-u görünsün', 'Показывать разбивку по кассирам', 'Show cashier breakdown')],
            ['show_item_breakdown', tx(lang, 'Məhsul satışları görünsün', 'Показывать продажи товаров', 'Show item sales breakdown')],
            ['show_counts', tx(lang, 'Satış və void sayları görünsün', 'Показывать количество продаж и void', 'Show sales and void counts')],
          ] as Array<[string, string]>).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-950/35 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={Boolean((zReportReceiptSettings as any)[key])}
                onChange={(e) => setZReportReceiptSettings((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {renderPanelSuccess('zreport_receipt')}
        <div className="flex justify-end">
          <button onClick={() => { void saveZReportReceiptSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {/* ═══ Table Service Settings ═══ */}
      <div id="sec-tables" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Masa Xidməti Ayarları', 'Настройки обслуживания столов', 'Table Service Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Masada xidmət üçün servis haqqını və nəfər başı depozit məbləğini buradan təyin edin. Depozit masa açılarkən kassaya daxil olur və hesab bağlananda yekun məbləğin içinə sayılır.',
            'Здесь задаются сервисный сбор и депозит с человека для обслуживания за столом. Депозит сразу входит в кассу и затем учитывается при закрытии счета.',
            'Configure table-service fee and per-guest deposit here. The deposit is recorded when the table opens and counted into the final bill on checkout.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Servis haqqı (%)', 'Сервисный сбор (%)', 'Service fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={tableServiceSettings.service_fee_percent}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, service_fee_percent: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Nəfər başı depozit (AZN)', 'Депозит с человека (AZN)', 'Deposit per guest (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={tableServiceSettings.deposit_per_guest_azn}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, deposit_per_guest_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Rezervə bağlama pəncərəsi (saat)', 'Окно блокировки резерва (часы)', 'Reservation lock window (hours)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.5"
              value={tableServiceSettings.reservation_lock_hours}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, reservation_lock_hours: e.target.value }))}
            />
            <div className="field-hint">
              {tx(
                lang,
                'Bu saat aralığında rezerv olunmuş masa adi masa kimi açılmayacaq. 0 yazsanız rezerv bloklama söndürüləcək.',
                'В этом окне забронированный стол нельзя открыть как обычный. 0 отключает блокировку.',
                'Within this time window, a reserved table cannot be opened as a normal table. Set 0 to disable the reservation lock.',
              )}
            </div>
          </div>
        </div>
        {renderPanelSuccess('table_service')}
        <div className="flex justify-end">
          <button onClick={() => { void saveTableServiceSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {/* ═══ Beverage Service Settings ═══ */}
      <div id="sec-beverage" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İçki Servis Ayarları', 'Настройки подачи напитков', 'Beverage Service Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Kofe seçiləndə yalnız ölçü soruşulsun, yoxsa əlavə olaraq to go və ya masa/stəkan seçimi də açılsın — bunu buradan təyin edin.',
            'Здесь можно выбрать: при выборе кофе спрашивать только размер или дополнительно способ подачи — to go / в стакане на стол.',
            'Choose whether coffee selection should ask only for size or also for service mode like to-go or table glass.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Kofe seçim popup-u', 'Popup выбора кофе', 'Coffee selection popup')}</label>
            <select
              className="neon-input"
              value={beverageServiceSettings.coffee_selection_mode}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  coffee_selection_mode: e.target.value === 'size_only' ? 'size_only' : 'size_and_service',
                }))
              }
            >
              <option value="size_and_service">{tx(lang, 'Ölçü + stəkan seçimi', 'Размер + выбор стакана', 'Size + cup choice')}</option>
              <option value="size_only">{tx(lang, 'Yalnız ölçü seçimi', 'Только выбор размера', 'Size only')}</option>
            </select>
            <div className="field-hint">
              {tx(
                lang,
                'Məsələn Amerikano seçiləndə ayrıca Kağız stəkan (to go) və ya Stəkan (masa) soruşmaq istəyirsinizsə birinci variantı seçin.',
                'Если при выборе Американо нужно спрашивать Бумажный стакан (to go) или Стакан (table), выберите первый вариант.',
                'Choose the first option if Americano should ask for Paper cup (to go) or Glass (table).',
              )}
            </div>
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Endirim tətbiqi sahəsi', 'Область применения скидки', 'Discount scope')}</label>
            <select
              className="neon-input"
              value={beverageServiceSettings.discount_scope}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  discount_scope: e.target.value === 'coffee_only' ? 'coffee_only' : 'all_items',
                }))
              }
            >
              <option value="all_items">{tx(lang, 'Bütün məhsullara', 'Ко всем товарам', 'All items')}</option>
              <option value="coffee_only">{tx(lang, 'Yalnız kofe məhsullarına', 'Только к кофейным товарам', 'Coffee items only')}</option>
            </select>
            <div className="field-hint">
              {tx(
                lang,
                'Bu ayar manual endirimin tətbiq sahəsini idarə edir. Müştəri tipinə görə kofe endirimləri əvvəlki kimi qalır.',
                'Эта настройка управляет ручной скидкой. Скидки по типу клиента для кофе остаются как раньше.',
                'This controls manual discount scope. Coffee tier discounts by customer type remain unchanged.',
              )}
            </div>
          </div>
          <label className="form-card flex items-center justify-between gap-4">
            <div>
              <div className="field-label">{tx(lang, 'Masa seçiləndə kağız stəkanı çıxart', 'Убирать бумажный стакан для зала', 'Exclude paper cup for table service')}</div>
              <div className="field-hint">
                {tx(
                  lang,
                  'Stəkan (masa) seçiləndə reseptdəki kağız stəkan və qapaq sərfdən çıxarılmayacaq.',
                  'Если выбран стакан для зала, бумажный стакан и крышка не будут списаны по рецепту.',
                  'When table glass is selected, paper cup and lid will not be consumed from recipe stock.',
                )}
              </div>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={beverageServiceSettings.remove_paper_packaging_for_table}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  remove_paper_packaging_for_table: e.target.checked,
                }))
              }
            />
          </label>
          <label className="form-card flex items-center justify-between gap-4">
            <div>
              <div className="field-label">{tx(lang, 'Yaz kampaniyası (2-ci məhsul 50% endirimlə)', 'Летняя кампания (2-й товар 50% скидка)', 'Summer Campaign (2nd item 50% off)')}</div>
              <div className="field-hint">
                {tx(
                  lang,
                  'Soyuq içkilər, iced kofe, frappe və smuzilərə 1 alana 2-ci 50% endirim tətbiq edir.',
                  'Применяет акцию 1+1 (2-й товар со скидкой 50%) для холодных напитков, айс кофе, фраппе и смузи.',
                  'Applies the buy 1 get 2nd at 50% off promo for cold drinks, iced coffee, frappe, and smoothies.',
                )}
              </div>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={beverageServiceSettings.summer_promo_enabled}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  summer_promo_enabled: e.target.checked,
                }))
              }
            />
          </label>
        </div>
        {renderPanelSuccess('beverage')}
        <div className="flex justify-end">
          <button onClick={() => { void saveBeverageServiceSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {/* Print Agent Setup Modal */}
      {printAgentModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-100">
                {tx(lang, 'Printer Agent quraşdırılması', 'Установка Printer Agent', 'Printer Agent setup')}
              </h3>
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => setPrintAgentModalOpen(false)}
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300 space-y-2">
              <div className="font-bold text-cyan-300">{tx(lang, 'Seçim A: Windows Bir-Kliklə Səssiz Qurulum (Tövsiyə olunur)', 'Вариант А: Тихая установка Windows в один клик (Рекомендуется)', 'Option A: Windows One-Click Silent Setup (Recommended)')}</div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>{tx(lang, 'Qurulum ZIP arxivini kompüterinizə yükləyin və qovluğa çıxarın.', 'Скачайте установочный ZIP-архив на ПК и распакуйте в папку.', 'Download the setup ZIP archive to your PC and extract it to a folder.')}</li>
                <li>{tx(lang, 'Qovluqdakı "setup.bat" faylına sadəcə cüt klikləyin (double-click).', 'Просто дважды кликните на файл "setup.bat" в папке.', 'Simply double-click the "setup.bat" file in the folder.')}</li>
                <li>{tx(lang, 'Quraşdırma 1 saniyədə tamamlanacaq, agent startap-a yerləşib arxa fonda səssizcə işləyəcək (bloklanmadan).', 'Установка завершится за 1 секунду, агент добавится в автозапуск и будет бесшумно работать в фоне.', 'Setup will complete in 1 second, the agent will go to startup and run silently in the background.')}</li>
              </ol>
            </div>

            <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/20 p-3 text-xs text-slate-400 space-y-2">
              <div className="font-bold text-slate-300">{tx(lang, 'Seçim B: Standart EXE Yükləyici', 'Вариант Б: Стандартный установщик EXE', 'Option B: Standard EXE Installer')}</div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>{tx(lang, 'Windows PC-də .exe yükləyicisini endirin.', 'Скачайте установщик .exe на Windows ПК.', 'Download the .exe installer on the Windows PC.')}</li>
                <li>{tx(lang, 'Faylı işə salın və Next → Finish klikləyin.', 'Запустите файл и нажмите Next → Finish.', 'Run the file and click Next → Finish.')}</li>
              </ol>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadPrintAgentWindowsZip()}
                className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100"
              >
                {tx(lang, 'Səssiz Qurulum (ZIP) Yüklə', 'Скачать тихую установку (ZIP)', 'Download Silent Setup (ZIP)')}
              </button>
              <button
                type="button"
                onClick={() => void downloadPrintAgentSetup()}
                className="rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100"
              >
                {tx(lang, 'Standart .exe Yüklə', 'Скачать стандартный .exe', 'Download Standard .exe')}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200"
                onClick={() => void checkPrintAgentStatus()}
              >
                {tx(lang, 'Statusu yoxla', 'Проверить статус', 'Check status')}
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
              {printAgentHealth === 'online'
                ? tx(lang, 'Agent işləyir: online ✅', 'Агент работает: online ✅', 'Agent is running: online ✅')
                : printAgentHealth === 'offline'
                  ? tx(lang, 'Agent tapılmadı: offline. Quraşdırmadan sonra bu pəncərədə yenidən status yoxlayın.', 'Агент не найден: offline. После установки снова проверьте статус.', 'Agent not found: offline. After install, check status again here.')
                  : printAgentHealth === 'checking'
                    ? tx(lang, 'Status yoxlanır...', 'Проверка статуса...', 'Checking status...')
                    : tx(lang, 'Status hələ yoxlanmayıb.', 'Статус еще не проверен.', 'Status not checked yet.')}
              {printAgentVersion ? (
                <div className="mt-1">
                  {tx(lang, 'Agent versiyası', 'Версия агента', 'Agent version')}: <span className="font-semibold">{printAgentVersion}</span>
                </div>
              ) : null}
              {printAgentVersion && isAgentVersionOutdated(printAgentVersion, printAgentMinVersion) ? (
                <div className="mt-1 text-amber-300">
                  {tx(
                    lang,
                    `Yeniləmə tövsiyə olunur (minimum: ${printAgentMinVersion}).`,
                    `Рекомендуется обновление (минимум: ${printAgentMinVersion}).`,
                    `Update recommended (minimum: ${printAgentMinVersion}).`,
                  )}
                </div>
              ) : null}
              {printAgentVersion && isAgentVersionOutdated(printAgentVersion, printAgentMinVersion) ? (
                <div className="mt-1 text-slate-300">
                  {tx(
                    lang,
                    'Yenilə düyməsini basın, setup faylını run edin, sonra bu pəncərədə Statusu yoxla edin.',
                    'Нажмите кнопку обновления, запустите setup, затем снова проверьте статус в этом окне.',
                    'Click update, run the setup file, then check status again in this window.',
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
