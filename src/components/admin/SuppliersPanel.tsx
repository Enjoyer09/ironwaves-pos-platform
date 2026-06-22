import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import {
  get_suppliers_live,
  add_supplier_live,
  update_supplier_live,
  delete_supplier_live,
  pay_supplier_live,
  type Supplier,
} from '../../api/suppliers';
import {
  Phone,
  Mail,
  MapPin,
  User,
  FileText,
  Plus,
  Search,
  Edit2,
  Trash2,
  DollarSign,
  CheckCircle,
  AlertCircle,
  X,
  CreditCard,
  Notebook,
} from 'lucide-react';

export default function SuppliersPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Supplier | null>(null);
  const [showPayModal, setShowPayModal] = useState<Supplier | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Supplier | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Payment states
  const [payAmount, setPayAmount] = useState('');
  const [paySource, setPaySource] = useState<'cash' | 'card' | 'safe'>('cash');
  const [payNote, setPayNote] = useState('');

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadSuppliers();
    return () => {
      mountedRef.current = false;
    };
  }, [tenant_id]);

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const data = await get_suppliers_live(tenant_id);
      if (mountedRef.current) {
        setSuppliers(data || []);
      }
    } catch (e: any) {
      notify('error', tx(lang, 'Təchizatçılar yüklənmədi: ', 'Ошибка загрузки поставщиков: ', 'Suppliers failed to load: ') + String(e?.message || e));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleAddSupplier = async () => {
    if (!name.trim()) {
      notify('error', tx(lang, 'Təchizatçı adı daxil edilməlidir', 'Введите имя поставщика', 'Supplier name is required'));
      return;
    }
    try {
      await add_supplier_live(tenant_id, {
        name: name.trim(),
        contact_person: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      notify('success', tx(lang, 'Təchizatçı uğurla əlavə edildi', 'Поставщик успешно добавлен', 'Supplier successfully added'));
      setShowAddModal(false);
      resetForm();
      void loadSuppliers();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta baş verdi: ', 'Ошибка: ', 'Error: ') + String(e?.message || e));
    }
  };

  const handleUpdateSupplier = async () => {
    if (!showEditModal) return;
    if (!name.trim()) {
      notify('error', tx(lang, 'Təchizatçı adı daxil edilməlidir', 'Введите имя поставщика', 'Supplier name is required'));
      return;
    }
    try {
      await update_supplier_live(tenant_id, showEditModal.id, {
        name: name.trim(),
        contact_person: contactPerson.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      notify('success', tx(lang, 'Təchizatçı uğurla yeniləndi', 'Поставщик успешно обновлен', 'Supplier successfully updated'));
      setShowEditModal(null);
      resetForm();
      void loadSuppliers();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta baş verdi: ', 'Ошибка: ', 'Error: ') + String(e?.message || e));
    }
  };

  const handleDeleteSupplier = async () => {
    if (!showDeleteConfirm) return;
    try {
      await delete_supplier_live(tenant_id, showDeleteConfirm.id);
      notify('success', tx(lang, 'Təchizatçı silindi', 'Поставщик удален', 'Supplier deleted'));
      setShowDeleteConfirm(null);
      void loadSuppliers();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta baş verdi: ', 'Ошибка: ', 'Error: ') + String(e?.message || e));
    }
  };

  const handlePaySupplier = async () => {
    if (!showPayModal) return;
    const amountNum = parseFloat(payAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      notify('error', tx(lang, 'Düzgün məbləğ daxil edin', 'Введите корректную сумму', 'Enter a valid amount'));
      return;
    }
    try {
      await pay_supplier_live(tenant_id, showPayModal.id, amountNum, paySource, payNote.trim() || undefined);
      notify('success', tx(lang, 'Ödəniş uğurla qeyd olundu', 'Платеж успешно записан', 'Payment successfully recorded'));
      setShowPayModal(null);
      setPayAmount('');
      setPayNote('');
      void loadSuppliers();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta baş verdi: ', 'Ошибка: ', 'Error: ') + String(e?.message || e));
    }
  };

  const resetForm = () => {
    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setAddress('');
    setNotes('');
  };

  const openEditModal = (supplier: Supplier) => {
    setShowEditModal(supplier);
    setName(supplier.name);
    setContactPerson(supplier.contact_person || '');
    setPhone(supplier.phone || '');
    setEmail(supplier.email || '');
    setAddress(supplier.address || '');
    setNotes(supplier.notes || '');
  };

  // Filter suppliers based on search query
  const filteredSuppliers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.contact_person || '').toLowerCase().includes(query) ||
        (s.phone || '').includes(query) ||
        (s.email || '').toLowerCase().includes(query)
    );
  }, [suppliers, searchQuery]);

  // Calculate total outstanding balance
  const totalOutstanding = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + parseFloat(s.balance || '0'), 0);
  }, [suppliers]);

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">{tx(lang, 'Təchizatçılar', 'Поставщики', 'Suppliers')}</h1>
          <p className="text-sm text-slate-400">
            {tx(
              lang,
              'Təchizatçı siyahısı, əlaqə məlumatları və borc qalıqlarının izlənilməsi',
              'Список поставщиков, контактные данные и учет задолженностей',
              'List of suppliers, contact information and accounts payable tracking'
            )}
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="glossy-gold flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-slate-950 transition-all hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <span>{tx(lang, 'Yeni Təchizatçı', 'Новый поставщик', 'New Supplier')}</span>
        </button>
      </div>

      {/* Stats Summary & Search bar */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Outstanding Debt Card */}
        <div className="relative overflow-hidden rounded-2xl border border-rose-500/25 bg-rose-950/10 p-5 backdrop-blur-md shadow-[0_0_15px_rgba(244,63,94,0.05)] md:col-span-1">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-rose-500/10 blur-xl"></div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-200">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                {tx(lang, 'Toplam Borcumuz', 'Общий долг (AP)', 'Total Outstanding')}
              </p>
              <h2 className="mt-1 text-2xl font-black text-rose-200 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]">
                {totalOutstanding.toFixed(2)} AZN
              </h2>
            </div>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center rounded-2xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 backdrop-blur-md md:col-span-2">
          <Search className="mr-3 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder={tx(lang, 'Təchizatçı adı, əlaqəli şəxs, telefon və ya email üzrə axtar...', 'Поиск по имени, контакту, телефону или email...', 'Search by name, contact, phone or email...')}
            className="w-full bg-transparent text-slate-100 placeholder-slate-500 outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Grid List */}
      {loading ? (
        <div className="flex min-h-[250px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/20 p-8">
          <div className="text-sm text-slate-400">{tx(lang, 'Məlumat yüklənir...', 'Загрузка...', 'Loading...')}</div>
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <div className="flex min-h-[250px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/20 p-8 text-center">
          <AlertCircle className="mb-3 h-10 w-10 text-slate-500" />
          <h3 className="text-base font-bold text-slate-300">{tx(lang, 'Təchizatçı tapılmadı', 'Поставщики не найдены', 'No suppliers found')}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {tx(lang, 'Yeni təchizatçı yaratmaq üçün yuxarıdakı düymədən istifadə edin.', 'Используйте кнопку выше для создания поставщика.', 'Use the button above to add a new supplier.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSuppliers.map((supplier) => {
            const balanceNum = parseFloat(supplier.balance || '0');
            const hasDebt = balanceNum > 0;
            const isPrepaid = balanceNum < 0;

            return (
              <div
                key={supplier.id}
                className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-slate-900/30 p-5 backdrop-blur-sm transition-all hover:scale-[1.01] hover:bg-slate-900/50 ${
                  hasDebt
                    ? 'border-rose-500/20 hover:border-rose-500/40 shadow-[0_4px_20px_rgba(244,63,94,0.02)]'
                    : isPrepaid
                    ? 'border-cyan-500/20 hover:border-cyan-500/40 shadow-[0_4px_20px_rgba(6,182,212,0.02)]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Glow effect for debt */}
                {hasDebt && (
                  <div className="absolute top-0 right-0 -mt-2 -mr-2 h-16 w-16 rounded-full bg-rose-500/5 blur-lg"></div>
                )}
                {isPrepaid && (
                  <div className="absolute top-0 right-0 -mt-2 -mr-2 h-16 w-16 rounded-full bg-cyan-500/5 blur-lg"></div>
                )}

                <div className="space-y-4">
                  {/* Name & Notes */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-100 line-clamp-1">{supplier.name}</h3>
                    {supplier.notes && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-2 italic">{supplier.notes}</p>
                    )}
                  </div>

                  {/* Details block */}
                  <div className="space-y-2 border-t border-slate-800/60 pt-3 text-xs text-slate-300">
                    {supplier.contact_person && (
                      <div className="flex items-center gap-2">
                        <User className="h-4.5 w-4.5 shrink-0 text-slate-500" />
                        <span className="truncate">{supplier.contact_person}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4.5 w-4.5 shrink-0 text-slate-500" />
                        <a href={`tel:${supplier.phone}`} className="truncate hover:text-cyan-300 hover:underline">
                          {supplier.phone}
                        </a>
                      </div>
                    )}
                    {supplier.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4.5 w-4.5 shrink-0 text-slate-500" />
                        <a href={`mailto:${supplier.email}`} className="truncate hover:text-cyan-300 hover:underline">
                          {supplier.email}
                        </a>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4.5 w-4.5 shrink-0 mt-0.5 text-slate-500" />
                        <span className="line-clamp-2">{supplier.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Balance & Actions */}
                <div className="mt-5 space-y-3 border-t border-slate-800/80 pt-3">
                  {/* Balance visualization */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{tx(lang, 'Balans', 'Баланс', 'Balance')}:</span>
                    {hasDebt ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-300 border border-rose-500/20">
                        <AlertCircle className="h-4.5 w-4.5" />
                        <span>{balanceNum.toFixed(2)} AZN (Borc)</span>
                      </div>
                    ) : isPrepaid ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-300 border border-cyan-500/20">
                        <CheckCircle className="h-4.5 w-4.5" />
                        <span>{Math.abs(balanceNum).toFixed(2)} AZN (Avans)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/20">
                        <CheckCircle className="h-4.5 w-4.5" />
                        <span>0.00 AZN</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    {/* Pay button */}
                    <button
                      onClick={() => {
                        setPayAmount(hasDebt ? supplier.balance : '');
                        setPaySource('cash');
                        setPayNote('');
                        setShowPayModal(supplier);
                      }}
                      className="glossy-gold flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-slate-950 transition-all hover:scale-[1.02]"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      <span>{tx(lang, 'Ödəniş et', 'Выплатить', 'Record Payment')}</span>
                    </button>

                    {/* Edit button */}
                    <button
                      onClick={() => openEditModal(supplier)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/30 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                      title={tx(lang, 'Düzəliş et', 'Редактировать', 'Edit')}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => setShowDeleteConfirm(supplier)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500 hover:text-white"
                      title={tx(lang, 'Sil', 'Удалить', 'Delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-md p-6 shadow-2xl animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100">{tx(lang, 'Yeni Təchizatçı', 'Новый поставщик', 'New Supplier')}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Təchizatçı Adı', 'Имя поставщика', 'Supplier Name')} *</label>
                <input
                  type="text"
                  placeholder={tx(lang, 'Məs: Lavazza Azərbaycan', 'Напр: Lavazza Россия', 'E.g., Lavazza Azerbaijan')}
                  className="neon-input w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Əlaqədar Şəxs', 'Контактное лицо', 'Contact Person')}</label>
                  <input
                    type="text"
                    placeholder={tx(lang, 'Məs: Elnur bəy', 'Напр: Эльнур', 'E.g., Elnur M.')}
                    className="neon-input w-full"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</label>
                  <input
                    type="text"
                    placeholder="+994 50 123 45 67"
                    className="neon-input w-full"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  placeholder="info@lavazza.az"
                  className="neon-input w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Ünvan', 'Адрес', 'Address')}</label>
                <input
                  type="text"
                  placeholder={tx(lang, 'Bakı şəhəri, S.Vurğun küç. 45', 'Адрес поставщика', 'Supplier physical address')}
                  className="neon-input w-full"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Qeydlər', 'Заметки', 'Notes')}</label>
                <textarea
                  placeholder={tx(lang, 'Əlavə qeydlər, tədarük şərtləri...', 'Дополнительные примечания...', 'Additional terms or conditions...')}
                  className="neon-input w-full min-h-[80px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={handleAddSupplier} className="glossy-gold flex-1 rounded-xl py-2.5 font-semibold text-slate-950 transition-all hover:scale-[1.02]">
                {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
              </button>
              <button onClick={() => setShowAddModal(false)} className="neon-btn flex-1 rounded-xl py-2.5 font-semibold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-md p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100">{tx(lang, 'Təchizatçını Yenilə', 'Редактировать поставщика', 'Edit Supplier')}</h3>
              <button onClick={() => setShowEditModal(null)} className="text-slate-400 hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Təchizatçı Adı', 'Имя поставщика', 'Supplier Name')} *</label>
                <input
                  type="text"
                  className="neon-input w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Əlaqədar Şəxs', 'Контактное лицо', 'Contact Person')}</label>
                  <input
                    type="text"
                    className="neon-input w-full"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</label>
                  <input
                    type="text"
                    className="neon-input w-full"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  className="neon-input w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Ünvan', 'Адрес', 'Address')}</label>
                <input
                  type="text"
                  className="neon-input w-full"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Qeydlər', 'Заметки', 'Notes')}</label>
                <textarea
                  className="neon-input w-full min-h-[80px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={handleUpdateSupplier} className="glossy-gold flex-1 rounded-xl py-2.5 font-semibold text-slate-950 transition-all hover:scale-[1.02]">
                {tx(lang, 'Yenilə', 'Обновить', 'Update')}
              </button>
              <button onClick={() => setShowEditModal(null)} className="neon-btn flex-1 rounded-xl py-2.5 font-semibold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Supplier Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-sm p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100">{tx(lang, 'Ödəniş et', 'Внести оплату', 'Record Payment')}</h3>
              <button onClick={() => setShowPayModal(null)} className="text-slate-400 hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-950/40 p-3 text-center border border-slate-800">
                <p className="text-xs text-slate-400 uppercase tracking-wider">{showPayModal.name}</p>
                <p className="mt-1 text-lg font-bold text-slate-200">
                  {tx(lang, 'Mövcud borc', 'Текущий долг', 'Current Debt')}: {parseFloat(showPayModal.balance || '0').toFixed(2)} AZN
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')} (AZN) *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="neon-input w-full text-center text-lg font-bold text-amber-200"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Hesab', 'Касса/Счет', 'Account/Source')}</label>
                <select
                  className="neon-input w-full"
                  value={paySource}
                  onChange={(e) => setPaySource(e.target.value as any)}
                >
                  <option value="cash">{tx(lang, 'Nağd Kassa', 'Наличные', 'Cash Drawer')}</option>
                  <option value="card">{tx(lang, 'Bank/Kart', 'Банк/Карта', 'Bank Account')}</option>
                  <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400 uppercase tracking-wider">{tx(lang, 'Qeyd / Faktura No', 'Примечание / № чека', 'Note / Invoice №')}</label>
                <input
                  type="text"
                  placeholder={tx(lang, 'Məs: 12-ci partiya ödənişi', 'Оплата партии', 'E.g., Batch payment')}
                  className="neon-input w-full"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={handlePaySupplier} className="glossy-gold flex-1 rounded-xl py-2.5 font-semibold text-slate-950 transition-all hover:scale-[1.02]">
                {tx(lang, 'Ödənişi təsdiqlə', 'Подтвердить платеж', 'Confirm Payment')}
              </button>
              <button onClick={() => setShowPayModal(null)} className="neon-btn flex-1 rounded-xl py-2.5 font-semibold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-sm p-6 shadow-2xl border border-red-500/25">
            <div className="text-center space-y-3">
              <AlertCircle className="mx-auto h-12 w-12 text-red-400 animate-pulse" />
              <h3 className="text-lg font-bold text-slate-100">
                {tx(lang, 'Təchizatçını Sil', 'Удалить поставщика', 'Delete Supplier')}
              </h3>
              <p className="text-xs text-slate-400">
                {tx(
                  lang,
                  `"${showDeleteConfirm.name}" təchizatçısını silmək istədiyinizdən əminsiniz? Bu əməliyyat geri qaytarıla bilməz.`,
                  `Вы уверены, что хотите удалить поставщика "${showDeleteConfirm.name}"? Это действие необратимо.`,
                  `Are you sure you want to delete supplier "${showDeleteConfirm.name}"? This action cannot be undone.`
                )}
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleDeleteSupplier}
                className="rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white hover:bg-red-500 flex-1 transition-all hover:scale-[1.02]"
              >
                {tx(lang, 'Sil', 'Удалить', 'Delete')}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="neon-btn flex-1 rounded-xl py-2.5 font-semibold text-slate-300 text-xs"
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
