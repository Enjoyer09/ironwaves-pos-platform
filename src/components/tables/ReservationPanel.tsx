/**
 * ReservationPanel — Reservation timeline view with drag-to-reschedule.
 * Renders daily reservation timeline, reservation cards, and interaction controls.
 */
import React from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import { formatRestaurantLocalTime, parseRestaurantLocalTimestamp } from '../../lib/time';
import type { ReservationTimeline } from '../../utils/tables/floorUtils';

export interface ReservationPanelProps {
  lang: string;
  hidden: boolean;
  reservationZoom: 15 | 30;
  reservationDate: string;
  reservationTimeline: ReservationTimeline;
  reservations: any[];
  draggingReservationId: string | null;
  onZoomChange: (zoom: 15 | 30) => void;
  onDateChange: (date: string) => void;
  onCreateClick: () => void;
  onStatusChange: (id: string, status: string) => void;
  onSeat: (id: string, tableId: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onResizeStart: (id: string, startY: number, startDuration: number) => void;
}

export default function ReservationPanel(props: ReservationPanelProps) {
  const {
    lang, hidden, reservationZoom, reservationDate, reservationTimeline, reservations,
    draggingReservationId,
    onZoomChange, onDateChange, onCreateClick, onStatusChange, onSeat, onDelete,
    onDragStart, onDragEnd, onResizeStart,
  } = props;

  const timeline = reservationTimeline;

  return (
    <div className={`mb-6 rounded-[28px] border border-white/10 bg-slate-900/35 p-4 ${hidden ? 'hidden' : ''}`}>
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-bold text-slate-100">{tx(lang, 'Günlük rezervasiyalar', 'Брони на день', 'Daily reservations')}</div>
          <div className="mt-1 text-sm text-slate-400">{tx(lang, 'Saat xətti üzrə rezervasiyalar və seat axını', 'Брони по временной линии и сценарий посадки', 'Reservations timeline and seating flow')}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/50 p-1 text-xs text-slate-200">
            <button type="button" onClick={() => onZoomChange(15)} className={`rounded-full px-3 py-1 font-semibold ${reservationZoom === 15 ? 'bg-cyan-300 text-slate-950' : ''}`}>15m</button>
            <button type="button" onClick={() => onZoomChange(30)} className={`rounded-full px-3 py-1 font-semibold ${reservationZoom === 30 ? 'bg-cyan-300 text-slate-950' : ''}`}>30m</button>
          </div>
          <input className="neon-input" type="date" value={reservationDate} onChange={(e) => onDateChange(e.target.value)} />
          <button type="button" onClick={onCreateClick} className="glossy-gold rounded-xl px-4 py-2 font-semibold">{tx(lang, 'Rezervasiya yarat', 'Создать бронь', 'Create reservation')}</button>
        </div>
      </div>

      {/* Timeline */}
      {reservations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700/50 px-6 py-12 text-center">
          <div className="text-sm text-slate-400">{tx(lang, 'Bu tarixdə rezervasiya yoxdur', 'На эту дату бронь отсутствует', 'No reservations for this date')}</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-700/60 bg-slate-950/30">
          <div className="relative" style={{ width: `${timeline.totalWidth}px`, height: `${timeline.totalHeight + 60}px` }}>
            {/* Hour markers */}
            {Array.from({ length: timeline.hourEnd - timeline.hourStart }, (_, i) => (
              <div key={`hour_${i}`} className="absolute left-0 right-0 border-t border-slate-800/40 text-[10px] text-slate-500 pl-2" style={{ top: `${i * 60 * timeline.minuteHeight + 40}px` }}>
                {String(timeline.hourStart + i).padStart(2, '0')}:00
              </div>
            ))}
            {/* Lane headers */}
            <div className="sticky top-0 z-10 flex border-b border-slate-700/60 bg-slate-950/80 backdrop-blur">
              {timeline.lanes.map((lane, idx) => (
                <div key={`lane_${idx}`} className="shrink-0 border-r border-slate-800/40 px-2 py-2 text-center text-[11px] font-semibold text-slate-300" style={{ width: `${timeline.laneWidth}px` }}>
                  {lane.label}
                </div>
              ))}
            </div>
            {/* Reservation entries */}
            {timeline.entries.map((entry) => {
              const r = entry.reservation;
              const statusColor = String(r.status || '').toUpperCase() === 'SEATED' ? 'border-emerald-300/40 bg-emerald-500/15' : String(r.status || '').toUpperCase() === 'LATE' ? 'border-rose-300/40 bg-rose-500/15' : String(r.status || '').toUpperCase() === 'WAITLIST' ? 'border-violet-300/40 bg-violet-500/15' : 'border-amber-300/40 bg-amber-500/15';
              const isDragging = draggingReservationId === r.id;
              return (
                <div
                  key={r.id}
                  className={`absolute rounded-xl border p-2 text-xs cursor-grab transition-shadow ${statusColor} ${isDragging ? 'ring-2 ring-cyan-300 shadow-lg z-20' : ''}`}
                  style={{ left: `${entry.lane * timeline.laneWidth + 4}px`, top: `${entry.top + 40}px`, width: `${timeline.laneWidth - 8}px`, height: `${entry.height}px` }}
                  draggable
                  onDragStart={() => onDragStart(r.id)}
                  onDragEnd={onDragEnd}
                >
                  <div className="font-bold text-slate-100 truncate">{r.guest?.full_name || '-'}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{entry.duration}m · {r.party_size} {tx(lang, 'nəfər', 'гостей', 'guests')}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {['BOOKED', 'LATE'].includes(String(r.status || '').toUpperCase()) && (
                      <button type="button" className="rounded border border-emerald-300/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200" onClick={() => onSeat(r.id, r.assigned_table_id || '')}>{tx(lang, 'Oturt', 'Посадить', 'Seat')}</button>
                    )}
                    {String(r.status || '').toUpperCase() === 'BOOKED' && (
                      <button type="button" className="rounded border border-rose-300/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-200" onClick={() => onDelete(r.id)}>{tx(lang, 'Ləğv', 'Отмена', 'Cancel')}</button>
                    )}
                    {(String(r.status || '').toUpperCase() === 'BOOKED' || String(r.status || '').toUpperCase() === 'LATE') && (
                      <span className="rounded border border-slate-600/50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">{tx(lang, 'Sürüşdürüb vaxtı dəyiş', 'Перетащите', 'Drag to reschedule')}</span>
                    )}
                  </div>
                  {/* Resize handle */}
                  {['BOOKED', 'LATE', 'WAITLIST'].includes(String(r.status || '').toUpperCase()) && (
                    <button
                      type="button"
                      onMouseDown={(e) => onResizeStart(r.id, e.clientY, entry.duration)}
                      onTouchStart={(e) => { const t = e.touches[0]; if (t) onResizeStart(r.id, t.clientY, entry.duration); }}
                      className="absolute inset-x-4 bottom-1 flex cursor-ns-resize items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-100"
                    >
                      {tx(lang, 'Sürüşdür: müddəti dəyiş', 'Тяните: менять длительность', 'Drag to resize duration')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
