// Customer App theme utility — provides consistent light/dark class names

export const ct = (isLight: boolean) => ({
  // Cards / sections
  card: isLight
    ? 'border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-sm'
    : 'border-white/10 bg-white/6 backdrop-blur-xl',
  // Primary text
  text: isLight ? 'text-slate-900' : 'text-white',
  // Secondary text
  textMuted: isLight ? 'text-slate-500' : 'text-white/60',
  // Tertiary text
  textDim: isLight ? 'text-slate-400' : 'text-white/40',
  // Sub-headings
  textSub: isLight ? 'text-slate-700' : 'text-slate-200',
  // Input fields
  input: isLight
    ? 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400'
    : 'border-white/10 bg-white/5 text-white placeholder:text-white/40',
  // Pill / badge background
  pill: isLight
    ? 'border-slate-200 bg-slate-100 text-slate-700'
    : 'border-white/10 bg-white/6 text-slate-200',
  // Notifications / alerts
  notif: isLight
    ? 'border-slate-200 bg-slate-50'
    : 'border-white/5 bg-white/4',
  // Dividers
  divider: isLight ? 'border-slate-200' : 'border-white/10',
  // Overlay/modal backdrop
  overlay: isLight ? 'bg-black/30' : 'bg-black/75',
  // Sheet / bottom modal
  sheet: isLight
    ? 'bg-white border-slate-200 text-slate-900'
    : 'bg-[#1a1816] border-white/10 text-white',
});
