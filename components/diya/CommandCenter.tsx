"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, RotateCcw, PartyPopper } from "lucide-react";
import { Diya } from "./Diya";
import { DiyaJourneyStepper } from "./DiyaJourneyStepper";
import { useDiya } from "@/lib/diyaStore";
import type { EventPlan } from "@/app/api/chat/route";
import type { EventCostume } from "./Diya";

// Event-day command center: Diya sits beside the Now / Next card as the announcer.
export function CommandCenter({ plan, onBack }: { plan: EventPlan; onBack: () => void }) {
  const items = useMemo(() => plan.timeline ?? [], [plan.timeline]);
  const [idx, setIdx] = useState(0);
  const [delayed, setDelayed] = useState(false);
  const { say } = useDiya();

  const now = items[idx];
  const next = items[idx + 1];
  const costume = (plan.eventType?.toLowerCase() as EventCostume) ?? "none";

  const mood = delayed ? "worried" : "celebrate";

  useEffect(() => {
    if (!now) return;
    if (delayed) {
      say(`${now.task} is delayed — rescheduling…`, "worried", 2600);
    } else {
      say(
        next ? `Next up: ${next.task} at ${next.time}` : "That's the last item — nearly there!",
        "celebrate",
        3200
      );
    }
  }, [now, next, delayed, say]);

  const complete = () => {
    say(`${now?.task ?? "Task"} — done!`, "celebrate", 2000);
    setDelayed(false);
    setIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
  };

  return (
    <div className="min-h-screen bg-[#F4F6F8] flex flex-col">
      <header className="bg-white border-b border-[#E5E7EB] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PartyPopper size={16} className="text-[#6366F1]" />
          <span className="font-extrabold text-[#111827] font-display">Event Day</span>
          <span className="text-[10px] bg-[#D1FAE5] text-[#065F46] font-bold px-2 py-0.5 rounded-full">LIVE</span>
        </div>
        <button onClick={onBack}
          className="flex items-center gap-1 text-xs font-bold text-[#9CA3AF] hover:text-[#374151] border border-[#E5E7EB] rounded-xl px-3 py-2">
          <RotateCcw size={11} /> Plan
        </button>
      </header>

      <div className="max-w-2xl w-full mx-auto px-5 py-6 flex-1">
        <DiyaJourneyStepper current="RUN" />

        <div className="mt-10 flex items-start gap-4">
          {/* The announcer */}
          <div className="flex-shrink-0">
            <Diya size={120} costume={costume} moodOverride={mood} />
          </div>

          {/* Now / Next card */}
          <div className="flex-1 min-w-0 space-y-3">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6366F1]">Now</p>
              {now ? (
                <>
                  <p className="text-base font-extrabold text-[#111827] mt-1">{now.task}</p>
                  <p className="text-xs text-[#9CA3AF] mt-0.5 flex items-center gap-1">
                    <Clock size={10} /> {now.time} · {now.owner}
                  </p>
                </>
              ) : (
                <p className="text-sm text-[#9CA3AF] mt-1">All wrapped up — great work!</p>
              )}
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Next</p>
              <p className="text-sm font-bold text-[#374151] mt-1">
                {next ? `${next.task} · ${next.time}` : "Nothing left on the schedule"}
              </p>
            </div>

            {now && (
              <div className="flex gap-2">
                <button onClick={complete}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-xs font-bold bg-[#10B981] hover:bg-[#059669] transition-colors">
                  <Check size={13} /> Mark done
                </button>
                <button onClick={() => setDelayed(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border border-[#FCA5A5] text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                  Delay +10 min
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Announcer status strip */}
        <AnimatePresence mode="wait">
          <motion.div
            key={mood}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 bg-white border border-[#E5E7EB] rounded-2xl p-4"
          >
            <p className="text-xs font-semibold text-[#374151]">
              {delayed
                ? "⚠️ Diya is worried — a task slipped. Tap “Approve fix” in the alert, or mark it done."
                : "🎉 Diya is celebrating the run of the show."}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
