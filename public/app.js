const state = {
  started: false,
  courses: [],
  catalogue: undefined,
  integrations: [],
  course: null,
  paths: [],
  pathsByCourse: new Map(),
  category: "All",
  pathId: null,
  overview: null,
  sectionId: null,
  answerDirty: false,
  readingObserver: null,
  zen: false,
  zenReturnFocus: null,
  activeGuideId: storedActiveGuide(),
  guideSelection: new Set(),
  guideSetupMessage: "",
  statusMessage: "",
};

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    });
  } catch {
    throw new Error("The local LearnDeck server is not responding. Start it with `bun run app`, then try again.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error([body.error ?? "LearnDeck could not complete that request.", body.userAction].filter(Boolean).join(" "));
  return body;
}

function setNote(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

async function boot() {
  try {
    initializeTheme();
    bindEvents();
  } catch (error) {
    console.error(error);
  }
}

function bindEvents() {
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#zen-toggle").addEventListener("click", toggleZenMode);
  $("#open-setup").addEventListener("click", showLibrary);
  $("#open-guides").addEventListener("click", () => state.started ? showAgentSetup() : startLearnDeck());
  $("#brand-home").addEventListener("click", showHome);
  $("#start-learndeck").addEventListener("click", startLearnDeck);
  $("#close-library").addEventListener("click", showHome);
  $("#category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    renderHome();
    focusFilter(state.category);
  });
  $("#course-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-course-id]");
    if (button?.dataset.courseId) openCourse(button.dataset.courseId);
  });
  $("#start-course").addEventListener("click", continueToCourse);
  $("#integration-list").addEventListener("click", (event) => {
    const disconnect = event.target.closest(".integration-disconnect");
    if (disconnect?.dataset.integrationId) {
      disconnectIntegration(disconnect.dataset.integrationId);
      return;
    }
    const button = event.target.closest(".integration-connect");
    if (!button?.dataset.integrationId) return;
    const integration = state.integrations.find((item) => item.id === button.dataset.integrationId);
    if (integration?.status === "connected") setActiveGuide(integration.id);
    else connectIntegration(button.dataset.integrationId);
  });
  $("#agent-setup-list").addEventListener("click", (event) => {
    const disconnect = event.target.closest(".setup-disconnect");
    if (disconnect?.dataset.integrationId) {
      disconnectIntegration(disconnect.dataset.integrationId);
      return;
    }
    const connect = event.target.closest(".setup-connect");
    if (connect?.dataset.integrationId) connectIntegration(connect.dataset.integrationId);
  });
  $("#agent-setup-list").addEventListener("change", updateGuideSelection);
  $("#active-guide-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-guide-id]");
    if (button?.dataset.guideId) setActiveGuide(button.dataset.guideId);
  });
  $("#connect-selected-guides").addEventListener("click", connectSelectedGuides);
  $("#continue-to-library").addEventListener("click", () => { ensureActiveGuide(); updateGuideButton(); showLibrary(); });
  $("#continue-without-guide").addEventListener("click", continueWithoutGuide);
  $("#path-form").addEventListener("submit", createPath);
  $("#change-workspace").addEventListener("click", showWorkspaceSetup);
  $("#export-path").addEventListener("click", exportPath);
  $("#reset-path").addEventListener("click", resetPath);
  $("#confidence").addEventListener("input", (event) => { $("#confidence-value").value = event.target.value; });
  $("#answer-form").addEventListener("submit", submitAnswer);
  $("#answer").addEventListener("input", () => { state.answerDirty = Boolean($("#answer").value.trim()); });
  $("#answer").addEventListener("focus", () => document.body.classList.add("is-answering"));
  $("#answer").addEventListener("blur", () => document.body.classList.remove("is-answering"));
  document.addEventListener("keydown", handleGlobalKeydown);
  $("#lesson-content").addEventListener("click", (event) => {
    const button = event.target.closest(".copy-code");
    if (button) copyCode(button);
  });
  $("#lesson-content").addEventListener("input", persistEmbeddedControl);
  $("#lesson-content").addEventListener("change", persistEmbeddedControl);
  $("#attempt-list").addEventListener("click", (event) => {
    const button = event.target.closest(".self-review");
    if (button?.dataset.attemptId) selfReviewAttempt(Number(button.dataset.attemptId));
  });
  $("#evidence-form").addEventListener("submit", recordEvidence);
}

function initializeTheme() {
  let theme = "dark";
  try { theme = localStorage.getItem("learndeck-theme") || theme; } catch { /* Local storage is optional. */ }
  setTheme(theme);
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $("#theme-toggle");
  const isDark = theme === "dark";
  button.textContent = isDark ? "☼" : "◐";
  button.setAttribute("aria-label", isDark ? "Use light theme" : "Use dark theme");
  button.title = button.getAttribute("aria-label");
  try { localStorage.setItem("learndeck-theme", theme); } catch { /* Local storage is optional. */ }
}

function toggleZenMode() {
  if (!state.zen) state.zenReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $("#zen-toggle");
  state.zen = !state.zen;
  document.body.classList.toggle("zen-mode", state.zen);
  const button = $("#zen-toggle");
  button.textContent = state.zen ? "Exit focus" : "Focus mode";
  button.setAttribute("aria-pressed", String(state.zen));
  if (state.zen) {
    focusSurface("#zen-toggle");
  } else {
    const returnFocus = state.zenReturnFocus;
    state.zenReturnFocus = null;
    if (returnFocus?.isConnected && !returnFocus.closest(".hidden")) returnFocus.focus({ preventScroll: true });
    else focusSurface("#zen-toggle");
  }
}

function handleGlobalKeydown(event) {
  if (state.zen && event.key === "Escape") {
    event.preventDefault();
    toggleZenMode();
  }
}

function focusSurface(selector) {
  const target = $(selector);
  if (!target) return;
  target.focus({ preventScroll: true });
}

function focusFilter(category) {
  const button = [...document.querySelectorAll("#category-filters [data-category]")].find((item) => item.dataset.category === category);
  button?.focus({ preventScroll: true });
}

function renderIntegrations() {
  const list = $("#integration-list");
  const template = $("#integration-template");
  list.replaceChildren();
  for (const integration of state.integrations) {
    const item = template.content.cloneNode(true);
    const card = item.querySelector(".integration-card");
    card.dataset.active = String(integration.status === "connected" && integration.id === state.activeGuideId);
    item.querySelector(".integration-label").textContent = integration.label;
    item.querySelector(".integration-mark").textContent = integrationMark(integration.id);
    item.querySelector(".integration-state").textContent = integrationStatusLabel(integration.status);
    item.querySelector(".integration-next").textContent = integration.nextStep;
    item.querySelector(".integration-explanation").textContent = integration.explanation || `Config file: ${integration.configPath}`;
    item.querySelector(".integration-explanation").classList.toggle("hidden", !integration.explanation && integration.status === "not_found");
    const button = item.querySelector(".integration-connect");
    button.dataset.integrationId = integration.id;
    button.textContent = integration.status === "connected"
      ? integration.id === state.activeGuideId ? "Using" : "Use this guide"
      : integration.status === "stale" ? "Reconnect"
        : integration.status === "detected" ? "Connect" : "Not detected";
    button.disabled = integration.status === "not_found" || (integration.status === "connected" && integration.id === state.activeGuideId);
    const disconnect = item.querySelector(".integration-disconnect");
    disconnect.dataset.integrationId = integration.id;
    disconnect.classList.toggle("hidden", integration.status !== "connected");
    list.append(item);
  }
  const activeGuide = activeGuideIntegration();
  $("#integration-status").textContent = activeGuide
    ? `Selected guide: ${activeGuide.label}. It shares the same local progress; it is not assumed to be reading or evaluating this lesson.`
    : "No active guide. You can complete every lesson on your own, then connect a guide later.";
}

function integrationMark(id) {
  return ({ codex: "CO", cursor: "CU", "claude-code": "CC" })[id] || "AI";
}

function integrationStatusLabel(status) {
  return ({ connected: "Connected", stale: "Stale configuration", detected: "Detected", not_found: "Not found" })[status] || status;
}

async function connectIntegration(id) {
  const integration = state.integrations.find((item) => item.id === id);
  if (!integration || !window.confirm(`${integration.status === "stale" ? "Reconnect" : "Connect"} ${integration.label}? LearnDeck will change only its own MCP entry, then you will restart the host.`)) return;
  const button = document.querySelector(`.integration-connect[data-integration-id="${id}"], .setup-connect[data-integration-id="${id}"]`);
  if (!button) return;
  button.disabled = true;
  button.textContent = integration.status === "stale" ? "Reconnecting…" : "Connecting…";
  try {
    const result = await api(`/api/integrations/${encodeURIComponent(id)}/connect`, { method: "POST", body: "{}" });
    state.integrations = await api("/api/integrations");
    state.activeGuideId = result.status === "connected" ? result.id : id;
    persistActiveGuide();
    renderIntegrations();
    renderAgentSetup();
    updateGuideButton();
    $("#integration-status").textContent = `${integration.label} connected. Config file changed: ${result.configPath}. ${result.nextStep}`;
    $("#agent-setup-status").textContent = `${integration.label} connected. Config file changed: ${result.configPath}. ${result.nextStep}`;
    focusSurface("#integration-status");
  } catch (error) {
    $("#integration-status").textContent = error.message;
    $("#agent-setup-status").textContent = error.message;
    button.disabled = false;
    button.textContent = integration.status === "stale" ? "Reconnect" : "Connect";
  }
}

async function disconnectIntegration(id) {
  const integration = state.integrations.find((item) => item.id === id);
  if (!integration || integration.status !== "connected") return;
  if (!window.confirm(`Disconnect ${integration.label}? This removes only LearnDeck's entry from ${integration.configPath}.`)) return;
  try {
    const result = await api(`/api/integrations/${encodeURIComponent(id)}/connect`, { method: "DELETE" });
    state.integrations = await api("/api/integrations");
    if (state.activeGuideId === id) {
      state.activeGuideId = null;
      persistActiveGuide();
    }
    renderIntegrations();
    renderAgentSetup();
    updateGuideButton();
    const message = result.message || `Disconnected ${integration.label}. File changed: ${result.configPath}.`;
    $("#integration-status").textContent = `${message} No active guide is selected.`;
    $("#agent-setup-status").textContent = message;
    focusSurface("#integration-status");
  } catch (error) {
    $("#integration-status").textContent = error.message;
    $("#agent-setup-status").textContent = error.message;
    focusSurface("#integration-status");
  }
}

function storedActiveGuide() {
  try {
    const value = localStorage.getItem("learndeck-active-guide");
    return value && value !== "none" ? value : null;
  } catch { return null; }
}

function activeGuideIntegration() {
  return state.integrations.find((item) => item.id === state.activeGuideId && item.status === "connected");
}

function ensureActiveGuide() {
  if (state.activeGuideId && activeGuideIntegration()) return;
  state.activeGuideId = null;
  persistActiveGuide();
}

function persistActiveGuide() {
  try { localStorage.setItem("learndeck-active-guide", state.activeGuideId || "none"); } catch { /* A remembered guide is optional. */ }
}

function setActiveGuide(id) {
  if (id === "none") {
    state.activeGuideId = null;
    persistActiveGuide();
    state.guideSetupMessage = "No active guide is selected. You can continue without guide evaluation.";
  } else {
    const guide = state.integrations.find((item) => item.id === id && item.status === "connected");
    if (!guide) return;
    state.activeGuideId = guide.id;
    persistActiveGuide();
    state.guideSetupMessage = `${guide.label} is selected. It shares local progress; guide feedback remains optional.`;
  }
  renderAgentSetup();
  renderIntegrations();
  updateGuideButton();
  if (state.pathId) render();
  document.querySelector(`[data-guide-id="${id}"]`)?.focus({ preventScroll: true });
}

function continueWithoutGuide() {
  setActiveGuide("none");
  $("#integration-status").textContent = "No active guide selected. You can continue without guide evaluation.";
  focusSurface("#integration-status");
}

function updateGuideButton() {
  const button = $("#open-guides");
  const guide = activeGuideIntegration();
  button.textContent = guide ? `Guide: ${guide.label}` : "AI guides";
  button.title = guide ? `Active guide: ${guide.label}. Change guides.` : "Connect or choose an AI guide";
}

function updateGuideSelection(event) {
  const input = event.target.closest("input[data-integration-id]");
  if (!input?.dataset.integrationId) return;
  const guideId = input.dataset.integrationId;
  if (input.checked) state.guideSelection.add(input.dataset.integrationId);
  else state.guideSelection.delete(input.dataset.integrationId);
  renderAgentSetup();
  document.querySelector(`input[data-integration-id="${guideId}"]`)?.focus({ preventScroll: true });
}

function renderAgentSetup() {
  const list = $("#agent-setup-list");
  list.replaceChildren();
  const selectable = state.integrations.filter((integration) => integration.status === "detected");
  for (const integration of state.integrations) {
    const card = document.createElement("article");
    card.className = `guide-setup-option${integration.detected ? "" : " is-unavailable"}`;
    const label = document.createElement("label");
    label.className = "guide-select-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.integrationId = integration.id;
    input.checked = integration.status === "connected" || state.guideSelection.has(integration.id);
    input.disabled = integration.status !== "detected";
    const mark = document.createElement("span");
    mark.className = "integration-mark";
    mark.textContent = integrationMark(integration.id);
    const copy = document.createElement("span");
    copy.className = "guide-setup-copy";
    copy.innerHTML = `<strong>${escape(integration.label)}</strong><span>${escape(integration.explanation || integration.nextStep)}</span>`;
    label.append(input, mark, copy);
    const status = document.createElement("span");
    status.className = `guide-setup-state guide-setup-${integration.status}`;
    status.textContent = integrationStatusLabel(integration.status);
    card.append(label, status);
    if (integration.status === "connected") {
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "setup-disconnect text-button";
      disconnect.dataset.integrationId = integration.id;
      disconnect.textContent = "Disconnect";
      card.append(disconnect);
    } else if (integration.status === "stale") {
      const reconnect = document.createElement("button");
      reconnect.type = "button";
      reconnect.className = "setup-connect text-button";
      reconnect.dataset.integrationId = integration.id;
      reconnect.textContent = "Reconnect";
      card.append(reconnect);
    }
    list.append(card);
  }

  const options = $("#active-guide-options");
  const configured = state.integrations.filter((integration) => integration.status === "connected");
  options.classList.toggle("hidden", !configured.length);
  options.replaceChildren();
  const copy = document.createElement("p");
  copy.className = "active-guide-copy";
  copy.textContent = "Choose the active guide for this session";
  const buttons = document.createElement("div");
  buttons.className = "active-guide-buttons";
  const none = document.createElement("button");
  none.type = "button";
  none.className = "guide-switch";
  none.dataset.guideId = "none";
  none.textContent = "No active guide";
  none.setAttribute("aria-pressed", String(!activeGuideIntegration()));
  buttons.append(none);
  for (const integration of configured) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guide-switch";
    button.dataset.guideId = integration.id;
    button.textContent = integration.label;
    button.setAttribute("aria-pressed", String(integration.id === state.activeGuideId));
    buttons.append(button);
  }
  options.append(copy, buttons);

  const connect = $("#connect-selected-guides");
  connect.disabled = !selectable.some((integration) => state.guideSelection.has(integration.id));
  const selected = selectable.filter((integration) => state.guideSelection.has(integration.id));
  connect.innerHTML = selected.length ? `Connect ${selected.length === 1 ? selected[0].label : `${selected.length} selected guides`} <span aria-hidden="true">→</span>` : "Connect selected guides";
  $("#agent-setup-status").textContent = state.guideSetupMessage || (activeGuideIntegration()
    ? `${activeGuideIntegration().label} is selected. Connected guides share local progress.`
    : selectable.length ? "Pick any detected guide, or skip and connect one later. Connecting changes only LearnDeck's local MCP entry."
      : "No guides detected on this Mac yet. You can skip for now and connect one later.");
}

async function connectSelectedGuides() {
  const selected = state.integrations.filter((integration) => state.guideSelection.has(integration.id) && integration.status === "detected");
  if (!selected.length) return;
  const button = $("#connect-selected-guides");
  button.disabled = true;
  button.textContent = "Connecting guides…";
  state.guideSetupMessage = "Adding LearnDeck's local MCP entry to your selected guides…";
  $("#agent-setup-status").textContent = state.guideSetupMessage;
  const failures = [];
  const connected = [];
  for (const integration of selected) {
    try {
      connected.push(await api(`/api/integrations/${encodeURIComponent(integration.id)}/connect`, { method: "POST", body: "{}" }));
    } catch (error) {
      failures.push(`${integration.label}: ${error.message}`);
    }
  }
  try {
    state.integrations = await api("/api/integrations");
  } catch (error) {
    failures.push(`Guide status refresh failed: ${error.message}`);
  }
  state.guideSelection.clear();
  if (connected.length) {
    state.activeGuideId = connected[0].id;
    persistActiveGuide();
  }
  const connectionDetails = connected.map((result) => `${result.label}: ${result.configPath}; ${result.nextStep}`).join(" ");
  state.guideSetupMessage = [
    failures.length ? `Some guides need attention. ${failures.join(" ")}` : "",
    connected.length ? `${connected.map((result) => result.label).join(" and ")} ${connected.length === 1 ? "is" : "are"} connected. ${connectionDetails}` : "",
  ].filter(Boolean).join(" ");
  renderAgentSetup();
  renderIntegrations();
  updateGuideButton();
  if (connected.length && !failures.length) {
    state.guideSetupMessage = "";
    showLibrary();
    setNote($("#library-status"), `${connected.map((result) => result.label).join(" and ")} connected. ${connected.map((result) => result.nextStep).join(" ")}`);
    return;
  }
  focusSurface("#agent-setup-status");
}

async function continueToCourse() {
  const button = $("#start-course");
  button.disabled = true;
  try {
    if (state.paths.length) await selectPath(state.paths[0].id);
    else showWorkspaceSetup();
  } catch (error) {
    $("#brief-resume-note").textContent = `Could not open the course: ${error.message}`;
    focusSurface("#brief-resume-note");
  } finally {
    button.disabled = false;
  }
}

function showHome() {
  $("#agent-setup").classList.add("hidden");
  $("#course").classList.add("hidden");
  $("#course-briefing").classList.add("hidden");
  $("#path-setup").classList.add("hidden");
  $("#home").classList.remove("hidden");
  $("#welcome-screen").classList.remove("hidden");
  $("#course-library").classList.add("hidden");
  if (state.started) renderHome();
  focusSurface("#home-title");
}

function showLibrary() {
  if (!state.started) {
    startLearnDeck();
    return;
  }
  $("#course").classList.add("hidden");
  $("#agent-setup").classList.add("hidden");
  $("#course-briefing").classList.add("hidden");
  $("#path-setup").classList.add("hidden");
  $("#home").classList.remove("hidden");
  $("#welcome-screen").classList.add("hidden");
  $("#course-library").classList.remove("hidden");
  setNote($("#library-status"), "");
  renderHome();
  focusSurface("#library-title");
}

function showAgentSetup() {
  if (!state.started) {
    startLearnDeck();
    return;
  }
  $("#home").classList.add("hidden");
  $("#welcome-screen").classList.add("hidden");
  $("#course-library").classList.add("hidden");
  $("#course").classList.add("hidden");
  $("#course-briefing").classList.add("hidden");
  $("#path-setup").classList.add("hidden");
  $("#agent-setup").classList.remove("hidden");
  renderAgentSetup();
  updateGuideButton();
  focusSurface("#agent-setup-title");
}

async function startLearnDeck() {
  if (state.started) {
    showLibrary();
    return;
  }
  const button = $("#start-learndeck");
  button.disabled = true;
  button.textContent = "Preparing LearnDeck…";
  $("#start-status").textContent = "Preparing local progress and loading your course library…";
  try {
    const bootstrap = await api("/api/bootstrap", { method: "POST", body: "{}" });
    state.courses = bootstrap.courses;
    state.catalogue = bootstrap.catalogue;
    state.integrations = bootstrap.integrations;
    const records = await Promise.all(state.courses.map(async (course) => [course.id, await api(`/api/courses/${encodeURIComponent(course.id)}/paths`)]));
    state.pathsByCourse = new Map(records);
    state.started = true;
    state.guideSelection = new Set(state.integrations.filter((integration) => integration.status === "detected").map((integration) => integration.id));
    ensureActiveGuide();
    updateGuideButton();
    button.disabled = false;
    button.innerHTML = "Browse courses <span aria-hidden=\"true\">→</span>";
    $("#start-status").textContent = "LearnDeck is ready. Your progress stays on this Mac.";
    if (state.integrations.some((integration) => integration.status === "connected")) showLibrary();
    else showAgentSetup();
  } catch (error) {
    $("#start-status").textContent = `${error.message} Then press the button to try again.`;
    button.disabled = false;
    button.innerHTML = "Try starting again <span aria-hidden=\"true\">→</span>";
  }
}

function showCourseBriefing() {
  $("#home").classList.add("hidden");
  $("#agent-setup").classList.add("hidden");
  $("#course").classList.add("hidden");
  $("#path-setup").classList.add("hidden");
  $("#course-briefing").classList.remove("hidden");
  renderCourseBriefing();
  renderIntegrations();
  focusSurface("#brief-title");
}

function showWorkspaceSetup() {
  $("#home").classList.add("hidden");
  $("#agent-setup").classList.add("hidden");
  $("#course-briefing").classList.add("hidden");
  $("#course").classList.add("hidden");
  $("#path-setup").classList.remove("hidden");
  renderWorkspaceSetup();
  focusSurface("#setup-title");
}

async function selectCourse(courseId) {
  state.course = state.courses.find((course) => course.id === courseId);
  if (!state.course) throw new Error("That course is no longer available.");
  state.paths = await api(`/api/courses/${encodeURIComponent(courseId)}/paths`);
  state.pathsByCourse.set(courseId, state.paths);
  state.pathId = null;
  state.overview = null;
  state.sectionId = null;
  renderCourseBriefing();
}

async function openCourse(courseId) {
  const status = $("#library-status");
  try {
    setNote(status, "Opening course…");
    await selectCourse(courseId);
    setNote(status, "");
    showCourseBriefing();
  } catch (error) {
    setNote(status, `Could not open this course: ${error.message} Go back and reopen the library to refresh it.`, true);
    focusSurface("#library-status");
  }
}

function renderHome() {
  renderCatalogueProvenance();
  const categories = ["All", ...new Set(state.courses.map((course) => course.category).filter(Boolean).sort())];
  if (!categories.includes(state.category)) state.category = "All";
  $("#category-filters").replaceChildren(...categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.category = category;
    button.textContent = category;
    button.setAttribute("aria-pressed", String(category === state.category));
    return button;
  }));
  const visibleCourses = state.category === "All" ? state.courses : state.courses.filter((course) => course.category === state.category);
  $("#library-count").textContent = `${visibleCourses.length} ${visibleCourses.length === 1 ? "course" : "courses"}`;
  const grid = $("#course-grid");
  if (!visibleCourses.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state.courses.length
      ? "No courses in this category yet. Pick another category above."
      : "No courses are available yet. Check the catalogue configuration, restart LearnDeck, or contribute one below.";
    grid.replaceChildren(empty);
    return;
  }
  grid.replaceChildren(...visibleCourses.map((course) => courseCard(course)));
}

function renderCatalogueProvenance() {
  const panel = $("#catalogue-provenance");
  const label = $("#catalogue-provenance-label");
  const warning = $("#catalogue-provenance-warning");
  const catalogue = state.catalogue;
  if (!catalogue || !["bundled", "live", "cached"].includes(catalogue.source)) {
    panel.classList.add("hidden");
    label.textContent = "";
    warning.textContent = "";
    return;
  }
  const synced = catalogue.syncedAt ? formatCatalogueTime(catalogue.syncedAt) : "";
  label.textContent = catalogue.source === "bundled"
    ? "Bundled course packs · offline fallback"
    : catalogue.source === "live"
      ? synced ? `GitHub catalogue · synced ${synced}` : "GitHub catalogue"
      : "GitHub catalogue · cached copy";
  warning.textContent = catalogue.warning || "";
  warning.classList.toggle("hidden", !catalogue.warning);
  panel.classList.remove("hidden");
}

function formatCatalogueTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function courseCard(course) {
  const records = state.pathsByCourse.get(course.id) ?? [];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "course-card";
  button.dataset.courseId = course.id;
  button.innerHTML = `
    <span class="course-card-top"><span>${escape(course.category)}</span><span>${escape(course.overview.level)}</span></span>
    <strong>${escape(course.title)}</strong>
    <span class="course-card-description">${escape(course.description)}</span>
    <span class="course-card-meta"><span>${escape(course.overview.duration)}</span><span>${course.sections.length} lessons</span></span>
    <span class="course-card-tags">${course.tags.slice(0, 3).map((tag) => `<i>${escape(tag)}</i>`).join("")}</span>
    <span class="course-card-action">${records.length ? "Continue course" : "View course"} <b aria-hidden="true">→</b></span>`;
  return button;
}

function renderCourseBriefing() {
  if (!state.course) return;
  const { overview, sections } = state.course;
  $("#brief-title").textContent = state.course.title;
  $("#brief-description").textContent = state.course.description;
  $("#brief-duration").textContent = overview.duration;
  $("#brief-session-length").textContent = overview.sessionLength;
  $("#brief-level").textContent = overview.level;
  $("#brief-outcomes").replaceChildren(...overview.outcomes.map((outcome) => listItem(outcome)));
  $("#brief-prerequisites").replaceChildren(...overview.prerequisites.map((prerequisite) => listItem(prerequisite)));
  $("#brief-roadmap").replaceChildren(...sections.map((section, index) => {
    const item = document.createElement("li");
    item.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>${escape(section.title)}</strong>`;
    return item;
  }));
  const continuing = state.paths.length > 0;
  $("#start-course").innerHTML = continuing ? "Resume the course <span aria-hidden=\"true\">→</span>" : "Start the course <span aria-hidden=\"true\">→</span>";
  $("#brief-resume-note").textContent = continuing ? "Your latest lesson and answers are waiting on this Mac." : "No previous setup needed. You will choose one project folder next.";
}

function listItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function defaultCoursePath() {
  const coursePath = state.course?.paths[0];
  if (!coursePath) throw new Error("This course has no configured runtime.");
  return coursePath;
}

function renderWorkspaceSetup() {
  const coursePath = defaultCoursePath();
  $("#setup-course-title").textContent = state.course.title;
  $("#setup-server-command").textContent = coursePath.serverCommand || "Use the course instructions";
  $("#workspace").placeholder = coursePath.workspaceHint || "../ddd-backend";
}

async function createPath(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector("button[type=submit]");
  const status = $("#path-form-status");
  submit.disabled = true;
  setNote(status, "Preparing your workspace…");
  try {
    const workspacePath = String(form.get("workspacePath") || "").trim();
    const path = await api(`/api/courses/${encodeURIComponent(state.course.id)}/paths`, {
      method: "POST",
      body: JSON.stringify({
        coursePathId: defaultCoursePath().id,
        workspacePath,
        label: "My DDD backend",
      }),
    });
    state.paths = await api(`/api/courses/${encodeURIComponent(state.course.id)}/paths`);
    setNote(status, "");
    await selectPath(path.id);
  } catch (error) {
    setNote(status, `${error.message} Use an absolute path to a folder whose parent already exists, then try again.`, true);
  } finally {
    submit.disabled = false;
  }
}

async function selectPath(pathId) {
  state.pathId = pathId;
  state.overview = await api(`/api/paths/${encodeURIComponent(pathId)}/overview`);
  const next = await api(`/api/paths/${encodeURIComponent(pathId)}/next`);
  state.sectionId = state.sectionId ?? next.section.id;
  state.statusMessage = "";
  $("#path-setup").classList.add("hidden");
  $("#home").classList.add("hidden");
  $("#agent-setup").classList.add("hidden");
  $("#course-briefing").classList.add("hidden");
  $("#course").classList.remove("hidden");
  state.answerDirty = false;
  render();
  focusSurface("#section-title");
}

function render() {
  const { path, completedSections, totalSections } = state.overview;
  $("#course-title").textContent = state.course.title;
  $("#course-meta").textContent = `${state.course.overview.duration} · ${totalSections} lessons · Node.js + TypeScript`;
  $("#workspace-label").textContent = path.workspacePath;
  const coursePath = state.course.paths.find((item) => item.id === path.coursePathId);
  $("#server-command-wrap").classList.toggle("hidden", !coursePath?.serverCommand);
  $("#server-command").textContent = coursePath?.serverCommand || "";
  const sectionIndex = state.course.sections.findIndex((section) => section.id === state.sectionId);
  const sectionProgress = progressFor(state.sectionId);
  $("#section-position").textContent = `Section ${sectionIndex + 1} of ${totalSections}`;
  $("#section-status").textContent = sectionStatusLabel(sectionProgress?.status, completedSections);
  const selfReviewed = state.overview.progress.filter((item) => item.status === "self_reviewed").length;
  $("#progress-summary").textContent = state.statusMessage || `${completedSections} complete${selfReviewed ? ` · ${selfReviewed} continued without guide evaluation` : ""} · Your progress is saved on this Mac.`;
  updateProgressBar(sectionIndex, 0.12);
  renderSections();
  renderLesson();
}

function sectionStatusLabel(status, completedSections) {
  return ({ complete: "Complete", self_reviewed: "Continued without guide evaluation", active: `${completedSections} complete · In progress`, revision: "Revision needed" })[status]
    || `${completedSections} complete`;
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
    button.innerHTML = `<span class="status">${String(index).padStart(2, "0")}</span><span>${escape(section.title)}<br><small class="status">${escape(sectionStatusLabel(progress?.status, state.overview.completedSections))}</small></span>`;
    button.addEventListener("click", () => { state.sectionId = section.id; render(); focusSurface("#section-title"); });
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
  renderLessonContent(section.content);
  $("#sources-count").textContent = `(${section.sources.length})`;
  $("#sources-list").innerHTML = section.sources.map((source) => source.startsWith("http")
    ? `<a href="${escape(source)}" target="_blank" rel="noreferrer">${escape(source)}</a>`
    : `<code>${escape(source.split("/").at(-1))}</code>`).join("");
  const answerForm = $("#answer-form");
  answerForm.classList.toggle("hidden", !question);
  if (question) {
    $("#question-kind").textContent = `${question.kind} question`;
    $("#question-reference").textContent = question.reference;
    $("#question-prompt").textContent = question.prompt;
    if (answerForm.dataset.questionId !== question.id) {
      $("#answer").value = "";
      state.answerDirty = false;
      setNote($("#answer-status"), "");
    }
    answerForm.dataset.questionId = question.id;
  }
  renderAttempts(section.id);
  renderEvidence(section.id);
  observeLessonProgress(index);
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
    const article = item.querySelector(".attempt");
    article.dataset.result = attempt.result;
    article.dataset.attemptId = attempt.id;
    item.querySelector(".attempt-kind").textContent = attempt.kind;
    item.querySelector(".attempt-result").textContent = attemptLabel(attempt.result);
    item.querySelector(".attempt-answer").textContent = attempt.answer;
    item.querySelector(".attempt-feedback").textContent = attempt.feedback ?? attemptResultMessage(attempt.result);
    const selfReview = item.querySelector(".self-review");
    selfReview.dataset.attemptId = String(attempt.id);
    selfReview.hidden = attempt.result !== "submitted" || Boolean(activeGuideIntegration());
    list.append(item);
  }
}

function attemptLabel(result) {
  return ({ submitted: "Submitted — waiting for optional guide feedback", self_reviewed: "Continued without guide evaluation", correct: "✓ Understood", partial: "↗ Revise", incorrect: "! Try again" })[result] || result;
}

function attemptResultMessage(result) {
  return ({ submitted: "Submitted — waiting for optional guide feedback", self_reviewed: "Continued without guide evaluation" })[result] || "Waiting for optional guide feedback.";
}

async function selfReviewAttempt(attemptId) {
  if (activeGuideIntegration()) return;
  const button = document.querySelector(`.self-review[data-attempt-id="${attemptId}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Continuing…";
  }
  try {
    await api(`/api/attempts/${encodeURIComponent(attemptId)}/self-review`, { method: "POST", body: "{}" });
    state.overview = await api(`/api/paths/${encodeURIComponent(state.pathId)}/overview`);
    const next = await api(`/api/paths/${encodeURIComponent(state.pathId)}/next`);
    state.sectionId = next.section.id;
    state.statusMessage = "Continued without guide evaluation";
    render();
    focusSurface("#progress-summary");
  } catch (error) {
    const message = `Could not continue without guide evaluation: ${error.message}`;
    state.statusMessage = message;
    $("#progress-summary").textContent = message;
    focusSurface("#progress-summary");
    if (button) {
      button.disabled = false;
      button.textContent = "Mark as self-reviewed and continue";
    }
  }
}

function evidenceRecordsFor(sectionId) {
  const overviewEvidence = Array.isArray(state.overview?.evidence)
    ? state.overview.evidence.filter((item) => item.sectionId === sectionId)
    : [];
  if (overviewEvidence.length) return overviewEvidence;
  const progress = progressFor(sectionId);
  if (!progress?.evidence) return [];
  return [{
    id: `legacy-${sectionId}`,
    sectionId,
    note: progress.evidence,
    source: progress.evidenceSource || "guide",
    recordedAt: progress.updatedAt,
  }];
}

function renderEvidence(sectionId) {
  const list = $("#evidence-list");
  list.replaceChildren();
  const records = evidenceRecordsFor(sectionId);
  if (!records.length) {
    list.innerHTML = '<p class="empty">No evidence recorded for this section yet.</p>';
    return;
  }
  for (const record of records) {
    const article = document.createElement("article");
    article.className = `evidence-record evidence-${record.source === "learner" ? "learner" : "guide"}`;
    const heading = document.createElement("div");
    heading.className = "evidence-record-heading";
    const source = document.createElement("strong");
    source.textContent = record.source === "learner" ? "Learner evidence" : "Guide evidence";
    const time = document.createElement("time");
    if (record.recordedAt) {
      time.dateTime = record.recordedAt;
      time.textContent = formatCatalogueTime(record.recordedAt);
    }
    heading.append(source, time);
    const note = document.createElement("p");
    note.textContent = record.note ?? record.evidence ?? "";
    article.append(heading, note);
    if (record.ref) {
      const reference = document.createElement("p");
      reference.className = "evidence-reference";
      reference.textContent = `Ref: ${record.ref}`;
      article.append(reference);
    }
    list.append(article);
  }
}

async function recordEvidence(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const note = String(data.get("note") || "").trim();
  const ref = String(data.get("ref") || "").trim();
  const status = $("#evidence-status");
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  setNote(status, "Recording evidence…");
  try {
    await api(`/api/paths/${encodeURIComponent(state.pathId)}/evidence`, {
      method: "POST",
      body: JSON.stringify({ sectionId: state.sectionId, note, ...(ref ? { ref } : {}) }),
    });
    state.overview = await api(`/api/paths/${encodeURIComponent(state.pathId)}/overview`);
    form.reset();
    render();
    setNote(status, "Learner evidence recorded.");
    focusSurface("#evidence-status");
  } catch (error) {
    setNote(status, `Evidence could not be recorded: ${error.message} Your note is still in the form — try again.`, true);
    focusSurface("#evidence-status");
  } finally {
    submit.disabled = false;
  }
}

async function exportPath() {
  if (!state.pathId) return;
  const button = $("#export-path");
  button.disabled = true;
  try {
    const response = await fetch(`/api/paths/${encodeURIComponent(state.pathId)}/export`, { headers: { accept: "application/json" } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "LearnDeck could not export this path.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `learndeck-${state.pathId}.json`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $("#path-actions-status").textContent = `Progress exported as ${filename}.`;
    focusSurface("#path-actions-status");
  } catch (error) {
    $("#path-actions-status").textContent = `Export could not be downloaded: ${error.message}`;
    focusSurface("#path-actions-status");
  } finally {
    button.disabled = false;
  }
}

async function resetPath() {
  if (!state.pathId) return;
  if (!window.confirm("Reset this path? This removes the saved path, attempts, evidence, and section progress. LearnDeck will report the exact removed counts after reset.")) return;
  const button = $("#reset-path");
  button.disabled = true;
  try {
    const result = await api(`/api/paths/${encodeURIComponent(state.pathId)}`, { method: "DELETE" });
    const message = `Reset complete. Removed ${result.attempts} attempts, ${result.evidence} evidence records, and ${result.progressRows} progress rows.`;
    state.paths = await api(`/api/courses/${encodeURIComponent(state.course.id)}/paths`);
    state.pathsByCourse.set(state.course.id, state.paths);
    state.pathId = null;
    state.overview = null;
    state.sectionId = null;
    state.statusMessage = "";
    showCourseBriefing();
    $("#brief-resume-note").textContent = message;
    focusSurface("#brief-resume-note");
  } catch (error) {
    $("#path-actions-status").textContent = `Path could not be reset: ${error.message}`;
    focusSurface("#path-actions-status");
  } finally {
    button.disabled = false;
  }
}

function updateProgressBar(sectionIndex, sectionProgress) {
  const overall = Math.min(100, Math.round(((sectionIndex + sectionProgress) / state.course.sections.length) * 100));
  $("#progress-fill").style.width = `${overall}%`;
  $(".progress-track").setAttribute("aria-valuenow", String(overall));
}

function observeLessonProgress(sectionIndex) {
  state.readingObserver?.disconnect();
  const targets = [$(".lesson-head"), $(".action-block"), $(".lesson-content"), $(".answer-form")];
  const reached = new Set();
  state.readingObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) reached.add(entry.target);
    updateProgressBar(sectionIndex, Math.max(.12, reached.size / targets.length));
  }, { threshold: .55 });
  targets.forEach((target) => state.readingObserver.observe(target));
}

function renderLessonContent(markdown) {
  $("#lesson-content").innerHTML = markdownToHtml(learnerMarkdown(markdown));
}

function learnerMarkdown(markdown) {
  const learnerOwnedHeadings = new Set(["outcome", "diagnostic question", "exit question", "later review"]);
  let skipping = false;
  return markdown.split(/\r?\n/).filter((line) => {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      skipping = learnerOwnedHeadings.has(heading[1].trim().toLowerCase());
      return !skipping;
    }
    return !skipping;
  }).join("\n");
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listType) output.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([^\s]*)/);
    if (fence) {
      flushParagraph();
      flushList();
      const language = fence[1] || "text";
      const code = [];
      while (index + 1 < lines.length && !lines[index + 1].startsWith("```")) code.push(lines[++index]);
      if (index + 1 < lines.length) index += 1;
      output.push(language === "learndeck"
        ? renderEmbeddedControl(parseEmbeddedBlock(code.join("\n")))
        : `<div class="code-block"><div class="code-head"><span>${escape(language)}</span><button class="copy-code" type="button">Copy</button></div><pre><code>${escape(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    const callout = line.match(/^>\s*\[!(NOTE|TIP|WARNING|DEEP DIVE|SCENARIO)]\s*$/i);
    if (callout) {
      flushParagraph();
      flushList();
      const type = callout[1].toLowerCase().replace(" ", "-");
      const content = [];
      while (index + 1 < lines.length && lines[index + 1].startsWith(">")) content.push(lines[++index].replace(/^>\s?/, ""));
      output.push(`<aside class="callout callout-${type}"><strong><span aria-hidden="true">${calloutIcon(type)}</span> ${escape(callout[1])}</strong><p>${inlineMarkdown(content.join(" "))}</p></aside>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const continuation = line.match(/^\s{2,}(.+)/);
    if (continuation && listType && listItems.length) {
      listItems[listItems.length - 1] += ` ${continuation[1].trim()}`;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      flushParagraph();
      flushList();
      if (heading[1].length > 1) {
        const level = Math.min(heading[1].length, 3);
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      }
      continue;
    }
    const ordered = line.match(/^\d+\.\s+(.+)/);
    const unordered = line.match(/^[-*]\s+(.+)/);
    if (ordered || unordered) {
      flushParagraph();
      const nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((ordered || unordered)[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return output.join("");
}

function inlineMarkdown(value) {
  const links = [];
  const protectedLinks = value.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label, target) => {
    links.push({ label, target: target.trim() });
    return `@@LEARNDECK_LINK_${links.length - 1}@@`;
  });
  return inlinePlain(protectedLinks).replace(/@@LEARNDECK_LINK_(\d+)@@/g, (_match, index) => {
    const link = links[Number(index)];
    const label = inlinePlain(link.label);
    return /^https:\/\//.test(link.target)
      ? `<a href="${escape(link.target)}" target="_blank" rel="noreferrer">${label}</a>`
      : `<span class="source-inline">${label}</span>`;
  });
}

function inlinePlain(value) {
  return escape(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function calloutIcon(type) {
  return ({ note: "📘", tip: "💡", warning: "⚠️", "deep-dive": "🤔", scenario: "◈" })[type] || "•";
}

async function copyCode(button) {
  const code = button.closest(".code-block").querySelector("code").textContent;
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 2_000);
}

function parseEmbeddedBlock(source) {
  const block = { type: "note", items: [] };
  let listKey;
  for (const rawLine of source.split(/\r?\n/)) {
    const item = rawLine.match(/^\s*-\s+(.+)/);
    if (item && listKey === "items") {
      block.items.push(item[1].trim());
      continue;
    }
    const field = rawLine.match(/^\s*([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    const [, key, rawValue] = field;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    if (key === "items") {
      listKey = key;
      continue;
    }
    listKey = undefined;
    block[key] = value;
  }
  return block;
}

function renderEmbeddedControl(block) {
  const id = block.id || `control-${Math.random().toString(36).slice(2)}`;
  const label = block.label || "Learning prompt";
  if (block.type === "checklist") {
    const items = block.items.map((item, index) => {
      const key = `${id}:${index}`;
      const checked = storedControlValue(key) === "true" ? " checked" : "";
      return `<label class="embedded-check"><input type="checkbox" data-deck-id="${escape(key)}"${checked} /><span>${inlineMarkdown(item)}</span></label>`;
    }).join("");
    return `<section class="embedded-control embedded-checklist"><p>${escape(label)}</p>${items}</section>`;
  }
  const value = escape(storedControlValue(id));
  if (block.type === "switch") {
    const checked = value === "true" ? " checked" : "";
    return `<label class="embedded-control embedded-switch"><span>${escape(label)}</span><input type="checkbox" role="switch" data-deck-id="${escape(id)}"${checked} /><i aria-hidden="true"></i></label>`;
  }
  if (block.type === "textarea") {
    return `<label class="embedded-control embedded-field"><span>${escape(label)}</span><textarea data-deck-id="${escape(id)}" rows="4" placeholder="${escape(block.placeholder || "Write a private note")}">${value}</textarea></label>`;
  }
  return `<label class="embedded-control embedded-field"><span>${escape(label)}</span><input data-deck-id="${escape(id)}" value="${value}" placeholder="${escape(block.placeholder || "Write a short note")}" /></label>`;
}

function controlStorageKey(id) {
  return `learndeck:control:${state.pathId}:${state.sectionId}:${id}`;
}

function storedControlValue(id) {
  try { return localStorage.getItem(controlStorageKey(id)) || ""; } catch { return ""; }
}

function persistEmbeddedControl(event) {
  const control = event.target.closest("[data-deck-id]");
  if (!control) return;
  const value = control.type === "checkbox" ? String(control.checked) : control.value;
  try { localStorage.setItem(controlStorageKey(control.dataset.deckId), value); } catch { /* Notes remain useful without browser storage. */ }
}

async function submitAnswer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const questionId = form.dataset.questionId;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  setNote($("#answer-status"), "Submitting your answer…");
  try {
    const attempt = await api("/api/attempts", {
      method: "POST",
      body: JSON.stringify({
        pathId: state.pathId,
        questionId,
        answer: $("#answer").value,
        confidence: Number($("#confidence").value),
      }),
    });
    state.overview = await api(`/api/paths/${encodeURIComponent(state.pathId)}/overview`);
    $("#answer").value = "";
    state.answerDirty = false;
    setNote($("#answer-status"), "");
    state.statusMessage = attempt.result === "submitted"
      ? "Submitted — waiting for optional guide feedback"
      : `Answer ${attempt.result}.`;
    render();
    focusSurface("#progress-summary");
  } catch (error) {
    setNote($("#answer-status"), `Your answer was not submitted: ${error.message} It is still in the box — try again.`, true);
  } finally {
    submit.disabled = false;
  }
}

boot();

setInterval(async () => {
  if (!state.pathId || state.answerDirty || document.hidden || $("#course").classList.contains("hidden")) return;
  // Skip while the learner is interacting with lesson controls so a re-render never steals focus mid-typing.
  const active = document.activeElement;
  if (active && active.closest("#course") && active.matches("input, textarea, select, button")) return;
  const pathId = state.pathId;
  const before = state.overview;
  try {
    const overview = await api(`/api/paths/${encodeURIComponent(pathId)}/overview`);
    // Discard stale responses: the path changed or another action refreshed the overview mid-flight.
    if (state.pathId !== pathId || state.overview !== before || state.answerDirty) return;
    if (JSON.stringify(overview) === JSON.stringify(before)) return;
    state.overview = overview;
    render();
  } catch {
    // A local server restart should not interrupt an answer the learner is writing.
  }
}, 4_000);
