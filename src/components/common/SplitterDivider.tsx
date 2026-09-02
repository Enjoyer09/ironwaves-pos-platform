import React, { memo } from 'react';
import { GripVertical } from 'lucide-react';

type SplitterDividerProps = {
  isDragging?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
  title?: string;
};

export const SplitterDivider = memo(function SplitterDivider({
  isDragging = false,
  onPointerDown,
  onDoubleClick,
  className = '',
  title = 'Dartaraq ölçünü dəyişin (2 dəfə kliklə sıfırla)',
}: SplitterDividerProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      title={title}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`group relative hidden md:flex items-center justify-center w-3 -mx-1.5 cursor-col-resize select-none touch-none z-30 transition-colors ${
        isDragging ? 'bg-amber-400/20' : 'hover:bg-amber-400/10'
      } ${className}`}
    >
      {/* Invisible wider hit area for easy finger/mouse grab */}
      <div className="absolute inset-y-0 -left-2 -right-2 z-10" />

      {/* Visual divider line & center grip handle */}
      <div
        className={`flex h-12 w-3.5 items-center justify-center rounded-full border transition-all duration-150 ${
          isDragging
            ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30 scale-110'
            : 'border-slate-700/80 bg-slate-800/90 text-slate-400 group-hover:border-amber-400/70 group-hover:text-amber-300 group-hover:bg-slate-700/90'
        }`}
      >
        <GripVertical size={11} className="shrink-0" />
      </div>
    </div>
  );
});

export default SplitterDivider;
