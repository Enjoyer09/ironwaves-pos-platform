import React, { useState, useEffect } from 'react';
import { get_tables, create_table, delete_table } from '../../api/tables';
import { get_active_happy_hour, create_happy_hour, toggle_happy_hour } from '../../api/happy_hours';
import { LayoutGrid, Clock, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_logs } from '../../api/logs';

export default function TablesHappyHourPanel() {
  const { user, lang } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [tables, setTables] = useState<any[]>([]);
  const [activeHH, setActiveHH] = useState<any>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, [tenant_id]);

  const loadData = () => {
    setTables(get_tables(tenant_id));
    setActiveHH(get_active_happy_hour());
    const rows = get_logs(tenant_id, 300).filter((l: any) => String(l.action || '').startsWith('TABLE_'));
    setAuditRows(rows);
  };

  const handleAddTable = () => {
    const label = prompt(tx(lang, 'Yeni Masanın Adı (Məs: Masa 5):', 'Название нового стола (напр.: Стол 5):'));
    if (!label) return;
    try {
      create_table(tenant_id, label, user?.username || 'Admin');
      loadData();
    } catch(e:any) { alert(tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
  };

  const handleDeleteTable = (id: string) => {
    if(confirm(tx(lang, 'Masanı silmək istəyirsiniz?', 'Вы хотите удалить стол?'))) {
      try {
        delete_table(id, user?.username || 'Admin');
        loadData();
      } catch(e:any) { alert(tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
    }
  };

  return (
    <div className="space-y-8">
      {/* Masalar */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid/> {tx(lang, 'Masaların İdarəsi', 'Управление столами')}</h2>
          <button onClick={handleAddTable} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700">
            <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол')}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tables.map(t => (
            <div key={t.id} className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center relative ${t.is_occupied ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100'}`}>
              <span className="font-bold text-lg">{t.label}</span>
              <span className={`text-xs px-2 py-1 rounded-full mt-2 ${t.is_occupied ? 'bg-orange-200 text-orange-800' : 'bg-green-100 text-green-700'}`}>
                {t.is_occupied ? tx(lang, 'Dolu', 'Занято') : tx(lang, 'Boş', 'Свободно')}
              </span>
              {!t.is_occupied && (
                <button onClick={() => handleDeleteTable(t.id)} className="absolute top-2 right-2 text-gray-400 hover:text-red-600">
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
             create_happy_hour({
               name: 'Səhər Kofesi', 
               start_time: '08:00', 
               end_time: '11:00', 
               discount_percent: 20, 
               days_of_week: [1,2,3,4,5], 
               categories: 'ALL',
               is_active: true
             });
             loadData();
             alert(tx(lang, 'Nümunə Səhər Kofesi 20% Happy Hour yaradıldı!', 'Создан пример Happy Hour: утренний кофе 20%!'));
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
            <span className="animate-pulse bg-red-100 text-red-600 px-3 py-1 rounded-full font-bold text-sm">🔴 LIVE</span>
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
