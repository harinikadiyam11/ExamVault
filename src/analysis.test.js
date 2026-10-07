import test from "node:test";
import assert from "node:assert/strict";
import { createGroups, createStudyTasks, rankTopics } from "./analysis.js";
import { splitQuestions } from "./extract.js";

const subject = {
  id: "math",
  examDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  studyHours: 2,
  units: [{
    id: "unit-1",
    name: "Unit 1",
    topics: [{ id: "topic-a", name: "Matrices" }, { id: "topic-b", name: "Calculus" }],
  }],
};

const question = (id, topicId, text, marks = null) => ({
  id, text, originalText: text, unitId: topicId ? "unit-1" : "", topicId, marks, status: "ready", reviewed: true,
});

const paper = (id, year, questions) => ({ id, year, status: "ready", questions });

test("priority frequency counts distinct papers, not repeated questions within a paper", () => {
  const papers = [
    paper("p1", 2022, [question("q1", "topic-a", "matrix question"), question("q2", "topic-a", "another matrix question")]),
    paper("p2", 2024, [question("q3", "topic-a", "matrix question again"), question("q4", "topic-b", "calculus question")]),
  ];
  const ranked = rankTopics(subject, papers);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").paperCount, 2);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").frequency, 3);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").priority, 100);
  assert.equal(ranked.find((item) => item.topic.id === "topic-b").priority, 75);
});

test("analysis marks single-paper and unmapped evidence as insufficient", () => {
  const ranked = rankTopics(subject, [paper("p1", null, [question("q1", "topic-a", "matrix question")])]);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").insufficient, true);
  assert.equal(ranked.find((item) => item.topic.id === "topic-b").insufficient, true);
  assert.deepEqual(ranked.find((item) => item.topic.id === "topic-a").years, []);
});

test("unreviewed extraction does not affect topic evidence", () => {
  const extracted = { ...question("q1", "topic-a", "matrix question"), reviewed: false };
  const ranked = rankTopics(subject, [paper("p1", 2023, [extracted])]);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").frequency, 0);
  assert.equal(ranked.find((item) => item.topic.id === "topic-a").paperCount, 0);
});

test("unreviewed papers do not satisfy the minimum evidence threshold", () => {
  const papers = [
    paper("p1", 2022, [{ ...question("q1", "topic-a", "matrix question"), reviewed: false }]),
    paper("p2", 2024, [{ ...question("q2", "topic-a", "matrix question"), reviewed: false }]),
  ];
  assert.ok(rankTopics(subject, papers).every((item) => item.insufficient));
});

test("recency scores do not assign a recency value when paper years are unknown", () => {
  const papers = [
    paper("p1", null, [question("q1", "topic-a", "matrix question")]),
    paper("p2", null, [question("q2", "topic-a", "matrix question")]),
  ];
  assert.equal(rankTopics(subject, papers).find((item) => item.topic.id === "topic-a").priority, 75);
});

test("question splitting preserves question text and does not infer marks", () => {
  const extracted = splitQuestions("1. Explain matrix operations and their applications. (10 marks) 2. Describe calculus applications in engineering.");
  assert.equal(extracted.length, 2);
  assert.match(extracted[0], /^1\./);
  assert.match(extracted[0], /10 marks/);
  assert.match(extracted[1], /calculus applications/);
  assert.deepEqual(splitQuestions("A short heading"), ["A short heading"]);
});

test("similarity groups require multiple papers and honor manual separation", () => {
  const papers = [
    paper("p1", 2022, [question("q1", "topic-a", "Explain the process of solving a matrix using gaussian elimination method")]),
    paper("p2", 2023, [question("q2", "topic-a", "Explain the process of solving a matrix using gaussian elimination method")]),
  ];
  assert.equal(createGroups(papers).length, 1);
  assert.equal(createGroups(papers, ["q2:q1"]).length, 0);
});

test("generated plans fit daily study hours and include revision time", () => {
  const oneHourSubject = { ...subject, studyHours: 1 };
  const tasks = createStudyTasks(oneHourSubject, []);
  assert.equal(tasks.length, 3);
  const dailyMinutes = tasks.reduce((totals, task) => ({ ...totals, [task.date]: (totals[task.date] || 0) + task.minutes }), {});
  assert.ok(Object.values(dailyMinutes).every((minutes) => minutes <= 60));
  assert.equal(tasks.find((task) => task.kind === "revision").minutes, 15);
});
