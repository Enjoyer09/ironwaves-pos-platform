import { apiRequest } from './client';

export type DeliveryMenuMapping = {
  id: string;
  tenant_id: string;
  provider: 'bolt' | 'wolt';
  external_item_id: string;
  external_item_name?: string | null;
  menu_item_id: string;
  menu_item_name?: string | null;
  menu_item_price?: number | null;
};

export async function getDeliveryMenuMappings(): Promise<DeliveryMenuMapping[]> {
  return apiRequest<DeliveryMenuMapping[]>('/api/v1/integrations/menu-mappings');
}

export async function createDeliveryMenuMapping(payload: {
  provider: 'bolt' | 'wolt';
  external_item_id: string;
  external_item_name?: string;
  menu_item_id: string;
}): Promise<DeliveryMenuMapping> {
  return apiRequest<DeliveryMenuMapping>('/api/v1/integrations/menu-mappings', {
    method: 'POST',
    body: payload,
  });
}

export async function updateDeliveryMenuMapping(
  id: string,
  payload: {
    external_item_id?: string;
    external_item_name?: string;
    menu_item_id?: string;
  }
): Promise<DeliveryMenuMapping> {
  return apiRequest<DeliveryMenuMapping>(`/api/v1/integrations/menu-mappings/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function deleteDeliveryMenuMapping(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/v1/integrations/menu-mappings/${id}`, {
    method: 'DELETE',
  });
}
