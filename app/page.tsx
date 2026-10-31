"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import {
  Sparkles, Calendar, Users, MapPin, IndianRupee, Clock,
  CheckCircle2, Camera, Music, Utensils, Flower2, Car,
  Building2, Gift, Heart, PartyPopper, Mic, Package, Lightbulb,
  Wand2, Gem, Cake, Trees, ArrowRight, RotateCcw, Check, ChevronLeft, ChevronRight,
  IndianRupee as Rupee, type LucideIcon,
} from "lucide-react";
import type { EventPlan, AssistantCard, TimelineItem, BudgetItem, VendorItem, ChecklistItem } from "./api/chat/route";
import { useDiya } from "@/lib/diyaStore";
import { buildNextEventQuestion, getEventQuestionFlow, type EventCollectedData } from "@/lib/eventQuestions";

// ── Dynamic imports (SSR safe) ────────────────────────────────────────────────
const Diya    = dynamic(() => import("@/components/diya/Diya").then(m => m.Diya), { ssr: false });
const DiyaTypingIndicator = dynamic(() => import("@/components/diya/DiyaTypingIndicator").then(m => m.DiyaTypingIndicator), { ssr: false });
const PlanLockedCelebration = dynamic(() => import("@/components/diya/DiyaCelebration").then(m => m.PlanLockedCelebration), { ssr: false });

// ── Palette ───────────────────────────────────────────────────────────────────
const PAL = [
  { bg:"#EEF2FF", fg:"#6366F1" }, { bg:"#FDF2F8", fg:"#EC4899" },
  { bg:"#F0FDF4", fg:"#10B981" }, { bg:"#FFFBEB", fg:"#F59E0B" },
  { bg:"#EFF6FF", fg:"#3B82F6" }, { bg:"#F5F3FF", fg:"#8B5CF6" },
  { bg:"#F0FDFA", fg:"#14B8A6" }, { bg:"#FFF1F2", fg:"#F43F5E" },
];

const ICON_MAP: Record<string, LucideIcon> = {
  camera:Camera, music:Music, utensils:Utensils, flower2:Flower2,
  car:Car, building2:Building2, gift:Gift, heart:Heart,
  partypopper:PartyPopper, mic:Mic, package:Package, lightbulb:Lightbulb,
  calendar:Calendar, users:Users, mappin:MapPin, clock:Clock,
  sparkles:Sparkles, wand2:Wand2, trees:Trees, cake:Cake, gem:Gem,
  checkcircle2:CheckCircle2,
};
const getIcon = (n: string): LucideIcon => ICON_MAP[n?.toLowerCase().replace(/[-_\s]/g, "")] ?? Sparkles;
const fmtINR  = (n: number) => n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : n >= 1000 ? `₹${(n/1000).toFixed(0)}K` : `₹${n.toLocaleString("en-IN")}`;

const EVENT_PAL: Record<string, typeof PAL[0]> = {
  wedding: PAL[0], birthday: PAL[1], community: PAL[2],
  corporate: PAL[4], festival: PAL[5], other: PAL[3],
};

// ── Floating orbs ─────────────────────────────────────────────────────────────
function FloatingOrbs({ color = "#6366F1" }: { color?: string }) {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden>
      {[{ w:500,h:500,x:"-10%",y:"-15%",d:22 },{ w:400,h:400,x:"70%",y:"60%",d:28 },{ w:300,h:300,x:"40%",y:"-5%",d:18 },{ w:250,h:250,x:"-5%",y:"70%",d:24 }].map((o,i)=>(
        <motion.div key={i}
          style={{ width:o.w, height:o.h, left:o.x, top:o.y, background:color, filter:"blur(90px)", position:"absolute", opacity:0.07 }}
          animate={{ x:[0,30,-20,0], y:[0,-25,15,0] }}
          transition={{ duration:o.d, repeat:Infinity, ease:"easeInOut", delay:i*3 }} />
      ))}
    </div>
  );
}

// ── Answer pill ───────────────────────────────────────────────────────────────
const STEP_ICONS: Record<number, LucideIcon> = { 1:Gem, 2:Calendar, 3:Users, 4:MapPin, 5:Rupee, 6:Sparkles, 7:Building2, 8:Utensils, 9:Heart };
const QUESTION_ICONS: Record<string, LucideIcon> = {
  eventType: Gem, eventDate: Calendar, guestCount: Users, city: MapPin, budgetTotal: Rupee,
  theme: Sparkles, venueStyle: Building2, cateringType: Utensils, specialRequirements: Heart,
  "eventDetails.ceremonyStyle": Gem, "eventDetails.format": Calendar, "eventDetails.objective": Lightbulb,
  "eventDetails.duration": Clock, "eventDetails.productionNeeds": Music, "eventDetails.honoree": Cake,
  "eventDetails.entertainment": PartyPopper, "eventDetails.purpose": Lightbulb,
  "eventDetails.participation": Users, "eventDetails.audience": Users,
};
function AnswerPill({ step, value, color }: { step:number; value:string; color:string }) {
  const I = STEP_ICONS[step] ?? Sparkles;
  return (
    <motion.div initial={{opacity:0,scale:0.7,y:6}} animate={{opacity:1,scale:1,y:0}}
      transition={{type:"spring",stiffness:320,damping:22}}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border"
      style={{background:`${color}18`,borderColor:`${color}40`,color}}>
      <I size={10}/>{value}
    </motion.div>
  );
}

// ── Scene card ─────────────────────────────────────────────────────────────────
interface AnswerEntry { step:number; display:string; raw:string; }

function SceneCard({ card, onAnswer }: { card:AssistantCard; onAnswer:(v:string,d:string)=>void }) {
  const [textVal, setTextVal] = useState("");
  const [selected, setSelected] = useState<string|null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    if (!card.options?.length && card.inputType !== "date" && card.step !== 2)
      setTimeout(()=>inputRef.current?.focus(),400);
  },[card]);

  const submit = (v:string, d:string) => {
    if (!v.trim()) return;
    setSelected(v);
    onAnswer(v, d);
  };

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const monthOffset = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth()+1, 0).getDate();
  const calendarDays = Array.from({length:42},(_,index)=>{
    const day = index-monthOffset+1;
    if (day<1||day>daysInMonth) return null;
    const date = new Date(visibleMonth.getFullYear(),visibleMonth.getMonth(),day);
    const value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return {day,value,date,disabled:value<todayKey};
  });
  const monthLabel = visibleMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});

  return (
    <motion.div
      initial={{opacity:0,y:40,scale:0.94}} animate={{opacity:1,y:0,scale:1}}
      exit={{opacity:0,y:-30,scale:0.96}}
      transition={{type:"spring",stiffness:260,damping:26}}
      className="w-full">

      {card.subtitle && (
        <motion.p initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:0.1}}
          className="text-sm text-[#6B7280] mb-3 leading-relaxed">{card.subtitle}</motion.p>
      )}
      <motion.h2 initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.15}}
        className="text-2xl sm:text-3xl font-extrabold text-[#111827] leading-tight mb-6 font-display">
        {card.title}
      </motion.h2>

      {/* Option grid */}
      {card.options && card.options.length > 0 && (
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}}
          className="grid grid-cols-2 gap-2.5 mb-4">
          {card.options.map((opt,i)=>(
            <motion.button key={opt.value}
              onClick={()=>submit(opt.value,opt.label)}
              initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
              transition={{delay:0.2+i*0.05}}
              whileHover={{y:-3,boxShadow:"0 8px 24px rgba(99,102,241,0.15)"}}
              whileTap={{scale:0.97}}
              className={`relative flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all font-semibold text-sm ${
                selected===opt.value ? "border-[#6366F1] bg-[#EEF2FF] text-[#4338CA]"
                : "border-[#E5E7EB] bg-white text-[#374151] hover:border-[#6366F1]/50"
              }`}>
              {selected===opt.value && (
                <motion.div layoutId="sel-check"
                  className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#6366F1] flex items-center justify-center">
                  <Check size={11} strokeWidth={3} className="text-white"/>
                </motion.div>
              )}
              {opt.label}
            </motion.button>
          ))}
        </motion.div>
      )}

      {/* Free text */}
      {!card.options?.length && (
        <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:0.25}}>
          {card.step === 2 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9CA3AF]">Choose your day</p>
                    <p className="mt-1 font-display text-lg font-extrabold text-[#202B27] sm:text-xl">{monthLabel}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label="Previous month"
                      onClick={()=>setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()-1,1))}
                      disabled={visibleMonth.getFullYear()===today.getFullYear()&&visibleMonth.getMonth()===today.getMonth()}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-[#315C4C] transition-colors hover:bg-[#E8EEE7] disabled:cursor-not-allowed disabled:text-[#D1D5DB]">
                      <ChevronLeft size={18}/>
                    </button>
                    <button type="button" aria-label="Next month"
                      onClick={()=>setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()+1,1))}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-[#315C4C] transition-colors hover:bg-[#E8EEE7]">
                      <ChevronRight size={18}/>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-y-1 text-center">
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map(day=>(
                    <span key={day} className="flex h-9 items-center justify-center text-[10px] font-bold uppercase text-[#9CA3AF] sm:h-10 sm:text-xs">{day}</span>
                  ))}
                  {calendarDays.map((entry,index)=>entry?(
                    <button key={entry.value} type="button" disabled={entry.disabled}
                      aria-label={entry.date.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
                      aria-pressed={textVal===entry.value}
                      onClick={()=>setTextVal(entry.value)}
                      className={`mx-auto flex aspect-square w-9 items-center justify-center rounded-full text-xs font-semibold transition-colors sm:w-10 sm:text-sm ${textVal===entry.value?"bg-[#214E43] text-white shadow-md":"text-[#374151] hover:bg-[#E8EEE7]"} ${entry.disabled?"cursor-not-allowed text-[#D1D5DB] hover:bg-transparent":""}`}>
                      {entry.day}
                    </button>
                  ):<span key={`empty-${index}`} className="aspect-square"/>) }
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[#F0F0EC] pt-3 text-[10px] text-[#9CA3AF] sm:text-xs">
                  <span>Past dates unavailable</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#214E43]"/>Selected</span>
                </div>
              </div>
              {textVal && (
                <motion.p initial={{opacity:0}} animate={{opacity:1}}
                  className="text-sm font-semibold text-[#315C4C] text-center">
                  {new Date(textVal+"T00:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
                </motion.p>
              )}
              <motion.button onClick={()=>textVal&&submit(textVal,textVal)}
                whileHover={{scale:1.02}} whileTap={{scale:0.96}} disabled={!textVal}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-sm bg-[#6366F1] hover:bg-[#4F46E5] disabled:opacity-30 shadow-lg shadow-indigo-100 transition-colors">
                <ArrowRight size={16}/> Confirm this date
              </motion.button>
            </div>
          ) : (
            card.step === 4 ? (
              <div className="space-y-4">
                <div className="relative h-40 overflow-hidden bg-[#214E43] sm:h-48" aria-label="Interactive place pin preview">
                  <div className="absolute inset-0 opacity-30" style={{backgroundImage:"linear-gradient(rgba(226,236,220,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(226,236,220,.25) 1px, transparent 1px)",backgroundSize:"28px 28px"}}/>
                  <div className="absolute left-[-10%] top-[48%] h-px w-[120%] rotate-[-12deg] bg-[#D8E3D8]/30"/>
                  <div className="absolute left-[18%] top-[-40%] h-[180%] w-px rotate-[24deg] bg-[#D8E3D8]/30"/>
                  <div className="absolute left-[58%] top-[-30%] h-[170%] w-px rotate-[-18deg] bg-[#D8E3D8]/30"/>
                  <div className="absolute bottom-[18%] left-[12%] h-px w-[82%] rotate-[7deg] bg-[#D8E3D8]/20"/>
                  <div className="absolute left-[8%] top-[12%] text-[9px] font-bold uppercase tracking-[0.2em] text-white/60">Your event, your coordinates</div>
                  <AnimatePresence mode="wait">
                    {textVal.trim()?(
                      <motion.div key={textVal.trim()} initial={{opacity:0,y:-10,scale:0.88}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:8}}
                        className="absolute left-1/2 top-[43%] flex -translate-x-1/2 flex-col items-center">
                        <span className="mb-1 max-w-[220px] truncate border border-white/20 bg-[#173D34] px-3 py-1 text-[10px] font-bold text-white shadow-lg sm:max-w-xs sm:text-xs">{textVal.trim()}</span>
                        <MapPin size={31} fill="#F6C65B" stroke="#173D34" strokeWidth={1.5}/>
                        <motion.span initial={{scale:0.4,opacity:0.7}} animate={{scale:1.5,opacity:0}} transition={{duration:1.1,repeat:Infinity}}
                          className="absolute top-[30px] h-5 w-5 rounded-full border border-[#F6C65B]"/>
                      </motion.div>
                    ):(
                      <motion.div key="empty-pin" initial={{opacity:0}} animate={{opacity:1}}
                        className="absolute inset-0 flex flex-col items-center justify-center pt-5 text-center">
                        <MapPin size={27} className="text-[#F6C65B]"/>
                        <p className="mt-2 text-xs font-semibold text-white/80">The map is yours to define</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="absolute bottom-3 right-3 text-[9px] font-bold uppercase tracking-widest text-white/45">PLACE PIN · {textVal.trim()?"SET":"WAITING"}</div>
                </div>

                <div>
                  <label htmlFor="custom-city" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#89938C]">Where should the celebration happen?</label>
                  <div className="relative">
                    <input id="custom-city" ref={inputRef} type="text" value={textVal}
                      onChange={e=>setTextVal(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&textVal.trim())submit(textVal.trim(),textVal.trim());}}
                      placeholder="Enter any city, town, or place"
                      className="w-full border-0 border-b-2 border-[#DADDD2] bg-transparent py-3 pr-36 text-lg font-semibold text-[#202B27] outline-none placeholder:text-sm placeholder:font-normal placeholder:text-[#B7BDB8] focus:border-[#315C4C] sm:text-xl"/>
                    <motion.button onClick={()=>textVal.trim()&&submit(textVal.trim(),textVal.trim())}
                      whileHover={{scale:1.06}} whileTap={{scale:0.94}} disabled={!textVal.trim()}
                      aria-label="Use this place"
                      className="absolute right-0 top-2 flex h-10 items-center gap-2 whitespace-nowrap bg-[#214E43] px-3 text-xs font-extrabold text-white transition-colors hover:bg-[#173D34] disabled:cursor-not-allowed disabled:bg-[#DADDD2]">
                      Use this place <ArrowRight size={15}/>
                    </motion.button>
                  </div>
                  <p className="mt-2 text-[10px] text-[#A0A8A2]">Type any location. Nothing is preselected.</p>
                </div>
              </div>
            ) : (
            /* Other text inputs — clean underline, no box */
            <div>
              <div className="relative mb-4">
                <input ref={inputRef} type="text" value={textVal}
                  onChange={e=>setTextVal(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&textVal.trim())submit(textVal.trim(),textVal.trim());}}
                  placeholder={card.inputPlaceholder??"Type your answer…"}
                  className="w-full text-xl font-semibold text-[#111827] bg-transparent outline-none placeholder:text-[#E0E0E0] placeholder:font-normal py-2 pr-14 border-0"/>
                <div className="h-[2px] w-full rounded-full overflow-hidden" style={{background:"#F3F4F6"}}>
                  <motion.div className="h-full rounded-full bg-[#6366F1]"
                    animate={{width:textVal?"100%":"0%"}} transition={{duration:0.3}}/>
                </div>
                <motion.button onClick={()=>textVal.trim()&&submit(textVal.trim(),textVal.trim())}
                  whileHover={{scale:1.1}} whileTap={{scale:0.88}} disabled={!textVal.trim()}
                  className="absolute right-0 top-1 w-10 h-10 rounded-xl bg-[#6366F1] flex items-center justify-center shadow-md shadow-indigo-200 disabled:opacity-30">
                  <ArrowRight size={16} className="text-white"/>
                </motion.button>
              </div>
              <p className="text-xs text-[#C4C4C4]">Press Enter or click →</p>
            </div>
            )
          )}
        </motion.div>
      )}

      {card.hint && card.step !== 4 && !(card.step === 2 && textVal) && <p className="text-[11px] text-[#C4C4C4] mt-3">{card.hint}</p>}
    </motion.div>
  );
}

// ── Plan view components ──────────────────────────────────────────────────────
const ST: Record<string,{bg:string;text:string}> = {
  done:{bg:"#D1FAE5",text:"#065F46"},
  in_progress:{bg:"#DBEAFE",text:"#1D4ED8"},
  pending:{bg:"#F3F4F6",text:"#6B7280"},
};

function TimelineSection({ items }:{ items:TimelineItem[] }) {
  return (
    <div className="space-y-1">
      {items.map((it,i)=>{
        const I=getIcon(it.icon); const p=PAL[i%PAL.length]; const s=ST[it.status]??ST.pending;
        return (
          <motion.div key={i} initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}} transition={{delay:i*0.04}} className="flex items-start gap-3">
            <div className="flex flex-col items-center pt-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:p.bg}}>
                <I size={14} style={{color:p.fg}}/>
              </div>
              {i<items.length-1&&<div className="w-px h-5 bg-[#E5E7EB] mt-1"/>}
            </div>
            <div className="flex-1 min-w-0 pb-2 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-[#6366F1]">{it.time}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:s.bg,color:s.text}}>
                  {it.status==="in_progress"?"In Progress":it.status==="done"?"Done":"Pending"}
                </span>
              </div>
              <p className="text-sm font-semibold text-[#111827] mt-0.5">{it.task}</p>
              {it.description&&<p className="text-xs text-[#6B7280] mt-0.5 leading-relaxed">{it.description}</p>}
              <p className="text-xs text-[#9CA3AF] mt-0.5">{it.owner}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function BudgetSection({ items, total }:{ items:BudgetItem[]; total:number }) {
  return (
    <div className="space-y-3.5">
      {items.map((it,i)=>{
        const I=getIcon(it.icon); const p=PAL[i%PAL.length]; const pct=Math.round((it.allocated/total)*100);
        return (
          <motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:p.bg}}>
              <I size={14} style={{color:p.fg}}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-semibold text-[#111827] truncate">{it.category}</span>
                <span className="text-xs font-bold ml-2 flex-shrink-0" style={{color:p.fg}}>
                  {fmtINR(it.allocated)} <span className="text-[#C4C4C4] font-normal">({pct}%)</span>
                </span>
              </div>
              <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full" style={{background:p.fg}}
                  initial={{width:0}} animate={{width:`${pct}%`}}
                  transition={{duration:0.9,delay:i*0.05,ease:[0.34,1.56,0.64,1]}}/>
              </div>
              {(it as BudgetItem & {notes?:string}).notes && (
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">{(it as BudgetItem & {notes?:string}).notes}</p>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function VendorsSection({ vendors }:{ vendors:VendorItem[] }) {
  const VS: Record<string,{bg:string;text:string}> = {
    pending:{bg:"#F3F4F6",text:"#6B7280"}, contacted:{bg:"#DBEAFE",text:"#1D4ED8"}, booked:{bg:"#D1FAE5",text:"#065F46"},
  };
  const VP: Record<string,{bg:string;text:string}> = {
    high:{bg:"#FEE2E2",text:"#991B1B"}, medium:{bg:"#FEF3C7",text:"#92400E"}, low:{bg:"#F3F4F6",text:"#6B7280"},
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {vendors.map((v,i)=>{
        const I=getIcon(v.icon); const p=PAL[i%PAL.length];
        const vs=VS[v.status]??VS.pending; const vp=VP[v.priority]??VP.medium;
        return (
          <motion.div key={i} initial={{opacity:0,scale:0.96}} animate={{opacity:1,scale:1}} transition={{delay:i*0.04}}
            className="bg-white border border-[#E5E7EB] rounded-2xl p-3.5 flex items-start gap-3 hover:shadow-md hover:border-[#6366F1]/20 transition-all">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:p.bg}}>
              <I size={16} style={{color:p.fg}}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#111827]">{v.name}</p>
              {(v as VendorItem & {description?:string}).description && (
                <p className="text-xs text-[#6B7280] mt-0.5 leading-snug">{(v as VendorItem & {description?:string}).description}</p>
              )}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:vs.bg,color:vs.text}}>{v.status}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:vp.bg,color:vp.text}}>{v.priority}</span>
                {(v as VendorItem & {estimatedCost?:string}).estimatedCost && (
                  <span className="text-[10px] text-[#9CA3AF]">{(v as VendorItem & {estimatedCost?:string}).estimatedCost}</span>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function ChecklistSection({ items }:{ items:ChecklistItem[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i:number)=>setDone(p=>{const n=new Set(p);if(n.has(i)){n.delete(i);}else{n.add(i);}return n;});
  return (
    <div className="space-y-2">
      {items.map((it,i)=>{
        const I=getIcon(it.icon); const checked=done.has(i); const p=PAL[i%PAL.length];
        return (
          <motion.button key={i} onClick={()=>toggle(i)}
            initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} transition={{delay:i*0.04}}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
              checked?"bg-[#F9FAFB] border-[#E5E7EB] opacity-55":"bg-white border-[#E5E7EB] hover:border-[#6366F1]/30 hover:shadow-sm"
            }`}>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${checked?"border-[#10B981] bg-[#10B981]":"border-[#D1D5DB]"}`}>
              {checked&&<Check size={11} strokeWidth={3} className="text-white"/>}
            </div>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:p.bg}}>
              <I size={12} style={{color:p.fg}}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${checked?"line-through text-[#9CA3AF]":"text-[#111827]"}`}>{it.task}</p>
              <p className="text-xs text-[#9CA3AF] mt-0.5">{it.dueDate}</p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

const PLAN_TABS = [
  {id:"timeline",label:"Timeline",Icon:Clock},
  {id:"budget",label:"Budget",Icon:IndianRupee},
  {id:"vendors",label:"Vendors",Icon:Building2},
  {id:"checklist",label:"Checklist",Icon:CheckCircle2},
] as const;
type TabId = (typeof PLAN_TABS)[number]["id"];

function PlanReveal({ plan, onBack }:{ plan:EventPlan; onBack:()=>void }) {
  const [tab, setTab] = useState<TabId>("timeline");
  const [showCelebration, setShowCelebration] = useState(false);
  const ep = EVENT_PAL[plan.eventType?.toLowerCase()] ?? PAL[0];
  const { say } = useDiya();

  useEffect(()=>{
    setShowCelebration(true);
    say("Your event plan is ready — this is going to be spectacular!", "celebrate", 4000);
    setTimeout(()=>setShowCelebration(false), 5000);
  },[say]);

  const highlights = (plan as EventPlan & {highlights?:string[]}).highlights;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="min-h-screen bg-[#F4F6F8] flex flex-col">
      <PlanLockedCelebration active={showCelebration}/>

      {/* Hero */}
      <div className="relative overflow-hidden" style={{background:`linear-gradient(135deg, ${ep.fg}15 0%, ${ep.fg}05 100%)`}}>
        <div className="max-w-3xl mx-auto px-5 py-8 flex items-center gap-5">
          <div className="flex-shrink-0">
            <Diya moodOverride="celebrate" size={110}/>
          </div>
          <div className="flex-1 min-w-0">
            <motion.p initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}}
              className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:ep.fg}}>
              Your Professional Event Plan ✦
            </motion.p>
            <motion.h1 initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.08}}
              className="text-3xl font-extrabold text-[#111827] capitalize font-display leading-tight">
              {plan.eventType} Plan
            </motion.h1>
            <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.14}}
              className="text-sm text-[#6B7280] mt-1">{plan.theme}</motion.p>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}}
              className="flex flex-wrap gap-2 mt-3">
              {[
                {I:Calendar, v:new Date(plan.eventDate+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})},
                {I:Users, v:`${plan.guestCount} guests`},
                {I:MapPin, v:plan.city},
                {I:Rupee, v:fmtINR(plan.budgetTotal)},
              ].map(({I,v},i)=>(
                <span key={i} className="flex items-center gap-1.5 text-xs font-semibold text-[#374151] bg-white border border-[#E5E7EB] px-3 py-1.5 rounded-full shadow-sm">
                  <I size={11} style={{color:ep.fg}}/>{v}
                </span>
              ))}
            </motion.div>
          </div>
        </div>

        {/* Highlights */}
        {highlights && highlights.length > 0 && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.3}}
            className="max-w-3xl mx-auto px-5 pb-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {highlights.map((h,i)=>(
              <div key={i} className="bg-white/80 rounded-xl px-3 py-2.5 flex items-center gap-2 border border-white/60">
                <Sparkles size={11} style={{color:ep.fg}} className="flex-shrink-0"/>
                <p className="text-xs font-semibold text-[#374151] leading-snug">{h}</p>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 pb-10">
          <div className="flex border-b border-[#E5E7EB] mb-5 bg-white sticky top-0 z-10">
            {PLAN_TABS.map(({id,label,Icon:I})=>{
              const active=tab===id;
              return (
                <button key={id} onClick={()=>setTab(id)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-bold transition-colors ${active?"text-[#6366F1] bg-white":"text-[#9CA3AF] hover:text-[#374151]"}`}>
                  <I size={12}/><span className="hidden sm:inline">{label}</span>
                  {active&&<motion.div layoutId="plan-tab" className="absolute bottom-0 left-4 right-4 h-0.5 bg-[#6366F1] rounded-full"/>}
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait">
            {tab==="timeline"  &&<motion.div key="tl" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><TimelineSection items={plan.timeline}/></motion.div>}
            {tab==="budget"    &&<motion.div key="bg" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><BudgetSection items={plan.budgetBreakdown} total={plan.budgetTotal}/></motion.div>}
            {tab==="vendors"   &&<motion.div key="vd" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><VendorsSection vendors={plan.vendors}/></motion.div>}
            {tab==="checklist" &&<motion.div key="cl" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><ChecklistSection items={plan.checklist}/></motion.div>}
          </AnimatePresence>
          <button onClick={onBack}
            className="w-full mt-8 py-3 rounded-2xl border-2 border-[#E5E7EB] text-[#9CA3AF] text-sm font-bold hover:border-[#6366F1]/40 hover:text-[#6366F1] transition-all flex items-center justify-center gap-2">
            <RotateCcw size={13}/> Plan another event
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LANDING
// ═══════════════════════════════════════════════════════════════════════════
function Landing({ onStart }:{ onStart:(t?:string,l?:string)=>void }) {
  const [lit, setLit] = useState(false);
  const [activeMoment, setActiveMoment] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<{type:string;label:string}|null>(null);
  const { say } = useDiya();

  useEffect(()=>{ say("Light the diya to begin your event journey!", "wave", 4000); },[say]);

  const EVENTS = [
    { type:"wedding",   label:"Wedding",    Icon:Gem,       grad:"linear-gradient(135deg,#818CF8,#6366F1)", shadow:"rgba(99,102,241,0.45)" },
    { type:"birthday",  label:"Birthday",   Icon:Cake,      grad:"linear-gradient(135deg,#F472B6,#EC4899)", shadow:"rgba(236,72,153,0.45)" },
    { type:"community", label:"Community",  Icon:Trees,     grad:"linear-gradient(135deg,#34D399,#10B981)", shadow:"rgba(16,185,129,0.45)" },
    { type:"corporate", label:"Corporate",  Icon:Building2, grad:"linear-gradient(135deg,#60A5FA,#3B82F6)", shadow:"rgba(59,130,246,0.45)" },
    { type:"festival",  label:"Festival",   Icon:Music,     grad:"linear-gradient(135deg,#A78BFA,#8B5CF6)", shadow:"rgba(139,92,246,0.45)" },
    { type:"other",     label:"Other",      Icon:Sparkles,  grad:"linear-gradient(135deg,#FCD34D,#F59E0B)", shadow:"rgba(245,158,11,0.45)" },
  ];

  const STEPS = [
    { n:"01", label:"Tell Eve your vision", Icon:Wand2,    color:"#6366F1", bg:"#EEF2FF" },
    { n:"02", label:"AI crafts your plan",  Icon:Sparkles, color:"#EC4899", bg:"#FDF2F8" },
    { n:"03", label:"Execute flawlessly",   Icon:Check,    color:"#10B981", bg:"#F0FDF4" },
  ];

  const moments = [
    { time:"09:00", label:"Doors open", detail:"A warm welcome", image:"/character/greet_transparent.webp", mood:"greet" as const },
    { time:"12:30", label:"Gather & feast", detail:"Good food, better company", image:"/character/wave_transparent.webp", mood:"wave" as const },
    { time:"16:00", label:"The big moment", detail:"Make it one to remember", image:"/character/celebrate_transparent.webp", mood:"celebrate" as const },
  ];

  const selectMoment = (index:number) => {
    setActiveMoment(index);
    const moment = moments[index];
    say(moment.detail, moment.mood, 2600);
    if (index === moments.length - 1) {
      import("canvas-confetti").then(({ default: confetti }) => {
        confetti({ particleCount: 30, spread: 36, startVelocity: 26, origin: { x: 0.82, y: 0.48 }, disableForReducedMotion: true, colors: ["#F6C65B", "#D9684E", "#F8F7F2", "#76A88A"] });
      });
    }
  };

  const chooseEvent = (type:string,label:string) => {
    setSelectedEvent({type,label});
    document.getElementById("plan-preview")?.scrollIntoView({behavior:"smooth",block:"start"});
  };

  if (lit) return (
    <motion.div className="min-h-screen flex items-center justify-center"
      style={{background:"linear-gradient(135deg,#EEF2FF,#FDF2F8,#F0FDF4)"}}
      initial={{opacity:1}} animate={{opacity:0}} transition={{delay:0.8,duration:0.6}}
      onAnimationComplete={()=>onStart()}>
      <motion.div animate={{scale:[1,1.15,1],rotate:[0,5,-5,0]}} transition={{duration:0.6,repeat:2}}>
        <Diya moodOverride="celebrate" size={200}/>
      </motion.div>
    </motion.div>
  );

  return (
    <div className="min-h-screen overflow-hidden bg-[#F8F7F2] text-[#202B27]">

      {/* Nav */}
      <nav className="relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          {/* Clay logo badge */}
          <div className="relative">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#214E43]">
              <Sparkles size={17} className="text-[#F6C65B]"/>
            </div>
          </div>
          <span className="font-extrabold text-[#202B27] text-xl font-display">EventMate<span className="text-[#E66C50]">.</span></span>
        </div>
        <div className="hidden items-center gap-7 md:flex">
          <a href="#event-types" className="text-xs font-bold text-[#68736D] transition-colors hover:text-[#214E43]">Choose an event</a>
          <a href="#plan-preview" className="text-xs font-bold text-[#68736D] transition-colors hover:text-[#214E43]">What you&apos;ll get</a>
          <a href="#how-it-works" className="text-xs font-bold text-[#68736D] transition-colors hover:text-[#214E43]">How it works</a>
        </div>
        <motion.button onClick={()=>onStart()}
          whileHover={{y:-2}} whileTap={{y:1,scale:0.97}}
          className="flex items-center gap-2 text-sm font-bold text-white px-4 py-2.5 rounded-xl bg-[#214E43] hover:bg-[#173D34] transition-colors">
          <Wand2 size={14}/> Start Planning
        </motion.button>
      </nav>

      {/* HERO */}
      <section className="relative z-10 max-w-7xl mx-auto px-5 pt-5 pb-10 sm:px-8 sm:pt-10 sm:pb-14 grid grid-cols-1 lg:grid-cols-[0.94fr_1.06fr] items-center gap-8 lg:gap-12">

        {/* Left text */}
        <div className="text-center lg:text-left">
          {/* Clay badge */}
          <motion.div initial={{opacity:0,y:-12,scale:0.9}} animate={{opacity:1,y:0,scale:1}}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-bold uppercase tracking-wider bg-[#E8EEE7] text-[#315C4C]">
            <Sparkles size={12}/> Your thoughtful AI event planner
          </motion.div>

          <motion.h1 initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{delay:0.07}}
            className="font-extrabold font-display leading-[1.04] mb-4 text-[#202B27] text-4xl sm:text-5xl lg:text-7xl">
            Make room for<br className="hidden sm:block"/><span className="text-[#D9684E]">something wonderful.</span>
          </motion.h1>

          <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.12}}
            className="text-[#58645E] text-base sm:text-lg leading-relaxed mb-5 max-w-lg mx-auto lg:mx-0">
            Tell <strong className="text-[#202B27]">Eve</strong> what you&apos;re celebrating. Get a thoughtful plan for the timeline, budget, vendors, and all the details.
          </motion.p>

          {/* Planning actions */}
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:0.16}}
            className="mb-8 max-w-xl mx-auto lg:mx-0">
            <p className="flex items-center justify-center lg:justify-start gap-2 mb-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#78847C]">
              <span className="w-6 h-px bg-[#D9684E]"/>Your first step
            </p>
            <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
              <motion.button onClick={()=>onStart()}
                whileHover={{y:-2,backgroundColor:"#173D34"}} whileTap={{scale:0.98}}
                className="group flex min-h-[68px] flex-1 items-center justify-between gap-4 rounded-xl bg-[#214E43] px-4 py-3 text-left text-white shadow-[0_8px_20px_rgba(33,78,67,0.16)] transition-colors sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#F6C65B] text-[#214E43]"><Wand2 size={18}/></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold">Build my event plan</span>
                    <span className="mt-0.5 block text-[11px] font-medium text-white/75">A tailored track for your kind of event.</span>
                  </span>
                </span>
                <ArrowRight size={18} className="flex-shrink-0 text-[#F6C65B] transition-transform group-hover:translate-x-1"/>
              </motion.button>
              <motion.button onClick={()=>setLit(true)}
                whileHover={{y:-2}} whileTap={{scale:0.98}}
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#DADDD2] bg-white/70 px-4 text-xs font-bold text-[#315C4C] transition-colors hover:bg-white sm:min-h-[68px] sm:flex-col sm:gap-1 sm:px-5">
                <Sparkles size={16} className="text-[#D9684E]"/>
                <span>Light the Diya</span>
              </motion.button>
            </div>
          </motion.div>

          {/* Stats in clay chips */}
          <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.22}}
            className="flex flex-wrap gap-x-6 gap-y-3 justify-center lg:justify-start">
            {[
              {n:"10",    l:"tailored questions", c:"#315C4C", s:"#CBD5CC"},
              {n:"< 2 min",l:"to your plan",    c:"#D9684E", s:"#F1C5B9"},
              {n:"Free",  l:"no signup",       c:"#B27A18", s:"#EED9A7"},
            ].map(({n,l,c,s},i)=>(
              <motion.div key={i} initial={{scale:0.8,opacity:0}} animate={{scale:1,opacity:1}}
                transition={{delay:0.25+i*0.06,type:"spring",stiffness:300,damping:18}}
                className="flex items-baseline gap-2 py-1"
                style={{borderBottom:`2px solid ${s}`}}>
                <span className="text-lg font-extrabold" style={{color:c}}>{n}</span>
                <span className="text-[10px] font-bold text-[#68736D] uppercase tracking-wider">{l}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Right — an editorial event-day vignette */}
        <motion.div initial={{opacity:0,scale:0.85,y:20}} animate={{opacity:1,scale:1,y:0}}
          transition={{delay:0.1,type:"spring",stiffness:180,damping:20}}
          className="relative min-h-[340px] sm:min-h-[420px] lg:min-h-[500px] overflow-hidden bg-[#214E43]">
          <div className="absolute left-0 top-0 h-full w-2 bg-[#F6C65B]" aria-hidden="true"/>
          <div className="absolute inset-3 border border-white/15 sm:inset-4" aria-hidden="true"/>
          <div className="absolute left-[8%] top-[8%] z-20 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#D8E3D8] sm:text-xs">
            <Sparkles size={15} className="text-[#F6C65B]"/>Your day, your story
          </div>
          <div className="absolute right-[5%] top-[17%] h-[55%] w-[59%] rounded-t-full bg-[#2D6255]" aria-hidden="true"/>
          <AnimatePresence mode="wait">
            <motion.img key={moments[activeMoment].image} src={moments[activeMoment].image} alt={`Diya: ${moments[activeMoment].label}`}
              initial={{opacity:0,scale:0.88,y:16,rotate:-3}} animate={{opacity:1,scale:1,y:0,rotate:0}}
              exit={{opacity:0,scale:0.92,y:-8}} transition={{duration:0.32,ease:"easeOut"}}
              className="absolute z-10 right-[-2%] top-[4%] h-[76%] w-[68%] object-contain object-bottom drop-shadow-[0_18px_18px_rgba(0,0,0,0.22)] sm:right-[1%] sm:top-[2%] sm:h-[80%] sm:w-[67%]"/>
          </AnimatePresence>
          <motion.div key={activeMoment} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
            className="absolute left-[8%] top-[25%] z-20 w-[34%] sm:top-[27%] sm:w-[32%] text-[#F8F7F2]">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#F6C65B] sm:text-[10px]">{moments[activeMoment].time}</p>
            <p className="mt-1 text-sm font-extrabold leading-tight sm:text-lg">{moments[activeMoment].label}</p>
            <p className="mt-1 text-[10px] leading-snug text-white/70 sm:text-xs">{moments[activeMoment].detail}</p>
          </motion.div>
          <div className="absolute inset-x-0 bottom-0 z-20 grid min-h-[76px] grid-cols-3 border-t border-white/15 bg-[#173D34] px-2 py-2 sm:min-h-[88px] sm:px-5 sm:py-3">
            {moments.map(({time,label},index)=>(
              <button key={time} type="button" onClick={()=>selectMoment(index)} aria-pressed={activeMoment===index}
                className={`group relative min-w-0 px-2 text-left transition-colors sm:px-3 ${index===1?"border-x border-white/15":""} ${activeMoment===index?"text-white":"text-white/55 hover:text-white/85"}`}>
                <span className={`absolute inset-x-2 top-[-9px] h-[2px] transition-colors sm:inset-x-3 sm:top-[-13px] ${activeMoment===index?"bg-[#F6C65B]":"bg-transparent group-hover:bg-white/40"}`}/>
                <span className="block text-[9px] font-bold text-[#F6C65B] sm:text-[10px]">{time}</span>
                <span className="mt-1 block truncate text-[10px] font-bold sm:text-xs">{label}</span>
              </button>
            ))}
          </div>
        </motion.div>
      </section>

      {/* EVENT TYPE GRID — clay tiles */}
      <section id="event-types" className="relative z-10 scroll-mt-8 px-5 py-12 sm:px-8 sm:py-16 bg-white/70 border-y border-[#E9E8DF]">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{opacity:0,y:8}} whileInView={{opacity:1,y:0}} viewport={{once:true}}
            className="text-center mb-10">
            <p className="text-xs font-bold text-[#D9684E] uppercase tracking-widest mb-2">01 / Start with the occasion</p>
            <h2 className="text-3xl font-extrabold font-display text-[#202B27]">What are we celebrating?</h2>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {EVENTS.map(({type,label,Icon:I,shadow},i)=>(
              <motion.button key={type} onClick={()=>chooseEvent(type,label)} aria-pressed={selectedEvent?.type===type}
                initial={{opacity:0,y:20,scale:0.9}} whileInView={{opacity:1,y:0,scale:1}}
                viewport={{once:true}} transition={{delay:i*0.07,type:"spring",stiffness:260,damping:20}}
                whileHover={{y:-6,scale:1.04}} whileTap={{y:2,scale:0.96}}
                className={`relative flex flex-col items-start gap-5 p-4 sm:p-5 min-h-32 rounded-2xl border text-left text-sm font-bold transition-all ${selectedEvent?.type===type?"border-[#315C4C] bg-[#E8EEE7] text-[#214E43] shadow-[0_8px_24px_rgba(37,53,43,0.10)]":"border-[#E9E8DF] bg-[#F8F7F2] text-[#202B27] hover:bg-white hover:border-[#315C4C]/40 hover:shadow-[0_10px_28px_rgba(37,53,43,0.09)]"}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:`${shadow.replace("0.45","0.12")}`}}>
                  <I size={20} style={{color:shadow.replace("0.45","1")}}/>
                </div>
                <span className="flex items-center justify-between w-full">{label}{selectedEvent?.type===type?<Check size={15} className="text-[#315C4C]"/>:<ArrowRight size={14} className="text-[#89938C]"/>}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* PLAN PREVIEW */}
      <section id="plan-preview" className="relative z-10 scroll-mt-8 bg-[#F0EFE6] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div initial={{opacity:0,y:12}} whileInView={{opacity:1,y:0}} viewport={{once:true}}
            className="mb-9 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-[#D9684E]">02 / Get the whole picture</p>
              <h2 className="font-display text-3xl font-extrabold leading-tight text-[#202B27] sm:text-4xl">One idea, all the moving parts.</h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-[#68736D]">Eve turns your answers into a practical plan you can actually use, from the first booking to the final toast.</p>
          </motion.div>

          <motion.div initial={{opacity:0,y:18}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{duration:0.45}}
            className="overflow-hidden border border-[#DADDD2] bg-[#FBFAF6] shadow-[0_22px_55px_rgba(38,52,43,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E7E6DD] px-4 py-4 sm:px-7">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#89938C]">A little preview</p>
                <p className="mt-1 font-display text-base font-extrabold text-[#202B27]">{selectedEvent?`${selectedEvent.label} in Jaipur`:"A celebration in Jaipur"}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-2 text-[10px] font-bold text-[#315C4C] sm:inline-flex sm:text-xs"><span className="h-2 w-2 rounded-full bg-[#6EAD7B]"/>Your plan, ready to make yours</span>
                <button type="button" onClick={()=>onStart(selectedEvent?.type,selectedEvent?.label)} disabled={!selectedEvent}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#214E43] px-3 py-2 text-[10px] font-extrabold text-white transition-colors hover:bg-[#173D34] disabled:cursor-not-allowed disabled:bg-[#DADDD2] disabled:text-[#89938C] sm:px-4 sm:text-xs">
                  {selectedEvent?`Plan my ${selectedEvent.label}`:"Choose an event"}<ArrowRight size={13}/>
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-[1.15fr_0.85fr]">
              <div className="px-4 py-6 sm:px-7 sm:py-8">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-extrabold text-[#202B27] sm:text-base">The day, at a glance</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#89938C]">Saturday · 12 October</span>
                </div>
                <div className="space-y-0">
                  {[
                    {time:"09:00",task:"Welcome & venue setup",who:"Your crew",color:"#D9684E"},
                    {time:"12:30",task:"Lunch is served",who:"Catering",color:"#719879"},
                    {time:"16:00",task:"Ceremony & celebrations",who:"Everyone",color:"#D5A637"},
                  ].map(({time,task,who,color},index)=>(
                    <div key={time} className="grid grid-cols-[52px_14px_1fr] gap-3 sm:grid-cols-[64px_16px_1fr] sm:gap-4">
                      <span className="pt-0.5 text-[10px] font-extrabold text-[#68736D] sm:text-xs">{time}</span>
                      <div className="flex flex-col items-center">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{background:color}}/>
                        {index<2&&<span className="mt-1 min-h-9 w-px flex-1 bg-[#DADDD2]"/>}
                      </div>
                      <div className="pb-5">
                        <p className="text-xs font-extrabold text-[#202B27] sm:text-sm">{task}</p>
                        <p className="mt-1 text-[10px] text-[#89938C] sm:text-xs">{who}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#E7E6DD] bg-[#F4F3EC] px-4 py-6 sm:px-7 sm:py-8 md:border-l md:border-t-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-sm font-extrabold text-[#202B27] sm:text-base">Budget at a glance</h3>
                    <p className="mt-1 text-[10px] text-[#89938C] sm:text-xs">Thoughtfully split across the essentials</p>
                  </div>
                  <span className="font-display text-lg font-extrabold text-[#315C4C] sm:text-xl">₹8.5L</span>
                </div>
                <div className="mt-6 space-y-4">
                  {[
                    {label:"Venue & decor",value:"₹3.4L",width:"72%",color:"#315C4C"},
                    {label:"Food & drinks",value:"₹2.6L",width:"58%",color:"#D9684E"},
                    {label:"Photo & music",value:"₹1.5L",width:"38%",color:"#D5A637"},
                  ].map(({label,value,width,color})=>(
                    <div key={label}>
                      <div className="mb-2 flex justify-between gap-3 text-[10px] font-bold text-[#58645E] sm:text-xs"><span>{label}</span><span>{value}</span></div>
                      <div className="h-1.5 bg-[#E4E4D9]"><motion.div initial={{width:0}} whileInView={{width}} viewport={{once:true}} transition={{duration:0.8,ease:"easeOut"}} className="h-full" style={{background:color}}/></div>
                    </div>
                  ))}
                </div>
                <div className="mt-7 flex flex-wrap gap-2 border-t border-[#E0DFD4] pt-5">
                  {["Vendor shortlist","Smart checklist","Day-of timeline"].map(label=>(
                    <span key={label} className="inline-flex items-center gap-1.5 text-[9px] font-bold text-[#315C4C] sm:text-[10px]"><CheckCircle2 size={12} className="text-[#719879]"/>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative z-10 scroll-mt-8 px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center sm:mb-14">
            <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-[#D9684E]">03 / Simple from the start</p>
            <motion.h2 initial={{opacity:0,y:8}} whileInView={{opacity:1,y:0}} viewport={{once:true}}
              className="font-display text-3xl font-extrabold text-[#202B27] sm:text-4xl">Your idea becomes a day to remember.</motion.h2>
          </div>

          <div className="relative grid grid-cols-1 gap-7 sm:grid-cols-3 sm:gap-5">
            <div className="absolute left-[16%] right-[16%] top-6 hidden h-px bg-[#DADDD2] sm:block" aria-hidden="true"/>
            {STEPS.map(({n,label,Icon:I,color,bg},i)=>(
              <motion.div key={i}
                initial={{opacity:0,y:16}} whileInView={{opacity:1,y:0}}
                viewport={{once:true}} transition={{delay:i*0.1,duration:0.35}}
                className="relative flex gap-4 sm:flex-col sm:items-center sm:text-center">
                <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-4 border-[#F8F7F2]" style={{background:bg}}>
                  <I size={19} style={{color}}/>
                </div>
                <div className="pt-1 sm:pt-0">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest" style={{color}}>STEP {n}</p>
                  <h3 className="font-display text-base font-extrabold text-[#202B27] sm:text-lg">{label}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-[#68736D] sm:text-sm">
                    {i===0 && "Answer a few thoughtful questions about the occasion, guest list, date and budget."}
                    {i===1 && "Get a tailored timeline, budget breakdown, vendor shortlist and clear checklist."}
                    {i===2 && "Keep every detail in view and feel ready when the day finally arrives."}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="relative z-10 px-5 py-12 sm:px-8 sm:py-16 text-center bg-[#214E43] text-white">
        <motion.div initial={{opacity:0,y:16}} whileInView={{opacity:1,y:0}} viewport={{once:true}}
          className="max-w-2xl mx-auto">
          <div className="max-w-2xl mx-auto">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F6C65B] mb-4">Your event starts here</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold font-display text-white mb-3">
              Ready to plan something magical?
            </h2>
            <p className="text-[#D8E3D8] mb-8">Bring your people together. We&apos;ll help with the details.</p>
            <motion.button onClick={()=>onStart()}
              whileHover={{y:-3,scale:1.02}} whileTap={{y:1,scale:0.98}}
              className="inline-flex items-center gap-3 px-7 py-4 rounded-xl bg-[#F6C65B] text-[#202B27] font-extrabold text-base hover:bg-[#FFDA82] transition-colors">
              <Wand2 size={18}/> Start Planning — It&apos;s Free
            </motion.button>
          </div>
        </motion.div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT STUDIO
// ═══════════════════════════════════════════════════════════════════════════
function EventStudio({ initialType, initialLabel, onBack }:{ initialType?:string; initialLabel?:string; onBack:()=>void }) {
  const [currentCard, setCurrentCard]   = useState<AssistantCard|null>(null);
  const [answers, setAnswers]           = useState<AnswerEntry[]>(()=>initialType?[{step:1,display:initialLabel??initialType,raw:initialType}]:[]);
  const [collectedData, setCollected]   = useState<EventCollectedData>({
    eventType: initialType ?? null, eventDate: null, guestCount: null, city: null,
    budgetTotal: null, theme: null, venueStyle: null, cateringType: null, specialRequirements: null, eventDetails: {},
  });
  const [isLoading, setIsLoading]       = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [readyToGen, setReadyToGen]     = useState(false);
  const [plan, setPlan]                 = useState<EventPlan|null>(null);
  const [history, setHistory]           = useState<{role:string;content:string}[]>([]);

  const { say, setMood } = useDiya();
  const questionFlow = getEventQuestionFlow(collectedData.eventType);
  const sidebarQuestions = collectedData.eventType ? questionFlow : questionFlow.slice(0, 1);
  const totalQuestions = questionFlow.length;
  const activeColor = collectedData?.eventType ? (EVENT_PAL[collectedData.eventType]?.fg ?? "#6366F1") : "#6366F1";
  const progress = answers.length;

  // Mood sync
  useEffect(()=>{
    if (isGenerating) setMood("thinking");
    else if (isLoading) setMood("thinking");
    else if (readyToGen) setMood("celebrate");
    else setMood("greet");
  },[isLoading,isGenerating,readyToGen,setMood]);

  // Initial call
  useEffect(()=>{
    const init = async () => {
      const msgs: {role:string;content:string}[] = [];
      if (initialType) {
        const label = initialLabel ?? initialType;
        msgs.push({role:"user",content:`I want to plan a ${label}`});
        msgs.push({role:"assistant",content:`A ${label.toLowerCase()} — wonderful choice!`});
        say(`Let's plan an amazing ${label.toLowerCase()} together!`, "greet", 3000);
      }
      setHistory(msgs);
      try {
        const res = await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgs})});
        if (!res.ok) throw new Error("Unable to load the next planning question.");
        const data = await res.json() as {card:AssistantCard;readyToGenerate:boolean;collectedData:EventCollectedData};
        setCurrentCard(data.card);
        if (data.collectedData) setCollected(data.collectedData);
        if (data.readyToGenerate) setReadyToGen(true);
      } catch {
        const fallback = buildNextEventQuestion(msgs);
        setCurrentCard(fallback.card ?? null);
        setCollected(fallback.collectedData);
        setReadyToGen(fallback.readyToGenerate);
      } finally { setIsLoading(false); }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const handleAnswer = useCallback(async (raw:string, display:string) => {
    if (!currentCard) return;
    const step = currentCard.step;
    setAnswers(p=>[...p,{step,display,raw}]);

    // Fire-and-forget AI comment
    fetch("/api/comment",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({step,answer:display,eventType:collectedData.eventType,city:collectedData.city})})
      .then(r=>r.json()).then((d:{comment:string})=>{
        if(d.comment) say(d.comment,"greet",4000);
      }).catch(()=>{});

    const newHistory = [...history,{role:"user",content:display}];
    setHistory(newHistory);
    setIsLoading(true);
    setCurrentCard(null);

    try {
      const res = await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:newHistory})});
      if (!res.ok) throw new Error("Unable to load the next planning question.");
      const data = await res.json() as {card?:AssistantCard;readyToGenerate:boolean;collectedData:EventCollectedData};
      if (data.collectedData) setCollected(data.collectedData);
      if (data.readyToGenerate) {
        setReadyToGen(true);
      } else if (data.card) {
        setHistory(p=>[...p,{role:"assistant",content:data.card?.subtitle??"Got it!"}]);
        setCurrentCard(data.card);
      }
    } catch {
      const fallback = buildNextEventQuestion(newHistory);
      setCollected(fallback.collectedData);
      setReadyToGen(fallback.readyToGenerate);
      setCurrentCard(fallback.card ?? null);
    } finally { setIsLoading(false); }
  },[currentCard,history,collectedData,say]);

  const handleGenerate = useCallback(async () => {
    if (!readyToGen||isGenerating) return;
    setIsGenerating(true);
    say("Building your professional event plan… this is going to be amazing!", "thinking", 15000);
    try {
      const res = await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:history,generatePlan:true,planData:collectedData})});
      if (!res.ok) throw new Error("Unable to generate the plan.");
      const data = await res.json() as {plan:EventPlan};
      setPlan(data.plan);
    } catch {
      say("Something went wrong generating the plan. Please try again.", "worried", 4000);
    } finally { setIsGenerating(false); }
  },[readyToGen,isGenerating,history,collectedData,say]);

  if (plan) return <PlanReveal plan={plan} onBack={onBack}/>;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <FloatingOrbs color={activeColor}/>

      {/* Header */}
      <header className="relative z-20 bg-white/90 backdrop-blur-sm border-b border-[#E5E7EB] px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-[#6366F1] flex items-center justify-center">
            <Sparkles size={15} className="text-white"/>
          </div>
          <span className="font-extrabold text-[#111827] font-display">EventMate.</span>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 flex-1 max-w-xs mx-4">
          <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
            <motion.div className="h-full rounded-full" style={{background:activeColor}}
                animate={{width:`${Math.min((progress/totalQuestions)*100,100)}%`}}
              transition={{type:"spring",stiffness:200,damping:30}}/>
          </div>
              <span className="text-[11px] font-bold text-[#9CA3AF]">{progress}/{totalQuestions}</span>
        </div>

        <button onClick={onBack}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] font-bold text-[#9CA3AF] hover:text-[#6366F1] border border-[#E5E7EB] rounded-xl px-3 py-2 hover:border-[#6366F1]/30 transition-all">
          <RotateCcw size={11}/><span className="hidden sm:inline ml-0.5">New</span>
        </button>
      </header>

      {/* Studio layout */}
      <div className="flex-1 flex flex-col lg:flex-row">

        {/* LEFT — event score */}
        <aside className="relative z-10 flex flex-col overflow-hidden bg-[#F5F2E9] text-[#263B32] lg:min-h-[calc(100vh-57px)] lg:w-[22rem] lg:flex-shrink-0 lg:border-r lg:border-[#DDD9CC]">
          <div className="relative bg-[#1D4238] px-5 pb-4 pt-4 text-white sm:px-7 lg:px-7 lg:pb-5 lg:pt-6">
            <div className="absolute bottom-0 left-0 top-0 w-1 bg-[#D7B45A]" aria-hidden="true"/>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-[#E9C777]">The event score</p>
                <h2 className="mt-1 font-display text-lg font-extrabold leading-tight sm:text-xl">From idea to occasion</h2>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-extrabold leading-none text-[#F4D991]">{String(answers.length).padStart(2,"0")}<span className="text-sm text-white/45"> / {String(totalQuestions).padStart(2,"0")}</span></p>
                <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-white/55">details gathered</p>
              </div>
            </div>
            <div className="mt-4 h-[2px] bg-white/15">
              <motion.div className="h-full bg-[#E9C777]" animate={{width:`${answers.length/totalQuestions*100}%`}} transition={{duration:0.45}}/>
            </div>
          </div>

          <div className="relative flex-1 px-5 py-4 sm:px-7 lg:px-7 lg:py-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#89938C]">The planning arc</p>
                <p className="mt-1 text-xs text-[#68756B]">One thoughtful detail at a time</p>
              </div>
              <Sparkles size={16} className="text-[#B58B38]"/>
            </div>

            <div className="relative">
              <div className="absolute bottom-3 left-[11px] top-3 w-px bg-[#DAD7CB]" aria-hidden="true"/>
              <div className="space-y-1">
                {sidebarQuestions.map(question=>{
                  const answer=answers.find(entry=>entry.step===question.step);
                  const isCurrent=!answer&&question.step===currentCard?.step;
                  const Icon=QUESTION_ICONS[question.key]??STEP_ICONS[question.step]??Sparkles;
                  return (
                    <motion.div key={question.key} initial={answer?{opacity:0,x:-8}:false} animate={{opacity:1,x:0}} exit={{opacity:0}}
                      className={`relative flex min-h-8 items-center gap-2.5 rounded-md px-1.5 py-1 ${answer||isCurrent?"flex":"hidden lg:flex"} ${isCurrent?"bg-white shadow-[0_2px_8px_rgba(43,54,44,0.06)] ring-1 ring-[#E5DFCE]":""}`}>
                      <span className={`relative z-10 flex h-[23px] w-[23px] flex-shrink-0 items-center justify-center rounded-full border bg-[#F5F2E9] ${answer?"border-[#547761] text-[#41654D]":isCurrent?"border-[#B58B38] text-[#A57C2F]":"border-[#DAD7CB] text-[#929B90]"}`}>
                        {answer?<Check size={11} strokeWidth={3}/>:<Icon size={10}/>}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[11px] ${answer?"font-bold text-[#33463B]":isCurrent?"font-extrabold text-[#344B3B]":"font-medium text-[#788278]"}`}>{answer?.display??question.label}</span>
                      {isCurrent&&<span className="flex-shrink-0 text-[8px] font-extrabold uppercase tracking-[0.14em] text-[#A57C2F]">Now</span>}
                      {answer&&<span className="flex-shrink-0 font-display text-[8px] font-bold text-[#B58B38]">{String(question.step).padStart(2,"0")}</span>}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-3 border-t border-[#DDD9CC] bg-[#EAE6D9] px-5 py-2.5 sm:px-7 lg:px-6 lg:py-3">
            <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F2E9] ring-1 ring-[#D8D2C2] lg:h-[72px] lg:w-[72px]">
              <Diya size={48} className="lg:hidden"/>
              <div className="hidden lg:block"><Diya size={66}/></div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-xs font-extrabold text-[#263B32]">Eve <span className="font-normal text-[#89938C]">· your host</span></p>
                <span className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider text-[#7F8F7F]">{isLoading?"Thinking":isGenerating?"Planning":readyToGen?"Ready":"With you"}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* RIGHT — Question stage */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          {/* Mobile pills */}
          {answers.length>0&&(
            <div className="lg:hidden flex flex-wrap gap-2 mb-6 w-full max-w-lg">
              {answers.map(a=><AnswerPill key={a.step} step={a.step} value={a.display} color={activeColor}/>)}
            </div>
          )}

          <div className="w-full max-w-lg">
            <AnimatePresence mode="wait">
              {isLoading&&!currentCard&&(
                <motion.div key="loading" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                  className="flex flex-col items-center gap-4 py-8">
                  <div className="flex gap-1.5">
                    {[0,1,2].map(i=>(
                      <motion.div key={i} className="w-2.5 h-2.5 rounded-full" style={{background:activeColor}}
                        animate={{y:[0,-10,0],opacity:[0.3,1,0.3]}}
                        transition={{duration:0.7,repeat:Infinity,delay:i*0.15}}/>
                    ))}
                  </div>
                  <p className="text-sm text-[#9CA3AF] font-medium">Eve is thinking…</p>
                </motion.div>
              )}

              {isGenerating&&(
                <motion.div key="gen" initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} exit={{opacity:0}}
                  className="relative isolate flex w-full flex-col items-center overflow-hidden rounded-lg border border-[#E3DFD2] bg-[#F5F2E9] px-5 py-8 text-center sm:py-10">
                  <div className="pointer-events-none absolute inset-0 -z-10 opacity-40" aria-hidden="true"
                    style={{backgroundImage:"radial-gradient(#BFCDBF 0.8px, transparent 0.8px)",backgroundSize:"18px 18px"}} />
                  <motion.div
                    initial={{opacity:0,y:-6}}
                    animate={{opacity:1,y:0}}
                    className="mb-1 inline-flex items-center gap-2 rounded-full border border-[#DAD7CB] bg-[#FFFEFA] px-3 py-1.5 text-[9px] font-extrabold uppercase text-[#547761]"
                  >
                    <motion.span className="h-1.5 w-1.5 rounded-full bg-[#B58B38]"
                      animate={{scale:[1,1.5,1],opacity:[0.6,1,0.6]}}
                      transition={{duration:1.4,repeat:Infinity}} />
                    Event plan in the works
                  </motion.div>
                  <DiyaTypingIndicator active={true}/>
                  <div className="mt-5">
                    <p className="font-display text-xl font-extrabold text-[#263B32]">Gathering the good stuff</p>
                    <p className="mt-1 text-sm text-[#788278]">Your event details are becoming a thoughtful plan.</p>
                  </div>
                  <div className="mt-6 flex w-full max-w-[280px] items-center justify-between gap-2 text-[9px] font-bold text-[#68756B]">
                    {["Your details","The schedule","Finishing touches"].map((label,index)=>(
                      <div key={label} className="flex flex-1 flex-col items-center gap-2">
                        <div className="relative h-1 w-full overflow-hidden rounded-full bg-[#DAD7CB]">
                          <motion.div
                            className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-[#547761]"
                            animate={{x:["-100%","200%"]}}
                            transition={{duration:1.8,repeat:Infinity,ease:"easeInOut",delay:index*0.22}}
                          />
                        </div>
                        <span className="text-center leading-tight">{label}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {readyToGen&&!isGenerating&&(
                <motion.div key="ready" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0}}
                  className="flex flex-col items-center gap-5 py-4 text-center">
                  <motion.div animate={{scale:[1,1.04,1]}} transition={{duration:2,repeat:Infinity,ease:"easeInOut"}}>
                    <Diya moodOverride="celebrate" size={160}/>
                  </motion.div>
                  <div>
                    <p className="text-2xl font-extrabold text-[#111827] font-display">All set!</p>
                    <p className="text-sm text-[#9CA3AF] mt-1">I have everything I need.</p>
                  </div>
                  <motion.button onClick={handleGenerate}
                    whileHover={{scale:1.04,boxShadow:`0 12px 32px ${activeColor}40`}} whileTap={{scale:0.96}}
                    className="flex items-center gap-3 px-8 py-4 rounded-2xl text-white font-bold text-base"
                    style={{background:activeColor}}>
                    <Wand2 size={18}/> Generate My Event Plan <ArrowRight size={17}/>
                  </motion.button>
                  <div className="flex flex-wrap gap-2 justify-center mt-1">
                    {answers.map(a=><AnswerPill key={a.step} step={a.step} value={a.display} color={activeColor}/>)}
                  </div>
                </motion.div>
              )}

              {currentCard&&!readyToGen&&(
                <SceneCard key={`card-${currentCard.step}`} card={currentCard} onAnswer={handleAnswer}/>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Root
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState<"landing"|"studio">("landing");
  const [initType, setInitType] = useState<string|undefined>();
  const [initLabel, setInitLabel] = useState<string|undefined>();

  const handleStart = useCallback((type?:string, label?:string)=>{
    setInitType(type); setInitLabel(label); setScreen("studio");
  },[]);

  return (
    <AnimatePresence mode="wait">
      {screen==="landing"?(
        <motion.div key="landing" className="landing-screen" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,y:-20}}>
          <Landing onStart={handleStart}/>
        </motion.div>
      ):(
        <motion.div key="studio" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
          <EventStudio initialType={initType} initialLabel={initLabel} onBack={()=>setScreen("landing")}/>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
