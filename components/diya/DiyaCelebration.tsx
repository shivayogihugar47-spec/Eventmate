"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Diya } from "./Diya";

let confetti: ((opts: Record<string, unknown>) => void) | null = null;
if (typeof window !== "undefined") {
  import("canvas-confetti").then((m) => { confetti = m.default as typeof confetti; });
}

export function PlanLockedCelebration({ active }: { active: boolean }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!active || firedRef.current) return;
    firedRef.current = true;
    const end = Date.now() + 3500;
    const burst = () => {
      if (Date.now() > end) return;
      confetti?.({ particleCount: 12, spread: 90, startVelocity: 45, origin: { x: Math.random(), y: 0.4 } });
      confetti?.({ particleCount: 8, spread: 60, angle: 60, origin: { x: 0, y: 0.6 } });
      confetti?.({ particleCount: 8, spread: 60, angle: 120, origin: { x: 1, y: 0.6 } });
      requestAnimationFrame(burst);
    };
    burst();
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <>
          {/* Diya bounces across screen */}
          <motion.div
            className="fixed top-1/3 z-[60] pointer-events-none"
            initial={{ x: "-15vw" }}
            animate={{ x: "110vw" }}
            transition={{ duration: 2.2, ease: "easeInOut" }}
          >
            <motion.div animate={{ y: [0, -30, 0] }} transition={{ duration: 0.4, repeat: 6 }}>
              <Diya size={100} moodOverride="celebrate" />
            </motion.div>
          </motion.div>

          {/* Banner */}
          <motion.div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] pointer-events-none"
            initial={{ opacity: 0, scale: 0.7, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 280, damping: 22, delay: 0.3 }}
          >
            <div className="bg-white border-2 border-[#6366F1] rounded-3xl px-10 py-6 shadow-2xl text-center">
              <p className="text-3xl font-extrabold text-[#111827] font-display">Your plan is locked</p>
              <p className="text-sm text-[#9CA3AF] mt-1">Time to make some memories!</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
