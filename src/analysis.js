export const uid = () => crypto.randomUUID();

function localDate(offsetDays) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalize(text = "") {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function inferTopic(text, units) {
  const normalized = normalize(text);
  let best = null;
  let bestHits = 0;
  for (const unit of units) {
    for (const topic of unit.topics) {
      const terms = normalize(topic.name).split(" ").filter((word) => word.length > 2);
      const hits = terms.filter((term) => normalized.includes(term)).length;
      if (hits > bestHits) {
        best = { unitId: unit.id, topicId: topic.id };
        bestHits = hits;
      }
    }
  }
  return bestHits ? best : null;
}

export function similarity(a, b) {
  const ignored = new Set(["what", "when", "where", "which", "with", "from", "this", "that", "into", "show", "find", "explain", "derive", "using", "the", "and", "for"]);
  const words = (value) => new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !ignored.has(word)));
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / (left.size + right.size - intersection);
}

export function allQuestions(papers) {
  return papers.flatMap((paper) => (paper.questions || []).filter((question) => question.status === "ready" && question.reviewed === true).map((question) => ({ ...question, paperId: paper.id, year: paper.year })));
}

export function topicEvidence(topic, papers) {
  const questions = allQuestions(papers).filter((question) => question.topicId === topic.id && question.unitId === topic.unitId);
  const paperIds = new Set(questions.map((question) => question.paperId));
  const years = [...new Set(questions.map((question) => question.year).filter(Boolean))].sort((a, b) => b - a);
  const marks = questions.map((question) => question.marks).filter(Number.isFinite);
  return {
    questions,
    paperCount: paperIds.size,
    frequency: questions.length,
    years,
    marks: [...new Set(marks)].sort((a, b) => a - b),
    currentSyllabus: questions.length > 0,
  };
}

export function rankTopics(subject, papers) {
  const topics = subject.units.flatMap((unit) => unit.topics.map((topic) => ({ ...topic, unitId: unit.id, unitName: unit.name })));
  const evidence = topics.map((topic) => ({ topic, ...topicEvidence(topic, papers) }));
  const evidencePaperCount = new Set(allQuestions(papers).map((question) => question.paperId)).size;
  const maxFrequency = Math.max(1, ...evidence.map((item) => item.paperCount));
  const years = allQuestions(papers).map((question) => question.year).filter(Boolean);
  const maxYear = Math.max(0, ...years);
  const minYear = Math.min(maxYear, ...years);
  return evidence.map((item) => {
    const frequencyScore = (item.paperCount / maxFrequency) * 100;
    const recencyScore = item.years.length
      ? maxYear > minYear ? ((Math.max(...item.years) - minYear) / (maxYear - minYear)) * 100 : 50
      : 0;
    const syllabusScore = item.currentSyllabus ? 100 : 0;
    return {
      ...item,
      priority: Math.round(frequencyScore * 0.5 + recencyScore * 0.25 + syllabusScore * 0.25),
      insufficient: evidencePaperCount < 2 || item.paperCount === 0,
    };
  }).sort((a, b) => b.priority - a.priority || b.frequency - a.frequency || a.topic.name.localeCompare(b.topic.name));
}

export function createGroups(papers, separatePairs = []) {
  const questions = allQuestions(papers);
  const groups = [];
  const assigned = new Set();
  const separate = new Set(separatePairs.map((pair) => pair.split(":").sort().join(":")));
  for (let i = 0; i < questions.length; i += 1) {
    if (assigned.has(questions[i].id)) continue;
    const matches = [];
    for (let j = i + 1; j < questions.length; j += 1) {
      const pair = [questions[i].id, questions[j].id].sort().join(":");
      if (questions[i].paperId !== questions[j].paperId && !assigned.has(questions[j].id) && !separate.has(pair) && similarity(questions[i].text, questions[j].text) >= 0.72) matches.push(questions[j]);
    }
    if (matches.length) {
      const members = [questions[i], ...matches];
      members.forEach((question) => assigned.add(question.id));
      groups.push({ key: members.map((question) => question.id).sort().join(":"), questions: members, score: Math.min(...matches.map((question) => similarity(questions[i].text, question.text))) });
    }
  }
  return groups;
}

export function createStudyTasks(subject, papers) {
  const priorities = rankTopics(subject, papers);
  const hours = Math.max(1, Number(subject.studyHours || 3));
  const daysRemaining = Math.max(1, Math.ceil((new Date(`${subject.examDate}T23:59:59`) - new Date()) / 86400000));
  const studySlotsPerDay = Math.max(1, Math.floor((hours * 60 - Math.min(30, hours * 15)) / 45));
  const studySlots = Math.max(1, Math.min(daysRemaining * studySlotsPerDay, priorities.length || 1));
  const selected = priorities.slice(0, studySlots);
  const revisionMinutes = Math.min(30, Math.max(15, hours * 15));
  const tasks = selected.map((item, index) => ({
    id: uid(),
    subjectId: subject.id,
    topicId: item.topic.id,
    title: `Review ${item.topic.name}`,
    date: localDate(Math.floor(index / studySlotsPerDay)),
    minutes: 45,
    done: false,
    kind: "study",
  }));
  if (tasks.length) {
    tasks.push({
      id: uid(),
      subjectId: subject.id,
      topicId: selected[0]?.topic.id,
      title: "Recall and revise the topics you studied",
      date: localDate(Math.max(0, Math.floor(tasks.length / studySlotsPerDay) - 1)),
      minutes: revisionMinutes,
      done: false,
      kind: "revision",
    });
  }
  return tasks;
}
