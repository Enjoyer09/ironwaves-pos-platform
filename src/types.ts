export type Role = 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  pin: string;
  role: Role;
}

export interface MenuItem {
  id: string;
  name: Record<'az' | 'ru', string>;
  category: 'coffee' | 'tea' | 'food' | 'dessert';
  price: number;
  image?: string;
}

export interface CartItem extends MenuItem {
  cartId: string;
  quantity: number;
  discount: number; // percentage
}

export interface Order {
  id: string;
  items: CartItem[];
  total: number;
  status: 'new' | 'preparing' | 'done';
  createdAt: number;
  isSynced: boolean;
  paymentMethod: 'cash' | 'card' | 'split';
}

export interface SaleHistory {
  id: string;
  orderId: string;
  total: number;
  date: number;
}