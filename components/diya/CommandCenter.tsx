"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2, ChevronRight, Clock, CloudRain, Copy, PartyPopper, RefreshCw,
  RotateCcw, Users, WifiOff,
} from "lucide-react";
import { Diya } from "./Diya";
import { DiyaJourneyStepper } from "./DiyaJourneyStepper";
import { useDiya } from "@/lib/diyaStore";
import { useLiveEvent, type RunSnapshot } from "@/lib/useLiveEvent";
import type { RunChange, RunPlan } from "@/lib/run/types";

interface OwnerMessage {
  taskId: string;
  owner: string;
  message: string;
  whatsappUrl: string | null;
}

interface RunOptionView {
  title: string;
  tradeoffs: string[];
  rupeeImpact: number;
  report: { affectedTasks: { id: string; task: string }[]; newTimes: { taskId: string; before: string; after: string }[] };
  plan: RunPlan;
}

interface ProposalView {
  proposalId: string;
  version: number;
  changes: RunChange[];
  impact: { severity: "low" | "medium" | "high" };
  options: RunOptionView[];
  idempotencyKey: string;
}

interface QueuedChange {
  id: string;
  text?: string;
  action?: string;
  taskId?: string;
}

interface SummaryView {
  plannedBudget: number;
  actualBudget: number;
  tasksOnTime: number;
  tasksDelayed: number;
  tasksPending: number;
  changesHandled: number;
  lessons: string[];
}

interface Props {
  eventId: string;
  organizerToken: string;
  plan: RunPlan;
  onBack: () => void;
}

function getNowNext(plan: RunPlan, now: number) {
  const pending = plan.timeline
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const current = pending.find((task) => {
    const start = Date.parse(task.startAt);
    return start <= now && now < start + task.durationMin * 60_000;
  }) ?? pending.find((task) => task.status === "in_progress")
    ?? pending.find((task) => Date.parse(task.startAt) >= now)
    ?? pending[0];
  const next = current
    ? pending.find((task) => task.id !== current.id && Date.parse(task.startAt) >= Date.parse(current.startAt))
    : undefined;
  return { current, next };
}

function auditText(entry: RunSnapshot["audit"][number]): string {
  const payload = entry.payload ?? {};
  if (entry.type === "LOCKED") return "The event plan was locked with five prepared contingencies.";
  if (entry.type === "APPLIED") return `Applied ${String(payload.note ?? "a verified event update")} (version ${String(payload.version ?? "")}).`;
  if (entry.type === "NOTIFY") return "WhatsApp-ready updates were prepared for affected task owners.";
  if (entry.type === "NOTIFY_FAILED") return "The change was applied; owner message drafting needs a retry.";
  if (entry.type === "CLARIFICATION") return `Asked for clarification: ${String(payload.question ?? "")}`;
  if (entry.type === "TEMPLATE_SAVED") return `Saved “${String(payload.name ?? "event")}” as a template.`;
  const note = typeof payload.note === "string" ? ` — ${payload.note}` : "";
  return `${entry.type.replaceAll("_", " ").toLowerCase()}${note}`;
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

export function CommandCenter({ eventId, organizerToken, plan: initialPlan, onBack }: Props) {
  const { snapshot, isError, isLoading, refresh } = useLiveEvent(eventId, organizerToken, initialPlan);
  const version = snapshot?.version ?? 1;
  const { say, setMood } = useDiya();
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [optimisticPlan, setOptimisticPlan] = useState<RunPlan | null>(null);
  const [notifications, setNotifications] = useState<OwnerMessage[]>([]);
  const [notificationRetry, setNotificationRetry] = useState<{ changes: RunChange[]; taskIds: string[]; version: number } | null>(null);
  const [queued, setQueued] = useState<QueuedChange[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SummaryView | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateSaved, setTemplateSaved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const plan = optimisticPlan ?? snapshot?.plan ?? initialPlan;
  const queueKey = `eventmate-run-queue:${eventId}`;

  const tasks = plan.timeline;
  const completed = tasks.filter((task) => task.status === "done" || task.status === "cancelled").length;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const { current, next } = useMemo(() => getNowNext(plan, clock), [plan, clock]);
  const costume = ["wedding", "birthday", "community", "corporate", "festival"].includes(plan.eventType)
    ? plan.eventType as "wedding" | "birthday" | "community" | "corporate" | "festival"
    : "none";

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    const readOnline = () => setIsOnline(navigator.onLine);
    readOnline();
    window.addEventListener("online", readOnline);
    window.addEventListener("offline", readOnline);
    try {
      const saved = localStorage.getItem(queueKey);
      if (saved) setQueued(JSON.parse(saved) as QueuedChange[]);
    } catch (reason) {
      console.error("Unable to restore queued event updates.", reason);
      setError("A saved offline update could not be read from this browser.");
    }
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", readOnline);
      window.removeEventListener("offline", readOnline);
    };
  }, [queueKey]);

  useEffect(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(queued));
    } catch (reason) {
      console.error("Unable to persist offline event updates.", reason);
      setError("This browser could not save the offline queue. Keep this page open and reconnect.");
    }
  }, [queueKey, queued]);

  useEffect(() => {
    if (proposal && proposal.version !== version) {
      setProposal(null);
      setError("The plan changed while you were reviewing. The latest version is loaded; submit your update again.");
    }
  }, [proposal, version]);

  useEffect(() => {
    if (busy) setMood("thinking");
    else if (proposal?.impact.severity === "high") setMood("worried");
  }, [busy, proposal?.impact.severity, setMood]);

  const persistQueuedChange = (change: QueuedChange) => {
    setQueued((existing) => existing.some((entry) => entry.id === change.id) ? existing : [...existing, change]);
  };

  const submitChange = useCallback(async (change: QueuedChange, removeFromQueue = false) => {
    if (!isOnline) {
      persistQueuedChange(change);
      setError("Offline — your update is saved and will sync when you're back online.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({ version, text: change.text, action: change.action, taskId: change.taskId }),
      });
      const result = await readJson<ProposalView & { clarifyingQuestion?: string }>(response);
      if (result.clarifyingQuestion) {
        setError(result.clarifyingQuestion);
        if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
        return;
      }
      if (!result.proposalId || !result.options) throw new Error("No verified options were returned. Your update is still available; retry it.");
      setProposal({ ...result, idempotencyKey: crypto.randomUUID() });
      setInput("");
      if (removeFromQueue) setQueued((existing) => existing.filter((entry) => entry.id !== change.id));
    } catch (reason) {
      if (reason instanceof TypeError || !navigator.onLine) {
        setIsOnline(false);
        persistQueuedChange(change);
        setError("Offline — your update is saved and will sync when you're back online.");
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to prepare this change. Your input is still here.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [eventId, isOnline, organizerToken, refresh, version]);

  useEffect(() => {
    if (!isOnline || queued.length === 0 || busy || proposal) return;
    const timer = window.setTimeout(() => void submitChange(queued[0], true), 1000);
    return () => window.clearTimeout(timer);
  }, [busy, isOnline, proposal, queued, submitChange]);

  const approve = async (optionIndex: number) => {
    if (!proposal) return;
    const approvedProposal = proposal;
    const approvedOption = proposal.options[optionIndex];
    if (!approvedOption) return;
    setBusy(true);
    setError("");
    const affectedTaskIds = approvedOption.report.affectedTasks.map((task) => task.id);
    setNotificationRetry({ changes: approvedProposal.changes, taskIds: affectedTaskIds, version: approvedProposal.version + 1 });
    setOptimisticPlan(approvedOption.plan);
    setProposal(null);
    try {
      const response = await fetch(`/api/run/${eventId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({
          proposalId: approvedProposal.proposalId,
          optionIndex,
          version: approvedProposal.version,
          idempotencyKey: approvedProposal.idempotencyKey,
        }),
      });
      const result = await readJson<{ version: number; plan: RunPlan; notifications: OwnerMessage[]; notificationError: string | null }>(response);
      setNotifications(result.notifications);
      setError(result.notificationError ?? "");
      await refresh();
      setOptimisticPlan(null);
      say("The approved adjustment is in place. Everyone's next step is clear.", "celebrate", 4200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply the option. Your selected update is preserved for retry.");
      setOptimisticPlan(null);
      await refresh();
      if (!(reason instanceof Error && /plan changed|stale|refresh/i.test(reason.message))) {
        setProposal(approvedProposal);
      }
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({ version, idempotencyKey: crypto.randomUUID() }),
      });
      await readJson(response);
      await refresh();
      say("A new version has restored the previous schedule.", "celebrate", 3200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revert. Refresh and retry.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retryNotifications = async () => {
    if (!notificationRetry) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/run/${eventId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify(notificationRetry),
      });
      const result = await readJson<{ notifications: OwnerMessage[] }>(response);
      setNotifications(result.notifications);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message drafts could not be prepared. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const loadSummary = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/summary`, { headers: { Authorization: `Bearer ${organizerToken}` } });
      setSummary(await readJson<SummaryView>(response));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to prepare the event summary. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/run/${eventId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({ name: templateName }),
      });
      await readJson(response);
      setTemplateSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the template. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const submitText = () => {
    if (input.trim()) void submitChange({ id: crypto.randomUUID(), text: input.trim() });
  };
  const quickAction = (action: string, taskId?: string) => void submitChange({ id: crypto.randomUUID(), action, taskId });
  const audit = [...(snapshot?.audit ?? [])].reverse();
  const ownerLinks = snapshot?.ownerLinks ?? [];
  const riskList = snapshot?.risks ?? [];

  return (
    <div className="min-h-screen bg-[#F5F2E9] text-[#263B32]">
      <header className="flex items-center justify-between border-b border-[#DDD9CC] bg-[#FFFEFA] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <PartyPopper size={17} className="text-[#A77D2B]" />
          <span className="font-display font-extrabold">Event Day Command Center</span>
          <span className="rounded-full bg-[#E4EFE5] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#315C4C]">Live · v{version}</span>
        </div>
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCD6C8] px-3 py-2 text-xs font-bold text-[#52645A] hover:bg-[#F7F2E5]">
          <RotateCcw size={12} /> Plan
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
        <DiyaJourneyStepper current="RUN" />
        {(isError || !isOnline) && <div role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><WifiOff size={15} />Offline or unable to refresh — {queued.length ? "queued updates will sync when connected." : "showing the latest cached plan."}</div>}
        {!isOnline && queued.length > 0 && <div className="mt-2 text-[11px] font-semibold text-amber-900">Offline, will sync ({queued.length} update{queued.length === 1 ? "" : "s"}).</div>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <section className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="rounded-3xl bg-[#173F35] p-5 text-white sm:p-6">
            <div className="flex items-start gap-4">
              <Diya size={86} costume={costume} moodOverride={proposal?.impact.severity === "high" ? "worried" : busy ? "thinking" : "greet"} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#F0D38C]">Now</p>
                <p className="mt-1 font-display text-xl font-extrabold">{current?.task ?? "All wrapped up — great work!"}</p>
                {current && <p className="mt-1 flex items-center gap-1.5 text-xs text-[#D8E5DC]"><Clock size={12} />{current.time} · {current.owner}</p>}
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#D8E5DC]"><span>Event-day progress</span><span>{completed}/{tasks.length} · {progress}%</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                    <motion.div className="h-full rounded-full bg-[#E7BD68]" animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-2xl bg-white/10 p-3">
              <ChevronRight size={15} className="text-[#F0D38C]" />
              <div><p className="text-[9px] font-bold uppercase tracking-widest text-[#D8E5DC]">Next</p><p className="text-sm font-bold">{next ? `${next.task} · ${next.time}` : "Nothing left on the schedule"}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-[#E6E0D3] bg-white p-5">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#68796F]">Quick updates</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button disabled={!current || busy} onClick={() => quickAction("delay-15", current?.id)} className="rounded-xl border border-[#E6E0D3] p-2.5 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40">Delay +15</button>
              <button disabled={!current || busy} onClick={() => quickAction("delay-30", current?.id)} className="rounded-xl border border-[#E6E0D3] p-2.5 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40">Delay +30</button>
              <button disabled={busy} onClick={() => quickAction("more-guests")} className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#E6E0D3] p-2.5 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40"><Users size={13} /> More guests</button>
              <button disabled={busy} onClick={() => quickAction("rain")} className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#E6E0D3] p-2.5 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40"><CloudRain size={13} /> Rain</button>
              <button disabled={busy} onClick={() => quickAction("venue-issue")} className="col-span-2 inline-flex items-center justify-center gap-1 rounded-xl border border-[#E6E0D3] p-2.5 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40"><Building2 size={13} /> Venue issue</button>
            </div>
            {tasks.some((task) => task.vendorName) && (
              <div className="mt-3 flex items-center gap-2">
                <select id="cancelled-vendor-task" className="min-w-0 flex-1 rounded-lg border border-[#DCD6C8] bg-white px-2 py-2 text-xs">
                  {tasks.filter((task) => task.vendorName).map((task) => <option key={task.id} value={task.id}>{task.vendorName} · {task.task}</option>)}
                </select>
                <button disabled={busy} onClick={() => {
                  const select = document.getElementById("cancelled-vendor-task") as HTMLSelectElement | null;
                  if (select?.value) quickAction("vendor-cancelled", select.value);
                }} className="rounded-lg border border-[#E6E0D3] px-3 py-2 text-xs font-bold hover:bg-[#F7F2E5] disabled:opacity-40">Vendor cancelled</button>
              </div>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-[#E6E0D3] bg-white p-4 sm:p-5">
          <h2 className="font-display text-sm font-extrabold">Tell Eve what changed</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={input} onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitText(); } }}
              maxLength={1200} placeholder="e.g. Caterer is 40 minutes late and 30 more guests are coming"
              className="min-w-0 flex-1 rounded-xl border border-[#DCD6C8] px-3 py-3 text-sm outline-none focus:border-[#A77D2B] focus:ring-2 focus:ring-[#A77D2B]/15" />
            <button disabled={busy || !input.trim()} onClick={submitText} className="rounded-xl bg-[#173F35] px-5 py-3 text-xs font-extrabold text-white hover:bg-[#245747] disabled:opacity-45">
              {busy ? "Working…" : "Analyze change"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-[#68796F]">Changes are previewed and verified before anything in the plan is changed.</p>
        </section>

        <AnimatePresence>
          {proposal && (
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="mt-4 rounded-3xl border border-[#DCCB9D] bg-[#FFFEFA] p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#A77D2B]">Verified change preview · {proposal.impact.severity} impact</p>
                  <h2 className="mt-1 font-display text-lg font-extrabold">Choose a safe adjustment</h2></div>
                <button onClick={() => setProposal(null)} className="text-xs font-bold text-[#68796F]">Reject all</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {proposal.options.map((option, index) => {
                  const beforeTasks = new Map(plan.timeline.map((task) => [task.id, task]));
                  return (
                    <article key={`${option.title}-${index}`} className="rounded-2xl border border-[#E6E0D3] bg-white p-4">
                      <p className="text-xs font-extrabold text-[#263B32]">{option.title}</p>
                      <p className={`mt-1 text-sm font-extrabold ${option.rupeeImpact > 0 ? "text-red-700" : "text-[#315C4C]"}`}>
                        {option.rupeeImpact > 0 ? "+" : ""}₹{Math.abs(option.rupeeImpact).toLocaleString("en-IN")} {option.rupeeImpact < 0 ? "saved" : "impact"}
                      </p>
                      <ul className="mt-3 space-y-1.5 text-[11px] text-[#52645A]">{option.tradeoffs.map((tradeoff) => <li key={tradeoff}>• {tradeoff}</li>)}</ul>
                      <div className="mt-3 space-y-1 border-t border-[#F0ECE3] pt-2">
                        {option.report.newTimes.slice(0, 4).map((change) => {
                          const task = beforeTasks.get(change.taskId);
                          const after = option.plan.timeline.find((entry) => entry.id === change.taskId);
                          return <p key={change.taskId} className="text-[10px] text-[#68796F]">{task?.task}: {task?.time} → {after?.time}</p>;
                        })}
                        {option.report.newTimes.length === 0 && option.report.affectedTasks.slice(0, 3).map((task) => <p key={task.id} className="text-[10px] text-[#68796F]">Affected: {task.task}</p>)}
                      </div>
                      <button disabled={busy} onClick={() => void approve(index)} className="mt-4 w-full rounded-xl bg-[#173F35] py-2.5 text-xs font-extrabold text-white hover:bg-[#245747] disabled:opacity-50">Approve this option</button>
                    </article>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {notifications.length > 0 && <section className="mt-4 rounded-3xl border border-[#D7E5D8] bg-[#F4F8F2] p-4">
          <h2 className="font-display text-sm font-extrabold">Owner updates · review before sending</h2>
          <div className="mt-3 space-y-2">{notifications.map((notice) => (
            <div key={notice.taskId} className="flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-xs text-[#52645A]"><strong>{notice.owner}:</strong> {notice.message}</p>
              <button onClick={() => navigator.clipboard.writeText(notice.message).then(() => say("Message copied for you.", "greet", 1800)).catch(() => setError("Clipboard access is unavailable in this browser."))}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#DCD6C8] px-3 py-2 text-[10px] font-bold"><Copy size={12} /> Copy</button>
              {notice.whatsappUrl && <a target="_blank" rel="noreferrer" href={notice.whatsappUrl} className="rounded-lg bg-[#E4EFE5] px-3 py-2 text-center text-[10px] font-bold text-[#315C4C]">Open in WhatsApp</a>}
            </div>
          ))}</div>
        </section>}
        {error.includes("Retry notifications") && <button onClick={() => void retryNotifications()} className="mt-3 rounded-xl border border-[#DCD6C8] px-3 py-2 text-xs font-bold"><RefreshCw size={12} className="mr-1 inline" />Retry notifications</button>}

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-[#E6E0D3] bg-white p-4 sm:p-5">
            <h2 className="font-display text-sm font-extrabold">Plan B ready</h2>
            <p className="mt-1 text-[10px] text-[#68796F]">Prepared for this event, so matching contingencies surface before new suggestions.</p>
            <div className="mt-3 space-y-2">
              {riskList.map((risk) => <div key={risk.id ?? risk.title} className="flex items-start justify-between gap-3 rounded-xl bg-[#F8F7F2] p-3">
                <div><p className="text-xs font-bold">{risk.title}</p><p className="mt-0.5 text-[10px] text-[#68796F]">{risk.triggerType.replaceAll("_", " ")} · {risk.likelihood} likelihood</p></div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${risk.status === "triggered" ? "bg-[#F9E8D0] text-[#855B22]" : "bg-[#E4EFE5] text-[#315C4C]"}`}>{risk.status}</span>
              </div>)}
              {riskList.length === 0 && <p className="text-xs text-[#68796F]">Loading prepared contingencies…</p>}
            </div>
          </div>

          <div className="rounded-3xl border border-[#E6E0D3] bg-white p-4 sm:p-5">
            <h2 className="font-display text-sm font-extrabold">Owner links</h2>
            <p className="mt-1 text-[10px] text-[#68796F]">Task-only links expire after 90 days. Owners can mark done or request a delay.</p>
            <div className="mt-3 space-y-2">{ownerLinks.map((link) => {
              const taskLabels = tasks.filter((task) => link.task_ids.includes(task.id)).map((task) => task.task);
              const url = `${window.location.origin}/t/${link.token}`;
              return <div key={link.token} className="flex items-center gap-2 rounded-xl bg-[#F8F7F2] p-2.5">
                <p className="min-w-0 flex-1 truncate text-[10px] text-[#52645A]">{taskLabels.join(", ")}</p>
                <button onClick={() => navigator.clipboard.writeText(url).then(() => say("Owner link copied.", "greet", 1800)).catch(() => setError("Clipboard access is unavailable in this browser."))}
                  className="shrink-0 rounded-lg border border-[#DCD6C8] p-2 text-[10px] font-bold"><Copy size={12} /></button>
              </div>;
            })}</div>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-[#E6E0D3] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="font-display text-sm font-extrabold">What changed and why</h2><p className="mt-1 text-[10px] text-[#68796F]">Append-only decision history · every applied change creates a new plan version.</p></div>
            {version > 1 && <button disabled={busy} onClick={() => void revert()} className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCD6C8] px-3 py-2 text-[10px] font-bold disabled:opacity-50"><RotateCcw size={12} /> Revert to previous version</button>}
          </div>
          <ol className="mt-4 space-y-3 border-l border-[#DDD9CC] pl-4">
            {audit.map((entry) => <li key={entry.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#A77D2B]" />
              <p className="text-xs font-semibold text-[#344B3B]">{auditText(entry)}</p>
              <p className="mt-0.5 text-[9px] text-[#89938C]">{new Date(entry.created_at).toLocaleString()} · {entry.actor}</p>
            </li>)}
            {audit.length === 0 && <p className="text-xs text-[#68796F]">The audit trail will appear as event updates are handled.</p>}
          </ol>
        </section>

        {completed === tasks.length && tasks.length > 0 && <section className="mt-4 rounded-3xl border border-[#D7E5D8] bg-[#F4F8F2] p-4 sm:p-5">
          <h2 className="font-display text-sm font-extrabold">After the event</h2>
          <button disabled={busy} onClick={() => void loadSummary()} className="mt-3 rounded-xl bg-[#173F35] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Generate event summary</button>
          {summary && <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <p className="rounded-xl bg-white p-3 text-xs">Planned budget: <strong>₹{summary.plannedBudget.toLocaleString("en-IN")}</strong><br />Actual spend: <strong>₹{summary.actualBudget.toLocaleString("en-IN")}</strong></p>
            <p className="rounded-xl bg-white p-3 text-xs">On time: <strong>{summary.tasksOnTime}</strong> · Delayed: <strong>{summary.tasksDelayed}</strong> · Pending: <strong>{summary.tasksPending}</strong><br />Changes handled: <strong>{summary.changesHandled}</strong></p>
            <ul className="space-y-1 rounded-xl bg-white p-3 text-xs sm:col-span-2">{summary.lessons.map((lesson) => <li key={lesson}>• {lesson}</li>)}</ul>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={80} placeholder="Template name"
                className="min-w-0 flex-1 rounded-xl border border-[#DCD6C8] bg-white px-3 py-2 text-xs outline-none focus:border-[#A77D2B]" />
              <button disabled={busy || templateName.trim().length < 2 || templateSaved} onClick={() => void saveTemplate()} className="rounded-xl border border-[#A77D2B]/40 px-4 py-2 text-xs font-bold disabled:opacity-50">{templateSaved ? "Template saved" : "Save as template"}</button>
            </div>
          </div>}
        </section>}

        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => void refresh()} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#68796F]"><RefreshCw size={12} /> Refresh now</button>
          <span className="text-[9px] text-[#89938C]">Live updates every 3 seconds · {isLoading ? "Refreshing…" : "Connected"}</span>
        </div>
      </main>
    </div>
  );
}
