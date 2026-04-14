import React, { useState, useEffect } from 'react';
import { get_tables_live, create_table_live, delete_table_live } from '../../api/tables';
import { get_active_happy_hour_live, create_happy_hour_live, toggle_happy_hour_live } from '../../api/happy_hours';
import { update_table_layout_live } from '../../api/restaurant';
import { LayoutGrid, Clock, Plus, Trash2, Pencil } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_logs_live } from '../../api/logs';

export default function TablesHappyHourPanel() {
  const { user, lang } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [tables, setTables] = useState<any[]>([]);
  const [activeHH, setActiveHH] = useState<any>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  const loadData = async () => {
    setTables(await get_tables_live(tenant_id));
    setActiveHH(await get_active_happy_hour_live());
    const rows = (await get_logs_live(tenant_id, 300)).filter((l: any) => String(l.action || '').startsWith('TABLE_'));
    setAuditRows(rows);
  };

  const handleAddTable = async () => {
    const label = prompt(tx(lang, 'Yeni Masanın Adı (Məs: Masa 5):', 'Название нового стола (напр.: Стол 5):'));
    if (!label) return;
    try {
      await create_table_live(tenant_id, label, user?.username || 'Admin');
      await loadData();
    } catch(e:any) { alert(tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
  };

  const handleDeleteTable = async (id: string) => {
    if(confirm(tx(lang, 'Masanı silmək istəyirsiniz?', 'Вы хотите удалить стол?'))) {
      try {
        await delete_table_live(id, user?.username || 'Admin');
        await loadData();
      } catch(e:any) { alert(tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
    }
  };

  const handleEditTable = async (table: any) => {
    const nextLabel = prompt(
      tx(lang, 'Yeni masa adı', 'Новое название стола', 'New table name'),
      String(table?.label || ''),
    );
    if (nextLabel === null) return;
    const trimmedLabel = String(nextLabel).trim();
    if (!trimmedLabel) {
      alert(tx(lang, 'Masa adı boş ola bilməz', 'Название стола не может быть пустым', 'Table name cannot be empty'));
      return;
    }
    const nextPosXRaw = prompt(
      tx(lang, 'X koordinatı', 'Координата X', 'X coordinate'),
      String(Number(table?.pos_x ?? 0)),
    );
    if (nextPosXRaw === null) return;
    const nextPosYRaw = prompt(
      tx(lang, 'Y koordinatı', 'Координата Y', 'Y coordinate'),
      String(Number(table?.pos_y ?? 0)),
    );
    if (nextPosYRaw === null) return;
    const nextPosX = Number(nextPosXRaw);
    const nextPosY = Number(nextPosYRaw);
    if (!Number.isFinite(nextPosX) || !Number.isFinite(nextPosY)) {
      alert(tx(lang, 'Koordinatlar rəqəm olmalıdır', 'Координаты должны быть числом', 'Coordinates must be numeric'));
      return;
    }
    try {
      await update_table_layout_live(String(table.id), {
        label: trimmedLabel,
        pos_x: Math.max(0, Math.round(nextPosX)),
        pos_y: Math.max(0, Math.round(nextPosY)),
      });
      await loadData();
    } catch (e: any) {
      alert(tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  return (
    <div className="space-y-8">
      {/* Masalar */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid/> {tx(lang, 'Masaların İdarəsi', 'Управление столами')}</h2>
          <button onClick={() => { void handleAddTable(); }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700">
            <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол')}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tables.map(t => (
            <div key={t.id} className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center relative ${t.is_occupied ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100'}`}>
              <span className="font-bold text-lg">{t.label}</span>
              <span className="mt-1 text-[11px] text-slate-500">X:{Number(t.pos_x ?? 0)} Y:{Number(t.pos_y ?? 0)}</span>
              <span className={`text-xs px-2 py-1 rounded-full mt-2 ${t.is_occupied ? 'bg-orange-200 text-orange-800' : 'bg-green-100 text-green-700'}`}>
                {t.is_occupied ? tx(lang, 'Dolu', 'Занято') : tx(lang, 'Boş', 'Свободно')}
              </span>
              <button
                onClick={() => { void handleEditTable(t); }}
                className="absolute top-2 left-2 text-gray-400 hover:text-blue-600"
                title={tx(lang, 'Masanı redaktə et', 'Редактировать стол', 'Edit table')}
              >
                <Pencil size={16}/>
              </button>
              {!t.is_occupied && (
                <button onClick={() => { void handleDeleteTable(t.id); }} className="absolute top-2 right-2 text-gray-400 hover:text-red-600">
                  <Trash2 size={16}/>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <hr />

      {/* Happy Hour */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2"><Clock/> {tx(lang, 'Happy Hour (Endirim Saatları)', 'Happy Hour (часы скидок)')}</h2>
          <button onClick={() => {
             void create_happy_hour_live({
               name: 'Səhər Kofesi', 
               start_time: '08:00', 
               end_time: '11:00', 
               discount_percent: 20, 
               days_of_week: [1,2,3,4,5], 
               categories: 'ALL',
               is_active: true
             }).then(() => {
               void loadData();
               alert(tx(lang, 'Nümunə Səhər Kofesi 20% Happy Hour yaradıldı!', 'Создан пример Happy Hour: утренний кофе 20%!'));
             });
          }} className="bg-yellow-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-yellow-600">
            <Plus size={20} /> {tx(lang, 'Nümunə Yarat', 'Создать пример')}
          </button>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg">{activeHH ? activeHH.name : tx(lang, 'Aktiv Happy Hour yoxdur', 'Нет активного Happy Hour')}</h3>
            {activeHH && <p className="text-gray-500 text-sm">{tx(lang, 'Bitmə vaxtı', 'Окончание')}: {activeHH.end_time} • {tx(lang, 'Endirim', 'Скидка')}: {activeHH.discount_percent}%</p>}
          </div>
          {activeHH && (
            <button
              onClick={() => {
                void toggle_happy_hour_live(activeHH.id, false).then(() => void loadData());
              }}
              className="animate-pulse bg-red-100 text-red-600 px-3 py-1 rounded-full font-bold text-sm"
            >
              LIVE
            </button>
          )}
        </div>
      </div>

      <hr />

      <div>
        <h2 className="text-2xl font-bold mb-4">{tx(lang, 'Masa Audit Tarixçəsi', 'История аудита по столам', 'Table Audit History')}</h2>
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                <th className="px-3 py-2 text-left">{tx(lang, 'İstifadəçi', 'Пользователь', 'User')}</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {auditRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-slate-300">{new Date(row.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
                  <td className="px-3 py-2 text-slate-200">{row.user || '-'}</td>
                  <td className="px-3 py-2 text-yellow-300 font-medium">{row.action}</td>
                  <td className="px-3 py-2 text-slate-300 text-xs break-all">
                    {typeof row.details === 'string' ? row.details : JSON.stringify(row.details || {})}
                  </td>
                </tr>
              ))}
              {auditRows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-400" colSpan={4}>
                    {tx(lang, 'Hələ masa auditi qeydi yoxdur.', 'Пока нет записей аудита по столам.', 'No table audit records yet.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
