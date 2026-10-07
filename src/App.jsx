import { useEffect, useMemo, useRef, useState } from "react";
import { createGroups, createStudyTasks, rankTopics, uid } from "./analysis.js";
import { extractPaper } from "./extract.js";
import { clearFiles, deleteFile, loadWorkspace, saveWorkspace, storeFile } from "./storage.js";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateLabel = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date not set";
const daysUntil = (date) => Math.ceil((new Date(`${date}T23:59:59`) - new Date()) / 86400000);
const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const iconPaths = {
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="11" width="7" height="10" rx="2"/><rect x="3" y="14" width="8" height="7" rx="2"/></>,
  subjects: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></>,
  plan: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="m9 16 2 2 4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a7.8 7.8 0 0 1-1.4.8l-.3 1.8h-2.8l-.3-1.8a7.8 7.8 0 0 1-1.4-.8l-1.7.7-1.4-2.4 1.4-1.1a7.1 7.1 0 0 1 0-1.7l-1.4-1.1 1.4-2.4 1.7.7a7.8 7.8 0 0 1 1.4-.8l.3-1.8h2.8l.3 1.8a7.8 7.8 0 0 1 1.4.8l1.7-.7 1.4 2.4-1.4 1.1a7.1 7.1 0 0 1 0 1.7Z" transform="translate(-1 -1)"/></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></>,
  arrow: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
  back: <><path d="m15 18-6-6 6-6"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  check: <><path d="m5 12 4 4L19 6"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
};

function Icon({ name, size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

function Button({ children, kind = "secondary", ...props }) {
  return <button className={`button ${kind}`} {...props}>{children}</button>;
}

function Field({ label, hint, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} />{hint && <small>{hint}</small>}</label>;
}

function PanelTitle({ eyebrow, title, action }) {
  return <div className="panel-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{action}</div>;
}

function Empty({ title, children, action }) {
  return <div className="empty"><span className="empty-mark"><Icon name="file" size={22}/></span><strong>{title}</strong><p>{children}</p>{action}</div>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(() => {
    const saved = loadWorkspace();
    return { ...saved, separatePairs: saved.separatePairs || [] };
  });
  const [page, setPage] = useState("dashboard");
  const [selectedId, setSelectedId] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const selected = workspace.subjects.find((subject) => subject.id === selectedId) || null;

  useEffect(() => {
    try {
      saveWorkspace(workspace);
    } catch (saveError) {
      setError(saveError.message);
    }
  }, [workspace]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const update = (fn) => setWorkspace((current) => typeof fn === "function" ? fn(current) : fn);
  const notify = (message) => { setToast(message); setError(""); };
  const showSubject = (id) => { setSelectedId(id); setPage("subject"); };
  const route = (next) => { setPage(next); setSelectedId(""); };
  const readyPapers = selected ? workspace.papers.filter((paper) => paper.subjectId === selected.id && paper.status === "ready") : [];
  const priorities = selected ? rankTopics(selected, readyPapers) : [];

  const addSubject = (formData) => {
    const units = parseUnits(formData.get("syllabus")?.toString() || "");
    const subject = {
      id: uid(),
      name: formData.get("name").toString().trim(),
      code: formData.get("code").toString().trim(),
      examDate: formData.get("examDate").toString(),
      syllabusVersion: formData.get("syllabusVersion").toString().trim() || "Current",
      syllabusHistory: [],
      units,
      branch: formData.get("branch").toString().trim(),
      semester: formData.get("semester").toString().trim(),
      regulation: formData.get("regulation").toString().trim(),
      studyHours: Number(formData.get("studyHours")) || 3,
      createdAt: new Date().toISOString(),
    };
    if (!subject.name || !subject.examDate) return setError("Add a subject name and exam date to continue.");
    update((current) => ({
      ...current,
      profile: { branch: subject.branch, semester: subject.semester, regulation: subject.regulation, studyHours: subject.studyHours },
      subjects: [...current.subjects, subject],
    }));
    setSelectedId(subject.id);
    setPage("subject");
    notify(`${subject.name} is ready`);
  };

  const handleFiles = async (files) => {
    if (!selected || !files.length) return;
    setBusy(true);
    setError("");
    const messages = [];
    const accepted = [...files].filter((file) => ["application/pdf", "image/jpeg", "image/png"].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name));
    const rejected = files.length - accepted.length;
    if (rejected) messages.push(`${rejected} file${rejected === 1 ? " was" : "s were"} skipped. Use PDF, JPG, or PNG files.`);
    const oversized = accepted.filter((file) => file.size > 20 * 1024 * 1024).length;
    if (oversized) messages.push(`${oversized} file${oversized === 1 ? " was" : "s were"} skipped because files must be 20 MB or smaller.`);
    const knownHashes = new Set(workspace.papers.filter((paper) => paper.subjectId === selected.id && paper.hash).map((paper) => paper.hash));
    for (const file of accepted.filter((candidate) => candidate.size <= 20 * 1024 * 1024)) {
      const paperId = uid();
      const newPaper = {
        id: paperId,
        subjectId: selected.id,
        fileName: file.name,
        fileSize: file.size,
        year: null,
        hash: "",
        method: "",
        status: "processing",
        progress: 0,
        error: "",
        questions: [],
        uploadedAt: new Date().toISOString(),
      };
      update((current) => ({ ...current, papers: [newPaper, ...current.papers] }));
      try {
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((part) => part.toString(16).padStart(2, "0")).join("");
        const duplicate = workspace.papers.find((paper) => paper.subjectId === selected.id && paper.hash === hash);
        if (knownHashes.has(hash)) {
          update((current) => ({ ...current, papers: current.papers.filter((paper) => paper.id !== paperId) }));
          messages.push(`“${file.name}” matches ${duplicate ? `“${duplicate.fileName}”` : "another paper already selected"} and was not added.`);
          continue;
        }
        knownHashes.add(hash);
        await storeFile(paperId, file);
        update((current) => ({ ...current, papers: current.papers.map((paper) => paper.id === paperId ? { ...paper, hash } : paper) }));
        const result = await extractPaper(file, selected.units, (progress, message) => {
          setUploadProgress((current) => ({ ...current, [paperId]: { progress, message } }));
        });
        update((current) => ({
          ...current,
          papers: current.papers.map((paper) => paper.id === paperId ? {
            ...paper, status: "ready", progress: 100, extractedText: result.text, method: result.method,
            pageCount: result.pageCount, questions: result.questions,
          } : paper),
        }));
        setUploadProgress((current) => ({ ...current, [paperId]: { progress: 100, message: "Ready for review" } }));
        notify(`${file.name} processed — check the extracted questions`);
      } catch (processingError) {
        console.error("Paper processing failed.", processingError);
        update((current) => ({ ...current, papers: current.papers.map((paper) => paper.id === paperId ? { ...paper, status: "error", error: processingError.message || "The file could not be processed." } : paper) }));
        messages.push(`${file.name}: ${processingError.message || "Processing failed. You can retry this paper."}`);
      }
    }
    setBusy(false);
    if (messages.length) setError(messages.join(" "));
    if (fileInput.current) fileInput.current.value = "";
  };

  const retryPaper = async (paper) => {
    let file;
    try {
      file = await getStoredFile(paper.id);
    } catch (fileError) {
      return setError(`Could not access the saved paper: ${fileError.message}`);
    }
    if (!file) return setError("The original file is no longer available in this browser. Remove it and upload it again.");
    update((current) => ({ ...current, papers: current.papers.map((item) => item.id === paper.id ? { ...item, status: "processing", error: "" } : item) }));
    setBusy(true);
    try {
      const result = await extractPaper(file, selected?.units || [], (progress, message) => setUploadProgress((current) => ({ ...current, [paper.id]: { progress, message } })));
      update((current) => ({ ...current, papers: current.papers.map((item) => item.id === paper.id ? { ...item, status: "ready", progress: 100, extractedText: result.text, method: result.method, pageCount: result.pageCount, questions: result.questions } : item) }));
      notify("Paper processed. Review the extraction before using its analysis.");
    } catch (processingError) {
      update((current) => ({ ...current, papers: current.papers.map((item) => item.id === paper.id ? { ...item, status: "error", error: processingError.message || "Processing failed." } : item) }));
      setError(processingError.message || "Processing failed.");
    } finally {
      setBusy(false);
    }
  };

  const deletePaper = async (paper) => {
    if (!window.confirm(`Delete “${paper.fileName}” and its extracted questions?`)) return;
    try {
      await deleteFile(paper.id);
      update((current) => ({ ...current, papers: current.papers.filter((item) => item.id !== paper.id) }));
      notify("Paper deleted");
    } catch (deleteError) {
      setError(`Could not remove the local file: ${deleteError.message}`);
    }
  };

  const saveQuestion = (paperId, questionId, changes) => update((current) => ({
    ...current,
    papers: current.papers.map((paper) => paper.id !== paperId ? paper : {
      ...paper,
      questions: paper.questions.map((question) => question.id === questionId ? { ...question, ...changes } : question),
    }),
  }));

  const markQuestionReviewed = (paperId, questionId, reviewed) => update((current) => ({
    ...current,
    papers: current.papers.map((paper) => paper.id !== paperId ? paper : {
      ...paper,
      questions: paper.questions.map((question) => question.id === questionId ? {
        ...question,
        reviewed,
        review: !reviewed,
      } : question),
    }),
  }));

  const updateSubject = (id, changes) => update((current) => ({ ...current, subjects: current.subjects.map((subject) => subject.id === id ? { ...subject, ...changes } : subject) }));

  const savePlan = (subject) => {
    if (!subject.units.some((unit) => unit.topics.length)) {
      setError("Add at least one syllabus topic before generating a study plan.");
      return;
    }
    const tasks = createStudyTasks(subject, readyPapers);
    update((current) => ({ ...current, tasks: [...current.tasks.filter((task) => task.subjectId !== subject.id), ...tasks] }));
    notify(`A ${tasks.length}-task study plan is ready`);
    setPage("plan");
  };

  const toggleTask = (taskId) => update((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, done: !task.done } : task) }));

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => route("dashboard")} aria-label="ExamVault dashboard">
        <span className="brand-mark"><span/><span/><span/></span><span className="brand-name">exam<span>vault</span></span>
      </button>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav className="navigation" aria-label="Main navigation">
        {[["dashboard", "Overview"], ["subjects", "My subjects"], ["plan", "Study plan"]].map(([id, label]) =>
          <button key={id} onClick={() => route(id)} className={`nav-item ${page === id || (id === "subjects" && page === "subject") ? "active" : ""}`}><Icon name={id}/>{label}{id === "subjects" && workspace.subjects.length > 0 && <span className="nav-count">{workspace.subjects.length}</span>}</button>)}
      </nav>
      <div className="sidebar-subjects">
        <div className="nav-label">SUBJECTS <button aria-label="Add subject" onClick={() => route("subjects")} className="tiny-add"><Icon name="plus" size={14}/></button></div>
        {workspace.subjects.slice(0, 5).map((subject, index) => <button key={subject.id} className={`subject-link ${selectedId === subject.id ? "selected" : ""}`} onClick={() => showSubject(subject.id)}><span className={`subject-dot tone-${index % 4}`}/><span>{subject.name}</span></button>)}
        {!workspace.subjects.length && <span className="sidebar-hint">Your subjects will show here</span>}
      </div>
      <div className="sidebar-bottom">
        <div className="privacy-card"><span className="privacy-icon">◎</span><div><strong>Private by design</strong><p>Your papers stay in this browser.</p></div></div>
        <button onClick={() => route("settings")} className={`nav-item settings-link ${page === "settings" ? "active" : ""}`}><Icon name="settings"/>Privacy & settings</button>
        <div className="profile-chip"><span className="avatar">{(workspace.profile.branch || "S").slice(0, 1).toUpperCase()}</span><span><strong>{workspace.profile.branch || "Student workspace"}</strong><small>{workspace.profile.semester ? `Semester ${workspace.profile.semester}` : "Local workspace"}</small></span></div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><span className="crumb-separator">/</span><strong>{page === "subject" ? selected?.name || "Subject" : page === "dashboard" ? "Overview" : page === "subjects" ? "My subjects" : page === "plan" ? "Study plan" : page === "analysis" ? "Analysis" : page === "review" ? "Paper review" : "Privacy & settings"}</strong></div>
        <div className="top-actions"><span className="local-badge"><span/>Saved on this device</span><button className="avatar top-avatar" onClick={() => route("settings")} aria-label="Open settings">{(workspace.profile.branch || "S").slice(0, 1).toUpperCase()}</button></div>
      </header>
      <div className="content">
        {error && <div role="alert" className="alert error-alert"><span>!</span>{error}<button aria-label="Dismiss" onClick={() => setError("")}>×</button></div>}
        {page === "dashboard" && <Dashboard workspace={workspace} onSubject={showSubject} onNavigate={route} onAdd={() => route("subjects")} onTask={toggleTask}/>}
        {page === "subjects" && <Subjects workspace={workspace} onCreate={addSubject} onSubject={showSubject}/>}
        {page === "subject" && selected && <SubjectPage subject={selected} papers={workspace.papers.filter((paper) => paper.subjectId === selected.id)} priorities={priorities} busy={busy} progress={uploadProgress} onUpload={() => fileInput.current?.click()} onReview={(paper) => { setSelectedId(paper.subjectId); setPage("review"); }} onDelete={deletePaper} onRetry={retryPaper} onAnalyze={() => setPage("analysis")} onPlan={() => savePlan(selected)} onUpdate={updateSubject} onUpdatePaper={(paperId, changes) => update((current) => ({ ...current, papers: current.papers.map((paper) => paper.id === paperId ? { ...paper, ...changes } : paper) }))} onBack={() => route("subjects")} fileInput={fileInput} onFiles={handleFiles}/>}
        {page === "review" && selected && <ReviewPage subject={selected} papers={workspace.papers.filter((paper) => paper.subjectId === selected.id)} onBack={() => setPage("subject")} onSave={saveQuestion} onMarkReviewed={markQuestionReviewed} onUpdatePaper={(paperId, changes) => update((current) => ({ ...current, papers: current.papers.map((paper) => paper.id === paperId ? { ...paper, ...changes } : paper) }))} onRetry={retryPaper} onDelete={deletePaper} busy={busy}/>}
        {page === "analysis" && selected && <AnalysisPage subject={selected} papers={readyPapers} separatePairs={workspace.separatePairs || []} onSeparate={(pair) => update((current) => ({ ...current, separatePairs: [...new Set([...(current.separatePairs || []), pair])] }))} onBack={() => setPage("subject")} onPrint={() => window.print()}/>}
        {page === "plan" && <PlanPage workspace={workspace} onToggle={toggleTask} onGenerate={(subject) => savePlan(subject)} onSubject={showSubject} onAddSubject={() => route("subjects")}/>}
        {page === "settings" && <SettingsPage workspace={workspace} onUpdate={(profile) => update((current) => ({ ...current, profile, subjects: current.subjects.map((subject) => ({ ...subject, branch: profile.branch, semester: profile.semester, regulation: profile.regulation, studyHours: profile.studyHours })) }))} onClear={async () => { if (!window.confirm("Permanently remove all local subjects, papers, uploaded files, and study plans from this browser?")) return; try { await clearFiles(); update({ profile: { branch: "", semester: "", regulation: "", studyHours: 3 }, subjects: [], papers: [], tasks: [], separatePairs: [] }); setSelectedId(""); route("dashboard"); notify("Local workspace deleted"); } catch (clearError) { setError(`Could not clear local files: ${clearError.message}`); } }}/>}
      </div>
      <footer className="page-footer"><span>ExamVault helps you study from evidence, not predictions.</span><span>Prototype · data stays on this device</span></footer>
    </main>
    {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
  </div>;
}

function parseUnits(text) {
  return text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [heading, ...rest] = line.split(":");
    const match = heading.match(/^(?:unit\s*)?(\d+)\s*[-.)]?\s*(.*)$/i);
    const name = match ? `${match[2]?.trim() ? `${match[2].trim()} · ` : ""}Unit ${match[1]}` : heading.trim() || `Unit ${index + 1}`;
    const topicText = rest.join(":") || name;
    return {
      id: uid(),
      name,
      topics: topicText.split(/[,;]/).map((topic) => topic.trim()).filter(Boolean).map((topicName) => ({ id: uid(), name: topicName })),
    };
  });
}

function findSubquestions(text) {
  const markers = [...text.matchAll(/(?:^|\s)\(([a-h])\)\s+/gim)];
  return markers.map((marker, index) => ({
    label: marker[1].toLowerCase(),
    text: text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim(),
  })).filter((part) => part.text);
}

function Dashboard({ workspace, onSubject, onNavigate, onAdd, onTask }) {
  const nextExam = workspace.subjects.map((subject) => ({ ...subject, days: daysUntil(subject.examDate) })).filter((subject) => subject.days >= 0).sort((a, b) => a.days - b.days)[0];
  const tasksToday = workspace.tasks.filter((task) => task.date === today());
  const totalQuestions = workspace.papers.reduce((sum, paper) => sum + (paper.questions?.filter((question) => question.status === "ready").length || 0), 0);
  const completed = workspace.tasks.filter((task) => task.done).length;
  const overall = workspace.tasks.length ? Math.round((completed / workspace.tasks.length) * 100) : 0;
  const focusSubject = nextExam || workspace.subjects[0];
  const priority = focusSubject ? rankTopics(focusSubject, workspace.papers.filter((paper) => paper.subjectId === focusSubject.id && paper.status === "ready")) : [];
  const activity = [...workspace.papers].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 3);

  return <div className="page-stack">
    <div className="welcome-row"><div><div className="eyebrow">YOUR EXAM PREP, WITH CLARITY</div><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}</h1><p className="subheading">Turn past papers into a clearer plan for what to study next.</p></div><Button kind="primary" onClick={onAdd}><Icon name="plus"/> Add a subject</Button></div>
    {!workspace.subjects.length ? <div className="welcome-card"><div className="welcome-copy"><span className="welcome-spark">✳</span><div className="eyebrow">A CALMER WAY TO PREPARE</div><h2>Make past papers<br/>work harder for you.</h2><p>Bring your syllabus and previous papers together. ExamVault helps you see what showed up, what still matters, and where your study time can go.</p><Button kind="primary" onClick={onAdd}>Set up your first subject <Icon name="arrow"/></Button></div><div className="welcome-art" aria-hidden="true"><div className="art-sheet sheet-back"><i/><i/><i/><i/></div><div className="art-sheet sheet-front"><span className="art-label">STUDY NOTES</span><strong>Small steps,<br/>strong prep.</strong><div className="art-bars"><i/><i/><i/></div><span className="art-check">✓</span></div><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><span className="art-star">✳</span></div></div> : <>
      <div className="stat-grid">
        <div className="stat-card exam-stat"><div className="stat-top"><span>Next exam</span><span className="stat-icon purple">◷</span></div>{nextExam ? <><strong className="stat-value">{nextExam.days === 0 ? "Today" : `${nextExam.days} days`}</strong><span className="stat-caption">{nextExam.name} · {dateLabel(nextExam.examDate)}</span></> : <><strong className="stat-value muted-value">Not scheduled</strong><button className="text-action" onClick={() => onSubject(workspace.subjects[0].id)}>Add an exam date <Icon name="arrow" size={14}/></button></>}</div>
        <div className="stat-card"><div className="stat-top"><span>Questions extracted</span><span className="stat-icon green">✓</span></div><strong className="stat-value">{totalQuestions}</strong><span className="stat-caption">{workspace.papers.filter((paper) => paper.status === "ready").length} papers processed</span></div>
        <div className="stat-card"><div className="stat-top"><span>Study plan progress</span><span className="stat-icon amber">↗</span></div><strong className="stat-value">{overall}<span className="percent">%</span></strong><span className="stat-caption">{completed} of {workspace.tasks.length} tasks completed</span><div className="mini-progress"><i style={{ width: `${overall}%` }}/></div></div>
        <div className="stat-card"><div className="stat-top"><span>Study hours / day</span><span className="stat-icon blue">◷</span></div><strong className="stat-value">{workspace.profile.studyHours}<span className="stat-unit"> hrs</span></strong><span className="stat-caption">Your available study time</span></div>
      </div>
      <div className="dashboard-grid">
        <section className="card priority-card"><PanelTitle eyebrow="START WITH THE EVIDENCE" title="Study priorities" action={focusSubject && <button className="quiet-button" onClick={() => onSubject(focusSubject.id)}>{focusSubject.name}<Icon name="arrow" size={14}/></button>}/>{focusSubject ? priority.length ? <><div className="priority-note"><span className="note-icon">i</span>Study aid, not a prediction. Scores use frequency (50% distinct-paper coverage), recency (25%), and current syllabus match (25%).</div><div className="priority-list">{priority.slice(0, 4).map((item, index) => <div className="priority-row" key={item.topic.id}><div className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</div><div className="priority-main"><strong>{item.topic.name}</strong><span>{item.topic.unitName} · {item.insufficient ? "Not enough past-paper evidence" : `${item.paperCount} distinct ${item.paperCount === 1 ? "paper" : "papers"} · ${item.frequency} question${item.frequency === 1 ? "" : "s"}`}</span></div><div className="priority-score"><div className="priority-meter"><i style={{ width: `${item.insufficient ? 0 : item.priority}%` }}/></div><strong>{item.insufficient ? "—" : item.priority}</strong></div></div>)}</div>{priority.some((item) => item.insufficient) && <div className="insufficient-note">Low evidence? Upload more papers or map questions to your current syllabus to improve this view.</div>}</> : <Empty title="Add syllabus topics">Topic priorities appear once you add your current syllabus.</Empty> : null}</section>
        <section className="card today-card"><PanelTitle eyebrow="A LITTLE, CONSISTENTLY" title="Today’s plan" action={<button className="quiet-button" onClick={() => onNavigate("plan")}>See plan <Icon name="arrow" size={14}/></button>}/>{tasksToday.length ? <div className="task-list">{tasksToday.slice(0, 4).map((task) => <label key={task.id} className={`task-row ${task.done ? "is-done" : ""}`}><input type="checkbox" checked={task.done} onChange={() => onTask(task.id)}/><span className="custom-check"><Icon name="check" size={13}/></span><span className="task-text"><strong>{task.title}</strong><small>{task.minutes} min · {task.kind === "revision" ? "Revision" : "Focused study"}</small></span></label>)}</div> : <Empty title="Make today count">Create a plan around your exam date and your available hours.</Empty>}{!tasksToday.length && focusSubject && <Button onClick={() => onSubject(focusSubject.id)}>Build a study plan <Icon name="arrow" size={16}/></Button>}</section>
        <section className="card heatmap-card"><PanelTitle eyebrow="SYLLABUS AT A GLANCE" title="Unit coverage"/>{focusSubject?.units.length ? <div className="unit-heatmap">{focusSubject.units.slice(0, 6).map((unit, index) => { const mapped = workspace.papers.filter((paper) => paper.subjectId === focusSubject.id).flatMap((paper) => paper.questions || []).filter((question) => question.unitId === unit.id && question.status === "ready").length; return <button key={unit.id} onClick={() => onSubject(focusSubject.id)} className={`unit-tile coverage-${mapped ? Math.min(3, Math.ceil(mapped / 2)) : 0}`}><span>{unit.name}</span><strong>{mapped}</strong><small>{mapped ? "mapped questions" : "no evidence yet"}</small><i style={{ width: `${Math.min(100, mapped * 16)}%` }}/></button>; })}</div> : <Empty title="Your syllabus will show here">Add units and topics to see which parts of your syllabus have past-paper evidence.</Empty>}<div className="heatmap-legend"><span><i className="legend-dot none"/>No mapped evidence</span><span><i className="legend-dot some"/>Evidence found</span></div></section>
        <section className="card activity-card"><PanelTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Recent activity"/>{activity.length ? <div className="activity-list">{activity.map((paper) => <button key={paper.id} className="activity-row" onClick={() => onSubject(paper.subjectId)}><span className={`activity-icon ${paper.status === "error" ? "activity-error" : ""}`}><Icon name="file" size={16}/></span><span className="activity-detail"><strong>{paper.fileName}</strong><small>{paper.status === "ready" ? `${paper.questions.length} extracted · ${paper.method}` : paper.status === "error" ? "Needs attention" : "Processing"}</small></span><small className="activity-date">{new Date(paper.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></button>)}</div> : <Empty title="Your workspace is ready">Add a subject and upload a past paper to get started.</Empty>}</section>
      </div>
    </>}
    <div className="disclaimer"><span>✳</span><p><strong>Past patterns are not promises.</strong> ExamVault summarizes the papers you upload. It does not predict what will appear on a future exam.</p></div>
  </div>;
}

function Subjects({ workspace, onCreate, onSubject }) {
  const [showForm, setShowForm] = useState(workspace.subjects.length === 0);
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">YOUR COURSEWORK, ORGANIZED</div><h1>My subjects</h1><p className="subheading">Set an exam date, add your syllabus, and build a paper library for each subject.</p></div>{!showForm && <Button kind="primary" onClick={() => setShowForm(true)}><Icon name="plus"/> Add subject</Button>}</div>
    {showForm && <form className="card subject-form" onSubmit={(event) => { event.preventDefault(); onCreate(new FormData(event.currentTarget)); setShowForm(false); }}>
      <PanelTitle eyebrow="SUBJECT SETUP" title="A good plan starts with context"/><div className="form-grid"><Field name="name" label="Subject name" placeholder="e.g. Engineering Mathematics" required/><Field name="code" label="Subject code" placeholder="e.g. MA201"/><Field name="examDate" label="Exam date" type="date" min={today()} required/><Field name="syllabusVersion" label="Current syllabus version" placeholder="e.g. Regulation 2024"/><Field name="branch" label="Branch / program" placeholder="e.g. Computer Science" defaultValue={workspace.profile.branch}/><Field name="semester" label="Semester" placeholder="e.g. 4" defaultValue={workspace.profile.semester}/><Field name="regulation" label="Regulation" placeholder="e.g. 2024" defaultValue={workspace.profile.regulation}/><Field name="studyHours" label="Available study hours / day" type="number" min="1" max="16" defaultValue={workspace.profile.studyHours}/></div>
      <label className="field syllabus-field"><span>Units and topics</span><textarea name="syllabus" rows="4" placeholder={"One unit per line. Separate topics with commas.\nUnit 1: Linear algebra, matrices, eigenvalues\nUnit 2: Differential equations, Laplace transforms"} /><small>Add topics to map questions and check relevance to this syllabus version. You can edit units later.</small></label>
      <div className="form-actions"><Button type="button" onClick={() => setShowForm(false)}>Cancel</Button><Button type="submit" kind="primary">Create subject <Icon name="arrow" size={16}/></Button></div>
    </form>}
    {workspace.subjects.length ? <div className="subject-grid">{workspace.subjects.map((subject, index) => { const papers = workspace.papers.filter((paper) => paper.subjectId === subject.id); const questions = papers.reduce((sum, paper) => sum + (paper.questions?.length || 0), 0); return <button key={subject.id} className="subject-card" onClick={() => onSubject(subject.id)}><div className="subject-card-top"><span className={`subject-monogram tone-${index % 4}`}>{(subject.code || subject.name).slice(0, 2).toUpperCase()}</span><span className="subject-card-arrow"><Icon name="arrow" size={16}/></span></div><div className="eyebrow">{subject.code || "SUBJECT"}</div><h2>{subject.name}</h2><p>{subject.branch || "Program not set"}{subject.semester ? ` · Semester ${subject.semester}` : ""}</p><div className="subject-card-bottom"><span><Icon name="file" size={14}/>{papers.length} papers</span><span><Icon name="subjects" size={14}/>{subject.units.length} units</span><span className="exam-date-tag">{dateLabel(subject.examDate)}</span></div></button>; })}</div> : !showForm ? <Empty title="No subjects yet">Create a subject to organize your syllabus, past papers, and study plan.</Empty> : null}
  </div>;
}

function SubjectPage({ subject, papers, priorities, busy, progress, onUpload, onReview, onDelete, onRetry, onAnalyze, onPlan, onUpdate, onUpdatePaper, onBack, fileInput, onFiles }) {
  const [editSyllabus, setEditSyllabus] = useState(false);
  const [version, setVersion] = useState(subject.syllabusVersion || "");
  const [unitsText, setUnitsText] = useState(subject.units.map((unit) => `${unit.name}: ${unit.topics.map((topic) => topic.name).join(", ")}`).join("\n"));
  const ready = papers.filter((paper) => paper.status === "ready");
  const currentTopicIds = new Set(subject.units.flatMap((unit) => unit.topics.map((topic) => `${unit.id}:${topic.id}`)));
  const mapped = ready.flatMap((paper) => paper.questions).filter((question) => currentTopicIds.has(`${question.unitId}:${question.topicId}`)).length;
  return <div className="page-stack">
    <div className="subject-hero"><div className="subject-hero-main"><button className="back-link" onClick={onBack}><Icon name="back" size={16}/>My subjects</button><div className="eyebrow">{subject.code || "SUBJECT"}{subject.semester && ` · SEMESTER ${subject.semester}`}</div><h1>{subject.name}</h1><p className="subheading">{subject.branch || "Program not specified"}{subject.regulation ? ` · Regulation ${subject.regulation}` : ""}</p><div className="subject-pills"><span>◷ {daysUntil(subject.examDate) < 0 ? "Exam date passed" : daysUntil(subject.examDate) === 0 ? "Exam today" : `${daysUntil(subject.examDate)} days to exam`}</span><span>{dateLabel(subject.examDate)}</span><span>{subject.syllabusVersion || "Syllabus version not set"}</span></div></div><div className="subject-hero-actions"><Button onClick={onPlan}>Build study plan <Icon name="arrow" size={16}/></Button><Button kind="primary" onClick={onUpload}><Icon name="upload"/> Upload paper</Button></div><div className="hero-decoration"><div/><div/><div/></div></div>
    <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple hidden onChange={(event) => onFiles([...event.target.files])}/>
    <div className="subject-overview-stats"><div><strong>{subject.units.reduce((n, unit) => n + unit.topics.length, 0)}</strong><span>syllabus topics</span></div><div><strong>{papers.length}</strong><span>past papers</span></div><div><strong>{ready.reduce((n, paper) => n + paper.questions.length, 0)}</strong><span>extracted questions</span></div><div><strong>{mapped}</strong><span>mapped to syllabus</span></div><div><strong>{ready.length ? Math.round(mapped / Math.max(1, ready.reduce((n, paper) => n + paper.questions.length, 0)) * 100) : 0}%</strong><span>syllabus matched</span></div></div>
    <div className="subject-columns">
      <section className="card syllabus-card"><PanelTitle eyebrow="CURRENT SYLLABUS" title={subject.syllabusVersion || "Syllabus"} action={<button className="quiet-button" onClick={() => setEditSyllabus((value) => !value)}>{editSyllabus ? "Cancel" : "Edit syllabus"}</button>}/>{editSyllabus ? <div className="edit-syllabus"><Field label="Version / regulation" value={version} onChange={(event) => setVersion(event.target.value)}/><label className="field"><span>Units and topics</span><textarea rows="6" value={unitsText} onChange={(event) => setUnitsText(event.target.value)}/><small>One unit per line. Topic names after a colon are comma-separated.</small></label><Button kind="primary" onClick={() => { const units = parseUnits(unitsText); const history = [...(subject.syllabusHistory || []), { version: subject.syllabusVersion, savedAt: new Date().toISOString(), units: subject.units }]; onUpdate(subject.id, { syllabusVersion: version || "Current", units, syllabusHistory: history }); setEditSyllabus(false); }}>Save syllabus version</Button></div> : subject.units.length ? <div className="syllabus-list">{subject.units.map((unit, index) => <div className="syllabus-unit" key={unit.id}><span className={`unit-num tone-${index % 4}`}>{String(index + 1).padStart(2, "0")}</span><div><strong>{unit.name}</strong><div className="topic-chips">{unit.topics.map((topic) => <span key={topic.id}>{topic.name}</span>)}</div></div></div>)}</div> : <Empty title="Add your current syllabus">Adding units and topics lets you map extracted questions to what you are studying now.</Empty>}{!editSyllabus && subject.syllabusHistory?.length > 0 && <details className="syllabus-history"><summary>Previous syllabus versions ({subject.syllabusHistory.length})</summary>{subject.syllabusHistory.map((history, index) => <div className="history-entry" key={`${history.savedAt}-${index}`}><strong>{history.version || "Previous version"}</strong><small>{dateLabel(history.savedAt?.slice(0, 10))} · {history.units.length} units</small></div>)}</details>}</section>
      <section className="card papers-card"><PanelTitle eyebrow="YOUR PAPER LIBRARY" title="Past papers" action={papers.length > 0 && <Button kind="primary" onClick={onUpload}><Icon name="plus" size={15}/>Upload</Button>}/>{!papers.length ? <div className="upload-drop" role="button" tabIndex="0" onClick={onUpload} onKeyDown={(event) => event.key === "Enter" && onUpload()}><span className="upload-icon"><Icon name="upload" size={22}/></span><strong>Bring in a past paper</strong><p>PDF or a clear JPG / PNG scan · up to 20 MB</p><Button kind="secondary" onClick={(event) => { event.stopPropagation(); onUpload(); }}>Choose files</Button><small>Files are processed in this browser. Nothing is sent to a server.</small></div> : <div className="paper-list">{papers.map((paper) => <PaperRow key={paper.id} paper={paper} progress={progress[paper.id]} onReview={onReview} onDelete={onDelete} onRetry={onRetry} busy={busy}/>)}</div>}</section>
    </div>
    <section className="card subject-priority"><PanelTitle eyebrow="EVIDENCE-LED ANALYSIS" title="Topics to focus on" action={<Button onClick={onAnalyze}>Explore analysis <Icon name="arrow" size={16}/></Button>}/>{priorities.length ? <div className="compact-priorities">{priorities.slice(0, 3).map((item) => <div key={item.topic.id} className="compact-priority"><span className="rank">{item.insufficient ? "—" : String(item.priority).padStart(2, "0")}</span><div><strong>{item.topic.name}</strong><small>{item.insufficient ? "Insufficient past-paper data" : `${item.paperCount} distinct papers · ${item.years.join(", ") || "year unknown"}`}</small></div><span className="compact-bar"><i style={{ width: `${item.insufficient ? 0 : item.priority}%` }}/></span></div>)}</div> : <Empty title="Add syllabus topics to get started">Importance scores only show after questions have been mapped and are always backed by visible evidence.</Empty>}</section>
    {busy && <div className="processing-banner"><span className="spinner"/> Paper processing is in progress. You can keep reviewing other work.</div>}
  </div>;
}

function PaperRow({ paper, progress, onReview, onDelete, onRetry, busy }) {
  return <div className={`paper-row ${paper.status === "error" ? "paper-failed" : ""}`}><span className={`paper-file-icon ${paper.status === "error" ? "file-error" : ""}`}><Icon name="file" size={18}/></span><div className="paper-row-main"><div className="paper-name-line"><strong>{paper.fileName}</strong><span className={`status-pill status-${paper.status}`}>{paper.status === "ready" ? "Ready" : paper.status === "error" ? "Needs attention" : "Processing"}</span></div><div className="paper-meta">{formatBytes(paper.fileSize)} · {paper.status === "ready" ? `${paper.questions.length} questions · ${paper.method}` : paper.status === "error" ? paper.error : progress?.message || "Starting extraction"}</div>{paper.status === "processing" && <div className="paper-progress"><i style={{ width: `${progress?.progress || 8}%` }}/></div>}{paper.status === "error" && <button className="text-action retry" disabled={busy} onClick={() => onRetry(paper)}>Retry processing <Icon name="arrow" size={13}/></button>}</div>{paper.year && <span className="year-stamp">{paper.year}</span>}<div className="paper-actions">{paper.status === "ready" && <button className="quiet-button" onClick={() => onReview(paper)}>Review <Icon name="arrow" size={14}/></button>}<button className="icon-button danger-hover" aria-label={`Delete ${paper.fileName}`} onClick={() => onDelete(paper)}>×</button></div></div>;
}

async function getStoredFile(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("examvault-files", 1);
    request.onsuccess = () => {
      const db = request.result;
      const getRequest = db.transaction("papers", "readonly").objectStore("papers").get(id);
      getRequest.onsuccess = () => { resolve(getRequest.result); db.close(); };
      getRequest.onerror = () => { reject(getRequest.error); db.close(); };
    };
    request.onerror = () => reject(request.error);
  });
}

function ReviewPage({ subject, papers, onBack, onSave, onMarkReviewed, onUpdatePaper, onRetry, onDelete, busy }) {
  const ready = papers.filter((paper) => paper.status === "ready");
  const [expanded, setExpanded] = useState({});
  const [showSource, setShowSource] = useState({});
  return <div className="page-stack">
    <button className="back-link" onClick={onBack}><Icon name="back" size={16}/>Back to {subject.name}</button>
    <div className="page-heading"><div><div className="eyebrow">HUMAN CHECK BEFORE ANALYSIS</div><h1>Review extracted questions</h1><p className="subheading">Extraction is a first pass, not a verified transcription. Correct text, year, marks, and syllabus mapping below.</p></div></div>
    {!ready.length && papers.length === 0 && <Empty title="No papers to review">Upload a paper to begin extraction and review.</Empty>}
    {papers.filter((paper) => paper.status !== "ready").map((paper) => <div className="card review-status" key={paper.id}><span className={`status-pill status-${paper.status}`}>{paper.status}</span><strong>{paper.fileName}</strong>{paper.error && <span>{paper.error}</span>}{paper.status === "error" && <Button disabled={busy} onClick={() => onRetry(paper)}>Retry</Button>}</div>)}
    {ready.map((paper) => <section className="card review-paper" key={paper.id}><div className="review-paper-head"><div><div className="eyebrow">{paper.method} · {paper.pageCount || "?"} {paper.pageCount === 1 ? "page" : "pages"}</div><h2>{paper.fileName}</h2><span className="subheading">Confirm the paper year if available; leave it blank if unknown.</span></div><label className="field compact-field"><span>Paper year</span><input type="number" min="1900" max="2099" placeholder="Unknown" value={paper.year || ""} onChange={(event) => onUpdatePaper(paper.id, { year: event.target.value ? Number(event.target.value) : null })}/></label></div>
      <div className="review-hint"><span>i</span><p><strong>{paper.questions.filter((question) => !question.reviewed).length} question(s) awaiting human review.</strong> Confirm each question below before it contributes to analysis. Unknown marks or syllabus matches remain blank.</p><button onClick={() => setShowSource((state) => ({ ...state, [paper.id]: !state[paper.id] }))}>{showSource[paper.id] ? "Hide" : "Show"} original extracted text</button></div>
      {showSource[paper.id] && <pre className="source-text">{paper.extractedText || "No source text extracted."}</pre>}
      {!paper.questions.length && <Empty title="No questions could be isolated">The original extracted text is still available above. You can review it or retry the file.</Empty>}
      <div className="question-list">{paper.questions.map((question, index) => <QuestionEditor key={question.id} question={question} index={index} subject={subject} expanded={expanded[question.id]} onExpand={() => setExpanded((state) => ({ ...state, [question.id]: !state[question.id] }))} onSave={(changes) => onSave(paper.id, question.id, changes)} onMarkReviewed={(reviewed) => onMarkReviewed(paper.id, question.id, reviewed)}/>)}</div>
    </section>)}
  </div>;
}

function QuestionEditor({ question, index, subject, expanded, onExpand, onSave, onMarkReviewed }) {
  const [text, setText] = useState(question.text);
  const subquestions = findSubquestions(text);
  const topic = subject.units.flatMap((unit) => unit.topics.map((item) => ({ ...item, unitId: unit.id, unitName: unit.name }))).find((item) => item.id === question.topicId);
  const selectedUnit = subject.units.find((unit) => unit.id === question.unitId);
  return <article className={`question-review ${question.reviewed ? "question-confirmed" : "needs-review"}`}><div className="question-number"><span>Q{String(index + 1).padStart(2, "0")}</span>{question.reviewed ? <span className="review-flag confirmed-flag">Confirmed</span> : <span className="review-flag">Check extraction</span>}</div><div className="question-content"><textarea aria-label={`Question ${index + 1} text`} rows={Math.max(2, Math.min(5, Math.ceil(text.length / 100)))} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => text !== question.text && onSave({ text })}/>{subquestions.length > 0 && <div className="subquestion-list"><small>SUBQUESTIONS DETECTED · EDIT THE TEXT ABOVE TO CORRECT</small>{subquestions.map((part) => <p key={part.label}><strong>({part.label})</strong> {part.text}</p>)}</div>}<button className="source-toggle" onClick={onExpand}>{expanded ? "Hide preserved original" : "Compare with original"}</button>{expanded && <div className="original-question"><small>ORIGINAL EXTRACTED TEXT · PRESERVED</small><p>{question.originalText}</p></div>}<div className="question-fields"><label className="field"><span>Unit</span><select value={subject.units.some((unit) => unit.id === question.unitId) ? question.unitId : ""} onChange={(event) => onSave({ unitId: event.target.value, topicId: "" })}><option value="">Unmapped</option>{subject.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="field"><span>Topic</span><select value={selectedUnit?.topics.some((item) => item.id === question.topicId) ? question.topicId : ""} onChange={(event) => onSave({ topicId: event.target.value, unitId: question.unitId })} disabled={!selectedUnit}><option value="">Unmapped</option>{selectedUnit?.topics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field marks-field"><span>Marks</span><input type="number" min="0" max="999" placeholder="Unknown" value={question.marks ?? ""} onChange={(event) => onSave({ marks: event.target.value === "" ? null : Number(event.target.value) })}/></label><span className={`confidence-label confidence-${question.confidence}`}>{question.reviewed ? `Confirmed · ${question.confidence} extraction` : `${question.confidence} confidence`}</span>{topic && <span className="mapped-chip">Mapped · {topic.name}</span>}<Button kind={question.reviewed ? "secondary" : "primary"} onClick={() => onMarkReviewed(!question.reviewed)}>{question.reviewed ? "Mark for review" : "Confirm question"}</Button></div></div></article>;
}

function AnalysisPage({ subject, papers, separatePairs, onSeparate, onBack, onPrint }) {
  const ranked = rankTopics(subject, papers);
  const groups = useMemo(() => createGroups(papers, separatePairs), [papers, separatePairs]);
  const visibleGroups = groups;
  const distinctPapers = new Set(papers.flatMap((paper) => (paper.questions || []).filter((question) => question.reviewed).map(() => paper.id))).size;
  return <div className="page-stack analysis-page">
    <div className="analysis-heading"><div><button className="back-link" onClick={onBack}><Icon name="back" size={16}/>Back to {subject.name}</button><div className="eyebrow">WHAT THE PAPERS CAN TELL YOU</div><h1>Past-paper analysis</h1><p className="subheading">Transparent patterns from {distinctPapers} distinct {distinctPapers === 1 ? "paper" : "papers"}. Historical frequency is not a forecast.</p></div><Button onClick={onPrint}>Print / save PDF <span className="print-icon">↗</span></Button></div>
    {!distinctPapers && <div className="alert info-alert"><span>i</span>Upload at least one paper and confirm its extracted questions in Paper review to see analysis. Unconfirmed extractions are excluded.</div>}
    {distinctPapers > 0 && distinctPapers < 2 && <div className="alert info-alert"><span>i</span>Only one paper has confirmed questions. Frequency and recency comparisons are insufficient; scores are a study aid, not a prediction.</div>}
    <section className="analysis-hero card"><div><div className="eyebrow">HOW PRIORITY IS CALCULATED</div><h2>A study aid, never a prediction.</h2><p>Scores combine three visible signals: distinct-paper frequency (50%), recency (25%), and whether the question maps to this current syllabus (25%). Marks are shown separately and do not change the score.</p></div><div className="formula"><div><span>Frequency</span><strong>50%</strong><i><b style={{width:"50%"}}/></i></div><div><span>Recency</span><strong>25%</strong><i><b style={{width:"25%"}}/></i></div><div><span>Current syllabus</span><strong>25%</strong><i><b style={{width:"25%"}}/></i></div></div></section>
    <section className="card analysis-table-card"><PanelTitle eyebrow="CURRENT SYLLABUS TOPICS" title="Evidence by topic" action={<span className="table-meta">{distinctPapers} papers · {papers.reduce((n, paper) => n + paper.questions.length, 0)} extracted questions</span>}/><div className="table-scroll"><table><thead><tr><th>Topic</th><th>Priority</th><th>Distinct papers</th><th>Years seen</th><th>Marks seen</th><th>Syllabus relevance</th></tr></thead><tbody>{ranked.map((item) => <tr key={item.topic.id}><td><strong>{item.topic.name}</strong><small>{item.topic.unitName}</small></td><td><span className={`table-score ${item.insufficient ? "score-muted" : ""}`}>{item.insufficient ? "—" : item.priority}</span><small>{item.insufficient ? "Insufficient data" : "Study aid"}</small></td><td>{item.paperCount}<small>{item.frequency} question{item.frequency === 1 ? "" : "s"}</small></td><td>{item.years.length ? item.years.join(", ") : "Unknown"}</td><td>{item.marks.length ? `${item.marks.join(", ")} mark${item.marks.length > 1 ? "s" : ""}` : "Not recorded"}</td><td><span className={`relevance ${item.currentSyllabus ? "relevant" : "not-relevant"}`}>{item.currentSyllabus ? `Mapped · ${subject.syllabusVersion}` : "No mapped evidence"}</span></td></tr>)}</tbody></table></div><div className="analysis-table-foot">Frequency counts extracted questions by distinct paper, not file pages. Review text and mapping before relying on the results. Unknown years and marks stay unknown.</div></section>
    <section className="card groups-card"><PanelTitle eyebrow="SIMILARITY, WITH CAUTION" title="Repeated question patterns"/><p className="section-intro">Only text matches scoring at least 0.72 Jaccard similarity are grouped automatically. Compare the original questions; choose “Keep separate” if the match is misleading.</p>{visibleGroups.length ? <div className="group-list">{visibleGroups.map((group) => <div className="question-group" key={group.key}><div className="group-top"><span className="similarity-score">{Math.round(group.score * 100)}% text overlap</span><span>{new Set(group.questions.map((question) => question.paperId)).size} distinct papers</span></div>{group.questions.map((question) => { const paper = papers.find((item) => item.id === question.paperId); return <div className="group-member" key={question.id}><p>{question.text}</p><small>{paper?.fileName} {question.year ? `· ${question.year}` : "· year unknown"} {question.marks == null ? "· marks unknown" : `· ${question.marks} marks`}</small></div>; })}<button className="quiet-button group-correct" onClick={() => onSeparate(`${group.questions[0].id}:${group.questions[1].id}`)}>Keep these separate</button></div>)}</div> : <Empty title="No confident repeated patterns yet">Patterns need similar reviewed text across different papers. This is not a guarantee of future questions.</Empty>}</section>
    <section className="card evidence-note"><span className="note-icon">i</span><p><strong>What this analysis does not do.</strong> It does not predict or guarantee future exam questions. It cannot establish relevance for a different syllabus version. Add a year, marks, or topic mapping during review when the source supports it; otherwise the value remains unknown.</p></section>
  </div>;
}

function PlanPage({ workspace, onToggle, onGenerate, onSubject, onAddSubject }) {
  const tasks = workspace.tasks;
  const [filter, setFilter] = useState("all");
  const visible = tasks.filter((task) => filter === "all" || (filter === "done" ? task.done : !task.done)).sort((a, b) => a.date.localeCompare(b.date));
  const grouped = visible.reduce((result, task) => { (result[task.date] ||= []).push(task); return result; }, {});
  const done = tasks.filter((task) => task.done).length;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">GENTLE STRUCTURE, YOUR WAY</div><h1>Study plan</h1><p className="subheading">A practical starting point based on your exam dates, available hours, and reviewed topic evidence.</p></div>{workspace.subjects.length > 0 && <select className="subject-select" aria-label="Choose subject to make a plan" onChange={(event) => { const subject = workspace.subjects.find((item) => item.id === event.target.value); if (subject) onGenerate(subject); }} defaultValue=""><option value="" disabled>Make a plan for…</option>{workspace.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}</div>
    {tasks.length ? <><div className="plan-progress-card card"><div><span className="eyebrow">YOUR MOMENTUM</span><strong>{done} <span>/ {tasks.length}</span></strong><small>study and revision tasks completed</small></div><div className="large-progress"><i style={{ width: `${Math.round(done / tasks.length * 100)}%` }}/></div><span className="progress-percent">{Math.round(done / tasks.length * 100)}%</span></div><div className="plan-toolbar"><div className="filter-tabs">{[["all", "All tasks"], ["open", "To do"], ["done", "Completed"]].map(([id, label]) => <button key={id} className={filter === id ? "selected" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><span>{tasks.reduce((sum, task) => sum + task.minutes, 0)} min planned</span></div>{Object.keys(grouped).length ? <div className="plan-days">{Object.entries(grouped).map(([date, dayTasks]) => <section className="plan-day card" key={date}><div className="plan-day-date"><strong>{date === today() ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}</strong><span>{dateLabel(date)}</span></div><div className="task-list">{dayTasks.map((task) => { const subject = workspace.subjects.find((item) => item.id === task.subjectId); return <div key={task.id} className={`task-row plan-task ${task.done ? "is-done" : ""}`}><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.done} onChange={() => onToggle(task.id)}/><span className="custom-check"><Icon name="check" size={13}/></span><span className="task-text"><strong>{task.title}</strong><small>{subject?.name || "Subject"} · {task.minutes} minutes · {task.kind === "revision" ? "Revision time" : "Focused topic review"}</small></span><button type="button" className="quiet-button" onClick={() => { if (subject) onSubject(subject.id); }}>View subject</button></div>; })}</div></section>)}</div> : <Empty title="Nothing in this filter">Try another filter to see your scheduled study tasks.</Empty>}<p className="plan-disclaimer">This plan is a flexible suggestion based on topics you've entered and papers you've extracted and mapped. Adjust it to your pace. It cannot guarantee exam outcomes.</p></> : <div className="card plan-empty"><span className="empty-mark"><Icon name="plan" size={22}/></span><h2>No study plan yet</h2><p>Choose a subject to create a starter plan. It uses the exam date, available study hours, and topic priorities, with a revision task included.</p>{workspace.subjects.length ? workspace.subjects.map((subject) => <Button key={subject.id} onClick={() => onGenerate(subject)}>{subject.name} <Icon name="arrow" size={15}/></Button>) : <Button kind="primary" onClick={onAddSubject}>Add a subject first</Button>}</div>}
  </div>;
}

function SettingsPage({ workspace, onUpdate, onClear }) {
  const [profile, setProfile] = useState(workspace.profile);
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">YOUR DATA, YOUR CONTROL</div><h1>Privacy & settings</h1><p className="subheading">ExamVault is a local prototype. There is no account service or remote paper storage.</p></div></div>
    <section className="card privacy-detail"><PanelTitle eyebrow="LOCAL-FIRST STORAGE" title="Your papers stay on this device"/><p>Subjects and study plans are saved in this browser’s local storage. Uploaded PDFs and images are saved in this browser’s IndexedDB. The app does not upload paper contents to an ExamVault server or send them to an AI service.</p><p>Image OCR uses Tesseract.js in a browser worker. Its JavaScript/WASM and English-language model are fetched from a public CDN when needed; OCR runs in your browser. PDF text extraction runs with PDF.js in your browser. Use this only on a device and browser profile you control. Anyone with access to that profile may be able to access this workspace.</p><p>This prototype does not provide authentication, encrypted server storage, cross-device sync, or secure owner isolation. Avoid shared or public devices for sensitive material.</p></section>
    <section className="card profile-settings"><PanelTitle eyebrow="STUDENT CONTEXT" title="Study preferences"/><div className="form-grid"><Field label="Branch / program" value={profile.branch || ""} onChange={(event) => setProfile((current) => ({ ...current, branch: event.target.value }))}/><Field label="Semester" value={profile.semester || ""} onChange={(event) => setProfile((current) => ({ ...current, semester: event.target.value }))}/><Field label="Regulation" value={profile.regulation || ""} onChange={(event) => setProfile((current) => ({ ...current, regulation: event.target.value }))}/><Field label="Available study hours / day" type="number" min="1" max="16" value={profile.studyHours || 3} onChange={(event) => setProfile((current) => ({ ...current, studyHours: Number(event.target.value) }))}/></div><div className="form-actions"><Button kind="primary" onClick={() => onUpdate(profile)}>Save preferences</Button></div></section>
    <section className="card delete-zone"><div><div className="eyebrow">PERMANENT ACTION</div><h2>Delete your local workspace</h2><p>Remove every subject, paper, extracted question, uploaded file, and study task stored in this browser.</p></div><Button kind="danger" onClick={onClear}>Delete all local data</Button></section>
  </div>;
}
