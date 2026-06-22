import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { apiRequest, isBackendEnabled } from './client';

export type Supplier = {
  id: string;
  tenant_id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  balance: string; // Stored as Decimal string
  created_at: string;
};

// Local storage simulation database helpers
const getSuppliersLocal = (tenantId: string): Supplier[] => {
  const tenantRows = getDB<Supplier>(`${tenantId}_suppliers`) || [];
  if (tenantRows.length > 0) return tenantRows;
  // Fallback to global db if not scoped
  const all = getDB<Supplier>('suppliers') || [];
  return all.filter((s) => String(s.tenant_id) === tenantId);
};

const saveSuppliersLocal = (tenantId: string, rows: Supplier[]) => {
  const shared = (getDB<Supplier>('suppliers') || []).filter((row) => String(row.tenant_id || '') !== tenantId);
  const next = [...shared, ...rows];
  setDB('suppliers', next);
  setDB(`${tenantId}_suppliers`, rows);
};

// Exported live functions
export async function get_suppliers_live(tenant_id: string): Promise<Supplier[]> {
  if (!isBackendEnabled()) {
    return Promise.resolve(getSuppliersLocal(tenant_id));
  }
  return apiRequest<Supplier[]>('/api/v1/ops/suppliers', { method: 'GET' });
}

export async function add_supplier_live(tenant_id: string, payload: {
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}): Promise<Supplier> {
  if (!isBackendEnabled()) {
    const nextList = getSuppliersLocal(tenant_id);
    const newSupplier: Supplier = {
      id: uuidv4(),
      tenant_id,
      name: payload.name,
      contact_person: payload.contact_person,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      notes: payload.notes,
      balance: '0.00',
      created_at: new Date().toISOString(),
    };
    nextList.push(newSupplier);
    saveSuppliersLocal(tenant_id, nextList);
    logEvent('Admin', 'SUPPLIER_CREATED', { name: payload.name });
    return Promise.resolve(newSupplier);
  }
  return apiRequest<Supplier>('/api/v1/ops/suppliers', {
    method: 'POST',
    body: payload,
  });
}

export async function update_supplier_live(tenant_id: string, supplier_id: string, payload: {
  name?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}): Promise<Supplier> {
  if (!isBackendEnabled()) {
    const list = getSuppliersLocal(tenant_id);
    const index = list.findIndex((x) => x.id === supplier_id);
    if (index === -1) throw new Error('Supplier not found');
    const updated = { ...list[index], ...payload };
    list[index] = updated;
    saveSuppliersLocal(tenant_id, list);
    logEvent('Admin', 'SUPPLIER_UPDATED', { supplier_id });
    return Promise.resolve(updated);
  }
  return apiRequest<Supplier>(`/api/v1/ops/suppliers/${encodeURIComponent(supplier_id)}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function delete_supplier_live(tenant_id: string, supplier_id: string): Promise<{ detail: string }> {
  if (!isBackendEnabled()) {
    const list = getSuppliersLocal(tenant_id);
    const nextList = list.filter((x) => x.id !== supplier_id);
    saveSuppliersLocal(tenant_id, nextList);
    logEvent('Admin', 'SUPPLIER_DELETED', { supplier_id });
    return Promise.resolve({ detail: 'Supplier deleted successfully' });
  }
  return apiRequest<{ detail: string }>(`/api/v1/ops/suppliers/${encodeURIComponent(supplier_id)}`, {
    method: 'DELETE',
  });
}

export async function pay_supplier_live(
  tenant_id: string,
  supplier_id: string,
  amount: number,
  payment_source: string,
  note?: string,
): Promise<{ id: string; name: string; balance: string }> {
  if (!isBackendEnabled()) {
    const list = getSuppliersLocal(tenant_id);
    const index = list.findIndex((x) => x.id === supplier_id);
    if (index === -1) throw new Error('Supplier not found');
    const supplier = list[index];
    const newBal = (parseFloat(supplier.balance) - amount).toFixed(2);
    supplier.balance = newBal;
    saveSuppliersLocal(tenant_id, list);
    logEvent('Admin', 'SUPPLIER_PAYMENT', { supplier_id, amount, payment_source, note });
    
    // Simulate updating finance accounts balance in local storage if necessary
    // (Local mock storage holds finance logs)
    const financeLogs = getDB<any>('finance_logs') || [];
    financeLogs.push({
      id: uuidv4(),
      tenant_id,
      transaction_type: 'supplier_payment',
      amount: amount.toFixed(2),
      source_code: payment_source,
      destination_code: 'payable',
      category: 'Təchizatçı Ödənişi',
      counterparty: supplier.name,
      note: note || `${supplier.name} öhdəlik ödənişi`,
      created_by: 'Admin',
      created_at: new Date().toISOString(),
    });
    setDB('finance_logs', financeLogs);

    return Promise.resolve({ id: supplier.id, name: supplier.name, balance: newBal });
  }
  return apiRequest<{ id: string; name: string; balance: string }>(
    `/api/v1/ops/suppliers/${encodeURIComponent(supplier_id)}/pay`,
    {
      method: 'POST',
      body: {
        amount,
        payment_source,
        note,
      },
    },
  );
}

// Helper to update local supplier balance during simulated restock (when backend is disabled)
export function adjust_local_supplier_balance_on_restock(tenant_id: string, supplier_id: string, total_price: number) {
  if (isBackendEnabled()) return;
  const list = getSuppliersLocal(tenant_id);
  const index = list.findIndex((x) => x.id === supplier_id);
  if (index !== -1) {
    const supplier = list[index];
    supplier.balance = (parseFloat(supplier.balance) + total_price).toFixed(2);
    saveSuppliersLocal(tenant_id, list);
  }
}
