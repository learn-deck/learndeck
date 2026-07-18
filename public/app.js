const state = { courses: [], course: null, paths: [], pathId: null, overview: null, sectionId: null, answerDirty: false };

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "PatchQuest could not complete that request.");
  return body;
}

async function boot() {
  try {
    state.courses = await api("/api/courses");
    bindEvents();
    await selectCourse(state.courses[0].id);
    $("#connection").textContent = "Local SQLite progress is ready";
  } catch (error) {
    $("#connection").textContent = error.message;
  }
}

function bindEvents() {
  $("#course-choice").addEventListener("change", (event) => selectCourse(event.target.value));
  $("#course-select").addEventListener("change", (event) => selectCourse(event.target.value));
  $("#course-path").addEventListener("change", renderWorkspaceHint);
  $("#path-form").addEventListener("submit", createPath);
  $("#path-select").addEventListener("change", (event) => selectPath(event.target.value));
  $("#confidence").addEventListener("input", (event) => { $("#confidence-value").value = event.target.value; });
  $("#answer-form").addEventListener("submit", submitAnswer);
  $("#answer").addEventListener("input", () => { state.answerDirty = Boolean($("#answer").value.trim()); });
}

async function selectCourse(courseId) {
  state.course = state.courses.find((course) => course.id === courseId);
  if (!state.course) throw new Error("That course is no longer available.");
  state.paths = await api(`/api/courses/${encodeURIComponent(courseId)}/paths`);
  state.pathId = null;
  state.overview = null;
  state.sectionId = null;
  renderPathForm();
  if (state.paths.length) await selectPath(state.paths[0].id);
  else {
    $("#path-setup").classList.remove("hidden");
    $("#course").classList.add("hidden");
  }
}

function renderPathForm() {
  const courseChoices = [$("#course-choice"), $("#course-select")];
  for (const choice of courseChoices) {
    choice.replaceChildren(...state.courses.map((course) => new Option(course.title, course.id, false, course.id === state.course.id)));
  }
  $("#course-description").textContent = state.course.description;
  const coursePath = $("#course-path");
  coursePath.replaceChildren(...state.course.paths.map((path) => new Option(path.label, path.id)));
  renderWorkspaceHint();
}

function renderWorkspaceHint() {
  const path = state.course.paths.find((item) => item.id === $("#course-path").value);
  $("#workspace").placeholder = path.workspaceHint || "A folder or learning context you control";
}

async function createPath(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const path = await api(`/api/courses/${encodeURIComponent(state.course.id)}/paths`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form)),
    });
    state.paths = await api(`/api/courses/${encodeURIComponent(state.course.id)}/paths`);
    await selectPath(path.id);
  } catch (error) {
    alert(error.message);
  }
}

async function selectPath(pathId) {
  state.pathId = pathId;
  state.overview = await api(`/api/paths/${encodeURIComponent(pathId)}/overview`);
  const next = await api(`/api/paths/${encodeURIComponent(pathId)}/next`);
  state.sectionId = state.sectionId ?? next.section.id;
  $("#path-setup").classList.add("hidden");
  $("#course").classList.remove("hidden");
  state.answerDirty = false;
  render();
}

function render() {
  const { path, completedSections, totalSections } = state.overview;
  const pathSelect = $("#path-select");
  pathSelect.replaceChildren(...state.paths.map((item) => new Option(item.label, item.id, false, item.id === path.id)));
  $("#course-select").value = state.course.id;
  $("#course-title").textContent = state.course.title;
  $("#workspace-label").textContent = path.workspacePath;
  const coursePath = state.course.paths.find((item) => item.id === path.coursePathId);
  $("#server-command-wrap").classList.toggle("hidden", !coursePath?.serverCommand);
  $("#server-command").textContent = coursePath?.serverCommand || "";
  $("#progress-summary").textContent = `${completedSections} of ${totalSections} sections complete in this path.`;
  renderSections();
  renderLesson();
}

function progressFor(sectionId) {
  return state.overview.progress.find((item) => item.sectionId === sectionId);
}

function renderSections() {
  const list = $("#section-list");
  list.replaceChildren(...state.course.sections.map((section, index) => {
    const progress = progressFor(section.id);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", section.id === state.sectionId ? "step" : "false");
    button.innerHTML = `<span class="status">${String(index).padStart(2, "0")}</span><span>${escape(section.title)}<br><small class="status">${escape(progress?.status ?? "not_started")}</small></span>`;
    button.addEventListener("click", () => { state.sectionId = section.id; render(); });
    const item = document.createElement("li");
    item.append(button);
    return item;
  }));
}

function nextQuestion(section) {
  return section.questions.find((question) => !state.overview.attempts.some((attempt) => attempt.questionId === question.id && attempt.result === "correct")) ?? section.questions.at(-1);
}

function renderLesson() {
  const section = state.course.sections.find((item) => item.id === state.sectionId);
  const question = nextQuestion(section);
  const index = state.course.sections.indexOf(section);
  $("#section-number").textContent = `Step ${String(index).padStart(2, "0")}`;
  $("#section-title").textContent = section.title;
  $("#section-goal").textContent = section.goal;
  $("#section-action").textContent = section.action;
  $("#sources").innerHTML = section.sources.map((source) => source.startsWith("http")
    ? `<a href="${escape(source)}" target="_blank" rel="noreferrer">${escape(source)}</a>`
    : `<code>${escape(source)}</code>`).join("");
  $("#question-kind").textContent = `${question.kind} question`;
  $("#question-reference").textContent = question.reference;
  $("#question-prompt").textContent = question.prompt;
  $("#answer").value = "";
  state.answerDirty = false;
  $("#answer-form").dataset.questionId = question.id;
  renderAttempts(section.id);
}

function renderAttempts(sectionId) {
  const attempts = state.overview.attempts.filter((item) => item.sectionId === sectionId);
  const list = $("#attempt-list");
  list.replaceChildren();
  if (!attempts.length) {
    list.innerHTML = '<p class="empty">No answer recorded for this section yet.</p>';
    return;
  }
  const template = $("#attempt-template");
  for (const attempt of attempts) {
    const item = template.content.cloneNode(true);
    item.querySelector(".attempt-kind").textContent = attempt.kind;
    item.querySelector(".attempt-result").textContent = attempt.result;
    item.querySelector(".attempt-answer").textContent = attempt.answer;
    item.querySelector(".attempt-feedback").textContent = attempt.feedback ?? "Waiting for agent evaluation.";
    list.append(item);
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  const questionId = event.currentTarget.dataset.questionId;
  try {
    await api("/api/attempts", {
      method: "POST",
      body: JSON.stringify({
        pathId: state.pathId,
        questionId,
        answer: $("#answer").value,
        confidence: Number($("#confidence").value),
      }),
    });
    state.overview = await api(`/api/paths/${encodeURIComponent(state.pathId)}/overview`);
    state.answerDirty = false;
    render();
  } catch (error) {
    alert(error.message);
  }
}

boot();

setInterval(async () => {
  if (!state.pathId || state.answerDirty) return;
  try {
    state.overview = await api(`/api/paths/${encodeURIComponent(state.pathId)}/overview`);
    render();
  } catch {
    // A local server restart should not interrupt an answer the learner is writing.
  }
}, 4_000);
