import { useEffect, useRef } from 'react';
import useStore from '../../store.js';

/**
 * GameLog — scrollable sidebar showing the last N game events.
 *
 * Each log entry is { time: number, message: string }.
 * Newest messages appear at the bottom; the panel auto-scrolls when new
 * messages arrive.
 */
export default function GameLog() {
  const log = useStore(s => s.gameState?.log ?? []);
  const bottomRef = useRef(null);

  // Auto-scroll to the bottom whenever the log grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 flex-shrink-0">
        Game Log
      </h2>

      <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
        {log.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No events yet.</p>
        ) : (
          log.map((entry, i) => {
            // Highlight the newest message; fade older ones progressively.
            const isNewest = i === log.length - 1;
            const isRecent = i >= log.length - 3;
            const textColor = isNewest
              ? 'text-slate-100'
              : isRecent
              ? 'text-slate-300'
              : 'text-slate-500';

            return (
              <p key={`${entry.time}-${i}`} className={`text-xs leading-snug ${textColor}`}>
                {entry.message}
              </p>
            );
          })
        )}
        {/* Invisible anchor — scrolled into view on new messages */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
