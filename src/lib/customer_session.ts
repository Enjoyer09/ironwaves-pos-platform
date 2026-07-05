import { readScopedStorage, removeScopedStorage, writeScopedStorage } from "./storage_keys";
import { Capacitor, registerPlugin } from "@capacitor/core";

const CUSTOMER_CARD_ID_KEY = "customer_card_id";
const CUSTOMER_TOKEN_KEY = "customer_token";
const CUSTOMER_PUSH_TOKEN_KEY = "customer_push_token";

export type CustomerSessionSnapshot = {
  cardId: string;
  token: string;
};

type NativeCustomerSessionPlugin = {
  get(options: { key: string }): Promise<{ value?: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

const nativeCustomerSession = registerPlugin<NativeCustomerSessionPlugin>("CustomerSession");

function readValue(key: string): string {
  if (Capacitor.isNativePlatform()) return "";
  return String(readScopedStorage(key) || "").trim();
}

async function readNativeValue(key: string): Promise<string> {
  try {
    const res = await nativeCustomerSession.get({ key });
    return String(res?.value || "").trim();
  } catch {
    return "";
  }
}

async function writeNativeValue(key: string, value: string): Promise<void> {
  try {
    await nativeCustomerSession.set({ key, value });
  } catch {
    // ignore native storage write failures and let web fallback remain
  }
}

async function removeNativeValue(key: string): Promise<void> {
  try {
    await nativeCustomerSession.remove({ key });
  } catch {
    // ignore native storage removal failures
  }
}

export function readCustomerSession(): CustomerSessionSnapshot {
  return {
    cardId: readValue(CUSTOMER_CARD_ID_KEY),
    token: readValue(CUSTOMER_TOKEN_KEY),
  };
}

export async function readCustomerSessionAsync(): Promise<CustomerSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) return readCustomerSession();
  const [cardId, token] = await Promise.all([
    readNativeValue(CUSTOMER_CARD_ID_KEY),
    readNativeValue(CUSTOMER_TOKEN_KEY),
  ]);
  return { cardId, token };
}

export function writeCustomerSession(cardId: string, token: string): void {
  const nextCardId = String(cardId || "").trim();
  const nextToken = String(token || "").trim();
  if (Capacitor.isNativePlatform()) {
    void writeNativeValue(CUSTOMER_CARD_ID_KEY, nextCardId);
    void writeNativeValue(CUSTOMER_TOKEN_KEY, nextToken);
    return;
  }
  writeScopedStorage(CUSTOMER_CARD_ID_KEY, nextCardId);
  writeScopedStorage(CUSTOMER_TOKEN_KEY, nextToken);
}

export function clearCustomerSession(): void {
  if (Capacitor.isNativePlatform()) {
    void removeNativeValue(CUSTOMER_CARD_ID_KEY);
    void removeNativeValue(CUSTOMER_TOKEN_KEY);
    return;
  }
  removeScopedStorage(CUSTOMER_CARD_ID_KEY);
  removeScopedStorage(CUSTOMER_TOKEN_KEY);
}

export function readCustomerPushToken(): string {
  return readValue(CUSTOMER_PUSH_TOKEN_KEY);
}

export async function readCustomerPushTokenAsync(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return readCustomerPushToken();
  return readNativeValue(CUSTOMER_PUSH_TOKEN_KEY);
}

export function writeCustomerPushToken(pushToken: string): void {
  const nextPushToken = String(pushToken || "").trim();
  if (Capacitor.isNativePlatform()) {
    void writeNativeValue(CUSTOMER_PUSH_TOKEN_KEY, nextPushToken);
    return;
  }
  writeScopedStorage(CUSTOMER_PUSH_TOKEN_KEY, nextPushToken);
}

export function clearCustomerPushToken(): void {
  if (Capacitor.isNativePlatform()) {
    void removeNativeValue(CUSTOMER_PUSH_TOKEN_KEY);
    return;
  }
  removeScopedStorage(CUSTOMER_PUSH_TOKEN_KEY);
}
