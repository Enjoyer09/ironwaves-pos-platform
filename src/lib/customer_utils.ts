import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { tx } from '../i18n';

export type CustomerTab = 'home' | 'order' | 'offers' | 'barista' | 'falci' | 'profile';

export const BARISTA_QUICK_PROMPTS = [
  'Mənə soyuq içki tövsiyə et',
  'Bu gün hansı reward mənə sərf edir?',
  'Dessert ilə nə uyğun gedər?',
];

export function formatCardId(id: string) {
  const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!clean) return '•••• •••• •••• ••••';
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    chunks.push(clean.slice(i, i + 4));
  }
  return chunks.join(' ');
}

export function getProductImage(name: string, currentUrl?: string): string {
  if (currentUrl && currentUrl.trim().startsWith('http')) return currentUrl;
  const n = name.toLowerCase();
  if (n.includes('espresso') || n.includes('double shot')) {
    return 'https://images.unsplash.com/photo-1510705315444-837e27e8ecea?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('cappuccino') || n.includes('latte') || n.includes('flat white') || n.includes('macchiato') || n.includes('mocha') || n.includes('qəhvə') || n.includes('coffee')) {
    return 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('iced') || n.includes('cold') || n.includes('soyuq') || n.includes('frappe') || n.includes('shake')) {
    return 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('tea') || n.includes('çay') || n.includes('cay') || n.includes('matcha') || n.includes('herbal')) {
    return 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('cheesecake') || n.includes('cake') || n.includes('şirniyyat') || n.includes('sirniyyat') || n.includes('desert') || n.includes('cookie') || n.includes('croissant') || n.includes('kruassan') || n.includes('panini') || n.includes('waffle')) {
    return 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=400&q=80';
  }
  return 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80';
}

export function getGreeting(safeLang: string): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return tx(safeLang, 'Sabahınız xeyir', 'Доброе утро', 'Good morning');
  } else if (hour >= 12 && hour < 18) {
    return tx(safeLang, 'Günortanız xeyir', 'Добрый день', 'Good afternoon');
  } else if (hour >= 18 && hour < 24) {
    return tx(safeLang, 'Axşamınız xeyir', 'Добрый вечер', 'Good evening');
  } else {
    return tx(safeLang, 'Gecəniz xeyir', 'Доброй ночи', 'Good night');
  }
}

export function getFirstName(customer: { name?: string }): string {
  if (!customer?.name) return '';
  const namePart = String(customer.name).trim().split(' ')[0];
  return namePart ? `, ${namePart}` : '';
}

export function getWeatherInfo(safeLang: string, simulatedTemp: number) {
  const isHot = simulatedTemp > 20;
  const hour = new Date().getHours();
  const isMorning = hour >= 5 && hour < 12;
  const isAfternoon = hour >= 12 && hour < 18;

  interface Drink { name: string; icon: string; tag: string }
  interface Combo { name: string; desc: string; icon: string }

  let weatherTitle = '';
  let weatherDesc = '';
  let recommendedDrinks: Drink[] = [];
  let comboTitle = '';
  let comboItems: Combo[] = [];

  if (isHot) {
    weatherTitle = tx(safeLang, 'İsti hava təklifləri ☀️', 'Предложения для теплой погоды ☀️', 'Warm Weather Picks ☀️');
    weatherDesc = tx(safeLang, 'Hava istidir! Sərinləmək üçün ideal seçimlər:', 'На улице тепло! Отличные освежающие напитки:', 'It\'s warm outside! Refreshing options to cool down:');
    recommendedDrinks = [
      { name: tx(safeLang, 'Iced Latte', 'Айс Латте', 'Iced Latte'), icon: '🥤', tag: 'Popular' },
      { name: tx(safeLang, 'Soyuq Dəmləmə', 'Колд Брю', 'Cold Brew'), icon: '🥃', tag: 'Smooth' },
      { name: tx(safeLang, 'Şaftalı Iced Tea', 'Персиковый Айс Ти', 'Peach Iced Tea'), icon: '🍹', tag: 'Fruity' },
      { name: tx(safeLang, 'Espresso Tonic', 'Эспрессо Тоник', 'Espresso Tonic'), icon: '🥂', tag: 'Zesty' }
    ];
  } else {
    weatherTitle = tx(safeLang, 'Sərin hava təklifləri 🍂', 'Предложения для прохладной погоды 🍂', 'Cozy Weather Picks 🍂');
    weatherDesc = tx(safeLang, 'Sərin və ya yağışlı hava üçün içimizi isidəcək dadlar:', 'Для прохладной погоды согревающие напитки:', 'Warm up with these cozy choices:');
    recommendedDrinks = [
      { name: tx(safeLang, 'İsti Şokolad', 'Горячий Шоколад', 'Hot Chocolate'), icon: '☕', tag: 'Rich' },
      { name: tx(safeLang, 'Cappuccino', 'Капучисимо', 'Cappuccino'), icon: '🥛', tag: 'Classic' },
      { name: tx(safeLang, 'Matcha Latte', 'Матча Латте', 'Matcha Latte'), icon: '🍵', tag: 'Healthy' },
      { name: tx(safeLang, 'Raf Qəhvə', 'Раф Кофе', 'Raf Coffee'), icon: '🍮', tag: 'Sweet' }
    ];
  }

  if (isMorning) {
    comboTitle = tx(safeLang, 'Səhər Kombosu 🌅', 'Утреннее Комбо 🌅', 'Morning Combo 🌅');
    comboItems = [
      { name: tx(safeLang, 'Kruassan + Double Espresso', 'Круассан + Дабл Эспрессо', 'Croissant + Double Espresso'), desc: tx(safeLang, 'Gününüzü enerjili başlayın', 'Начните день энергично', 'Kickstart your day with energy'), icon: '🥐☕' }
    ];
  } else if (isAfternoon) {
    comboTitle = tx(safeLang, 'Günorta Şirniyyat Kombosu ☀️', 'Дневное Комбо ☀️', 'Afternoon Combo ☀️');
    comboItems = [
      { name: tx(safeLang, 'Kruassan / Kukis + Flat White', 'Круассан / Печенье + Флэт Уайт', 'Croissant / Cookie + Flat White'), desc: tx(safeLang, 'Günün qalan hissəsi üçün xoş fasilə', 'Приятный перерыв на остаток дня', 'A sweet pause for the rest of the day'), icon: '🍪☕' }
    ];
  } else {
    comboTitle = tx(safeLang, 'Axşam Rahatlığı Kombosu 🌙', 'Вечернее Комбо 🌙', 'Evening Cozy Combo 🌙');
    comboItems = [
      { name: tx(safeLang, 'Çizkeyk + Bitki Çayı', 'Чизкейк + Травяной Чай', 'Cheesecake + Herbal Tea'), desc: tx(safeLang, 'Günün yorğunluğunu çıxarın', 'Снимите усталость прошедшего дня', 'Wind down and relax'), icon: '🍰🍵' }
    ];
  }

  return { weatherTitle, weatherDesc, recommendedDrinks, comboTitle, comboItems };
}

let audioCtxRef: AudioContext | null = null;

export function initAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtxRef) {
    const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtxClass) {
      audioCtxRef = new AudioCtxClass();
    }
  }
  if (audioCtxRef && audioCtxRef.state === 'suspended') {
    void audioCtxRef.resume();
  }
  return audioCtxRef;
}

export function playTickSound() {
  const audioCtx = initAudioCtx();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  } catch (err) {
    console.warn('Web Audio tick failed', err);
  }
}

export function playShimmerSound() {
  const audioCtx = initAudioCtx();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const playNote = (freq: number, delay: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0.05, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
      osc.start(now + delay);
      osc.stop(now + delay + duration);
    };
    playNote(523.25, 0, 0.15);
    playNote(659.25, 0.08, 0.15);
    playNote(783.99, 0.16, 0.25);
  } catch (err) {
    console.warn('Web Audio shimmer failed', err);
  }
}

export async function nativeHapticImpact(style: ImpactStyle = ImpactStyle.Light) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.impact({ style });
    } catch {}
  }
}

export async function nativeHapticNotification(type: NotificationType = NotificationType.Success) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.notification({ type });
    } catch {}
  }
}

/**
 * Systematically fires haptic feedback for user interactions.
 * - Light: button taps, tab switches, toggles
 * - Medium: cards, sheets opening, important actions
 * - Heavy: destructive actions, confirmations
 * - Success: completed operations
 */
export const Haptic = {
  light: () => nativeHapticImpact(ImpactStyle.Light),
  medium: () => nativeHapticImpact(ImpactStyle.Medium),
  heavy: () => nativeHapticImpact(ImpactStyle.Heavy),
  success: () => nativeHapticNotification(NotificationType.Success),
  error: () => nativeHapticNotification(NotificationType.Error),
} as const;
