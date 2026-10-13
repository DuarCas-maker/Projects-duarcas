"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Mic, Send, Square, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Workspace } from "@/lib/workspace-types";
import { isNotebookNote, NOTEBOOK_MAX_TEXT, notebookActionLabels, notebookFieldLabels, notebookTarget, type NotebookAnswer, type NotebookRound, type NotebookProposal } from "@/lib/notebook";
import { notebookWav, NOTEBOOK_AUDIO_RATE } from "@/lib/notebook-audio";
import { operationsFor } from "@/lib/project-operations";
import type { SaveCore } from "./core-management";
import { PROJECT_STATUSES, TASK_STATUSES, MILESTONE_STATUSES } from "@/lib/core-commands";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type Voice = { configured: boolean; enabled: boolean; limitUsd: number; usedUsd: number; month: string; maxSeconds: number };
type NotebookResponse = { notes: Workspace["inbox"]; rounds: NotebookRound[]; state?: Workspace; note?: Workspace["inbox"][number]; voice: Voice; ai: { configured: boolean; enabled: boolean; used: number; limit: number } };
async function requestNotebook(body?: Record<string, unknown>, noteId?: string): Promise<NotebookResponse> {
  const response = await fetch(noteId ? `/api/notebook?noteId=${encodeURIComponent(noteId)}` : "/api/notebook", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json() as NotebookResponse & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operación.");
  return data;
}
const date = (value: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function NotebookPanel({ state, acceptState, openApprovals, initialNoteId }: { state: Workspace; acceptState: (state: Workspace) => void; openApprovals: () => void; initialNoteId?: string }) {
  const [text, setText] = useState(""), [selected, setSelected] = useState(initialNoteId ?? ""), [rounds, setRounds] = useState<NotebookRound[]>([]), [answers, setAnswers] = useState<Record<string, NotebookAnswer>>({});
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [voice, setVoice] = useState<Voice | null>(null), [ai, setAi] = useState<NotebookResponse["ai"] | null>(null), [budget, setBudget] = useState("1"), [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0), [hasAudio, setHasAudio] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null), capture = useRef<{ content: string; id: string } | null>(null), voiceFile = useRef<{ file: File; id: string } | null>(null), recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), active = useRef(true), voiceInput = useRef(false), loadVersion = useRef(0);
  const notes = state.inbox.filter(isNotebookNote).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), note = notes.find(n => n.id === selected), last = rounds.at(-1);
  const refresh = async (id = selected) => {
    const version = ++loadVersion.current;
    const data = await requestNotebook(undefined, id || undefined);
    if (!active.current || version !== loadVersion.current) return;
    setRounds(data.rounds); setVoice(data.voice); setBudget(String(data.voice.limitUsd)); setAi(data.ai);
  };
  useEffect(() => { active.current = true; return () => { active.current = false; if (recorder.current) recorder.current.onstop = null; recorder.current?.state === "recording" && recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); }; }, []);
  useEffect(() => { setRounds([]); setAnswers({}); setError(""); void refresh().catch(e => active.current && setError(e.message)); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!recording) return; const started = Date.now(); const interval = setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= 295 && recorder.current?.state === "recording") recorder.current.stop(); }, 500); return () => clearInterval(interval); }, [recording]);
  const analyze = async (id: string, previous?: NotebookRound, values?: NotebookAnswer[]) => {
    const body = { action: "analyze", noteId: id, previousId: previous?.id ?? null, answers: values ?? [] }, key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try { const data = await requestNotebook({ ...body, requestId: request.current!.id }); if (!active.current) return; setRounds(data.rounds); setAnswers({}); request.current = null; await refresh(id); }
    catch (failure) { request.current = null; throw failure; }
  };
  const send = async () => {
    if (busy || recording || !text.trim()) return; setBusy("Guardando nota…"); setError("");
    const content = text.trim(); if (capture.current?.content !== content) capture.current = { content, id: crypto.randomUUID() };
    try {
      const data = await requestNotebook({ action: "capture", content, requestId: capture.current!.id, inputType: voiceInput.current ? "voice" : "text" });
      if (!active.current || !data.note || !data.state) return;
      acceptState(data.state); setText(""); voiceInput.current = false; capture.current = null; setSelected(data.note.id); setRounds([]); setBusy("Analizando y preparando preguntas…");
      await analyze(data.note.id);
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "No se pudo enviar."); } finally { if (active.current) setBusy(""); }
  };
  const continueAnalysis = async () => {
    if (!note || busy) return; setBusy("Revisando detalles…"); setError("");
    try { await analyze(note.id, last, last?.result.questions.map(q => answers[q.id] ?? { questionId: q.id, selected: [], text: "" })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo analizar."); } finally { setBusy(""); }
  };
  const propose = async () => {
    if (!note || !last || busy) return; setBusy("Enviando a Aprobaciones…"); setError("");
    try { const data = await requestNotebook({ action: "propose", noteId: note.id, roundId: last.id }); if (data.state) acceptState(data.state); openApprovals(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se guardaron las propuestas."); } finally { setBusy(""); }
  };
  const transcribe = async () => {
    if (!voiceFile.current || !active.current) return;
    setBusy("Transcribiendo dictado…"); setError("");
    try {
      const form = new FormData(); form.set("requestId", voiceFile.current.id); form.set("audio", voiceFile.current.file);
      const response = await fetch("/api/notebook/voice", { method: "POST", body: form }), data = await response.json() as { error?: string; text: string; voice: Voice };
      if (!response.ok) { if (response.status !== 409) voiceFile.current.id = crypto.randomUUID(); throw new Error(data.error ?? "No se pudo transcribir."); }
      if (!active.current) return;
      setText(current => `${current}${current ? "\n" : ""}${data.text}`); setVoice(data.voice); voiceInput.current = true; voiceFile.current = null; setHasAudio(false);
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "El dictado no está disponible."); } finally { if (active.current) setBusy(""); }
  };
  const startVoice = async () => {
    if (busy || recording) return; setError(""); setBusy("Abriendo micrófono…");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Este navegador no permite grabar. Puedes escribir o usar el dictado del dispositivo.");
      const input = await navigator.mediaDevices.getUserMedia({ audio: true }); if (!active.current) { input.getTracks().forEach(t => t.stop()); return; }
      stream.current = input; const recording = new MediaRecorder(input), parts: Blob[] = []; recorder.current = recording;
      recording.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recording.onerror = () => { input.getTracks().forEach(t => t.stop()); if (active.current) { setRecording(false); setError("La grabación falló. Puedes volver a dictar o escribir."); } };
      recording.onstop = () => {
        input.getTracks().forEach(t => t.stop()); if (!active.current) return; setRecording(false); setBusy("Preparando audio…");
        void (async () => {
          const context = new AudioContext();
          try {
            const decoded = await context.decodeAudioData(await new Blob(parts, { type: recording.mimeType }).arrayBuffer());
            if (decoded.duration > 300) throw new Error("El dictado supera cinco minutos. Graba uno más corto.");
            const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * NOTEBOOK_AUDIO_RATE), NOTEBOOK_AUDIO_RATE), source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start(); const mono = await offline.startRendering();
            if (!active.current) return;
            voiceFile.current = { file: new File([notebookWav(mono.getChannelData(0))], "dictado.wav", { type: "audio/wav" }), id: crypto.randomUUID() }; setHasAudio(true); await transcribe();
          } catch (failure) { if (active.current) { setError(failure instanceof Error ? failure.message : "No se pudo preparar el audio."); setBusy(""); } } finally { await context.close(); }
        })();
      };
      setSeconds(0); setRecording(true); recording.start();
    } catch (failure) { stream.current?.getTracks().forEach(t => t.stop()); if (active.current) setError(failure instanceof Error ? failure.message : "No se pudo abrir el micrófono."); } finally { if (active.current) setBusy(""); }
  };
  const answer = (id: string, option: string, checked: boolean) => setAnswers(current => { const previous = current[id] ?? { questionId: id, selected: [], text: "" }; return { ...current, [id]: { ...previous, selected: checked ? [...new Set([...previous.selected, option])] : previous.selected.filter(o => o !== option) } }; });
  const complete = last?.result.questions.every(q => { const a = answers[q.id]; return a?.selected.length && (!a.selected.includes("D") || a.text.trim()); });
  return <div className="view-stack narrow notebook-view">
    <section className="page-intro"><div><p className="eyebrow">IDEAS → PREGUNTAS → APROBACIONES</p><h1>Bloc de notas</h1><p>Escribe tus pendientes bajo el nombre de cada proyecto. La IA te ayudará a concretarlos.</p></div></section>
    <section className="panel notebook-compose"><label htmlFor="notebook-text">Tu nota</label><Textarea id="notebook-text" aria-label="Nota del bloc" value={text} maxLength={NOTEBOOK_MAX_TEXT} disabled={!!busy} onChange={e => setText(e.target.value)} placeholder={`${state.projects[0]?.name ?? "Nombre del proyecto A"}:\nPreparar la propuesta y confirmar la fecha de entrega.\n\n${state.projects[1]?.name ?? "Nombre del proyecto B"}:\nActualizar el alcance y revisar los pendientes.`} /><div className="notebook-compose-actions"><div><Button variant="outline" disabled={!!busy || !recording && (!voice?.configured || !voice.enabled || voice.usedUsd >= voice.limitUsd || hasAudio)} onClick={() => recording ? recorder.current?.stop() : void startVoice()}>{recording ? <Square size={15} /> : <Mic size={15} />}{recording ? `Detener · ${seconds}s` : "Dictar"}</Button>{hasAudio && <><Button variant="outline" disabled={!!busy} onClick={() => void transcribe()}>Reintentar transcripción</Button><Button variant="ghost" disabled={!!busy} onClick={() => { voiceFile.current = null; setHasAudio(false); }}>Descartar audio</Button></>}</div><Button disabled={!!busy || recording || !text.trim()} onClick={() => void send()}><Send size={15} />Enviar</Button></div><small className="daily-hint">{text.length}/{NOTEBOOK_MAX_TEXT} · Al enviar se guarda la nota y se vacía el bloc. Revisa la transcripción antes de enviarla.</small>
      <details className="notebook-budget"><summary>Dictado · USD {voice?.usedUsd.toFixed(3) ?? "0.000"} / {voice?.limitUsd.toFixed(2) ?? "1.00"} estimados este mes</summary><p>Hasta cinco minutos por dictado. El límite usa USD 0,003/min como estimación; la factura real puede variar. El análisis del texto se cobra aparte. El audio se conserva en esta pantalla hasta transcribirlo o descartarlo.</p><form onSubmit={e => { e.preventDefault(); if (busy) return; setBusy("Guardando límite…"); setError(""); void requestNotebook({ action: "voice_budget", limitUsd: Number(budget) }).then(data => setVoice(data.voice)).catch(e => setError(e.message)).finally(() => setBusy("")); }}><label>Límite mensual estimado (USD)<Input type="number" min={0} max={50} step="0.01" value={budget} onChange={e => setBudget(e.target.value)} /></label><Button type="submit" variant="outline" disabled={!!busy}>Guardar límite</Button></form></details>
    </section>
    {busy && <p role="status" className="daily-hint">{busy}</p>}{error && <p role="alert" className="core-form-error">{error}</p>}
    <div className="notebook-workspace"><section className="panel notebook-history"><h2><BookOpen size={18} />Historial</h2>{notes.length ? notes.map(n => <button key={n.id} disabled={!!busy || recording} className={selected === n.id ? "selected" : ""} onClick={() => setSelected(n.id)}><strong>{n.content.split("\n").find(line => line.trim())?.slice(0, 75)}</strong><small>{date(n.createdAt)} · {n.status === "processed" ? "En Aprobaciones" : "Por completar"}</small></button>) : <p className="daily-hint">Tus notas enviadas aparecerán aquí.</p>}</section>
    {note && <section className="panel notebook-analysis"><div className="section-heading"><h2>Detalle de la nota</h2><Button variant="ghost" size="sm" disabled={!!busy || recording} onClick={() => void refresh().catch(e => setError(e.message))}><RefreshCw size={14} />Recuperar historial</Button></div><details><summary>Ver nota original · {date(note.createdAt)}</summary><p className="notebook-original">{note.content}</p></details>
      {last && <><p>{last.result.summary}</p>{last.memory?.warning && <p role="status" className="daily-hint">{last.memory.warning}</p>}{last.coverage && <small className="daily-hint">{last.coverage}</small>}{!last.result.questions.length && !last.result.proposals.length && <p className="daily-hint">La nota quedó guardada. No hay cambios para enviar a Aprobaciones; puedes continuar con una nota nueva.</p>}</>}
      {!last && note.status !== "processed" && <Button disabled={!!busy} onClick={() => void continueAnalysis()}><Sparkles size={15} />Analizar nota guardada</Button>}
      {last && last.result.questions.length > 0 && note.status !== "processed" && <form className="notebook-questions" onSubmit={e => { e.preventDefault(); void continueAnalysis(); }}><h3>Ronda {rounds.length} · Puedes seleccionar varias respuestas</h3>{last.result.questions.map((q, index) => <fieldset key={`${last.id}:${q.id}`} disabled={!!busy}><legend>{index + 1}. {q.text}</legend>{(["A", "B", "C", "D"] as const).map(letter => <label key={letter} className="notebook-option"><input type="checkbox" checked={answers[q.id]?.selected.includes(letter) ?? false} onChange={e => answer(q.id, letter, e.target.checked)} /><span><b>{letter}.</b> {letter === "D" ? "Respuesta abierta" : q.options[letter]}</span></label>)}{answers[q.id]?.selected.includes("D") && <Textarea aria-label={`Respuesta abierta: ${q.text}`} maxLength={2000} value={answers[q.id]?.text ?? ""} onChange={e => setAnswers(current => ({ ...current, [q.id]: { ...current[q.id], text: e.target.value } }))} />}</fieldset>)}<Button type="submit" disabled={!!busy || !complete}>Enviar respuestas</Button></form>}
      {last && last.result.proposals.length > 0 && <div className="notebook-proposals">{last.result.proposals.map((p, i) => <article key={i}><strong>{state.projects.find(project => project.id === p.projectId)?.name} · {notebookActionLabels[p.action]}</strong><h3>{p.title}</h3><p>{p.reason}</p><NotebookChanges state={state} proposal={p} /><blockquote>{p.quote}</blockquote></article>)}<Button disabled={!!busy} onClick={() => note.status === "processed" ? openApprovals() : void propose()}>{note.status === "processed" ? "Abrir Aprobaciones" : "Enviar propuestas a Aprobaciones"}</Button></div>}
      {note.status === "processed" && <div className="notebook-statuses">{state.suggestions.filter(s => { try { return JSON.parse(s.payload).notebookId === note.id; } catch { return false; } }).map(s => <p key={s.id}>{s.title} · {s.status === "approved" ? "Aprobada" : s.status === "rejected" ? "Rechazada" : "Pendiente de aprobación"}</p>)}</div>}
      {rounds.length > 0 && <details className="notebook-round-history"><summary>Historial de preguntas y respuestas · {rounds.length} rondas</summary>{rounds.map((r, i) => <article key={r.id}><strong>Ronda {i + 1} · {date(r.createdAt)}</strong><p>{r.result.summary}</p>{r.answers.map(a => { const q = rounds[i - 1]?.result.questions.find(q => q.id === a.questionId); return <div key={a.questionId}><p>{q?.text}</p><p>{a.selected.filter(o => o !== "D").map(o => `${o}: ${q?.options[o as "A" | "B" | "C"] ?? ""}`).join(" · ")}{a.text && ` · D: ${a.text}`}</p></div>; })}{r.result.questions.map(q => <p key={q.id}>{q.text} · A: {q.options.A} · B: {q.options.B} · C: {q.options.C} · D: abierta</p>)}</article>)}</details>}
    </section>}</div><small className="daily-hint">{ai ? `${ai.used}/${ai.limit} consultas de IA hoy (compartidas). ` : ""}Las propuestas solo se aplican al aprobarlas. Para añadir información, envía una nota nueva.</small>
  </div>;
}
function valueLabel(state: Workspace, projectId: string, field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "Sin definir";
  if (field === "primaryId") return operationsFor(state, projectId).people.find(p => p.id === value)?.name ?? String(value);
  if (field === "milestoneId") return state.milestones.find(m => m.id === value)?.name ?? String(value);
  return String(value);
}
export function NotebookChanges({ state, proposal }: { state: Workspace; proposal: NotebookProposal }) {
  const target = notebookTarget(state, proposal);
  return <>{target && <p className="daily-hint">Registro: {String(target.title ?? target.name ?? proposal.targetId)}</p>}<dl className="notebook-changes">{proposal.changes.map(c => <div key={c.field}><dt>{notebookFieldLabels[c.field] ?? c.field}</dt><dd>{target && <span className="notebook-before">{valueLabel(state, proposal.projectId, c.field, target[c.field])} → </span>}{valueLabel(state, proposal.projectId, c.field, c.value)}</dd></div>)}</dl></>;
}
export function NotebookProposalForm({ state, suggestion, save, close }: { state: Workspace; suggestion: Workspace["suggestions"][number]; save: SaveCore; close: () => void }) {
  const original = (JSON.parse(suggestion.payload) as { proposal: NotebookProposal }).proposal;
  const [title, setTitle] = useState(original.title), [changes, setChanges] = useState(original.changes), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const commandId = useRef(crypto.randomUUID()), proposal = { ...original, title, changes };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await save("edit_suggestion", { id: suggestion.id, title, changes }, commandId.current); close(); } catch (e) { setError(e instanceof Error ? e.message : "No se guardó."); commandId.current = crypto.randomUUID(); } finally { setBusy(false); } };
  const update = (index: number, value: string) => setChanges(current => current.map((c, i) => i === index ? { ...c, value: value || null } : c));
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent className="core-dialog"><DialogHeader><DialogTitle>{notebookActionLabels[original.action]}</DialogTitle><DialogDescription>{state.projects.find(p => p.id === original.projectId)?.name}. Revisa los campos y conserva la nota de origen. Guardar mantiene la propuesta pendiente.</DialogDescription></DialogHeader><form onSubmit={submit} className="core-form"><label>Título de la propuesta<Input maxLength={180} required value={title} onChange={e => setTitle(e.target.value)} /></label>{changes.map((c, i) => { const options = c.field === "operationalStatus" ? PROJECT_STATUSES.map(value => ({ value, label: value })) : c.field === "status" ? (original.action === "update_milestone" ? MILESTONE_STATUSES : TASK_STATUSES).map(value => ({ value, label: value })) : c.field === "primaryId" ? operationsFor(state, original.projectId).people.filter(p => p.active).map(p => ({ value: p.id, label: p.name })) : c.field === "milestoneId" ? state.milestones.filter(m => m.projectId === original.projectId).map(m => ({ value: m.id, label: m.name })) : null; return <label key={c.field}>{notebookFieldLabels[c.field] ?? c.field}{options ? <select value={c.value ?? ""} onChange={e => update(i, e.target.value)}><option value="">Sin definir</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : ["description", "criteria", "currentSummary", "nextStepSummary", "blockedReason", "blockingReason"].includes(c.field) ? <Textarea maxLength={2000} value={c.value ?? ""} onChange={e => update(i, e.target.value)} /> : <Input type={/Date$|^deadline$|projectPlannedStart/.test(c.field) ? "date" : ["priority", "urgency", "estimatedMinutes"].includes(c.field) ? "number" : "text"} value={c.value ?? ""} onChange={e => update(i, e.target.value)} />}</label>; })}<NotebookChanges state={state} proposal={proposal} /><blockquote>{suggestion.evidence}</blockquote>{error && <p role="alert" className="core-form-error">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={busy}>Guardar propuesta</Button></DialogFooter></form></DialogContent></Dialog>;
}
