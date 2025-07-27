// llmchat_web/static/js/agent_tasks.js

/**
 * @file agent_tasks.js
 * @description Manages the state and lifecycle of agent tasks.
 *
 * REFACTORED: Removed local polling logic - now reads from global TaskMonitor state
 * and focuses on agent-specific UI rendering and interaction.
 *
 * This module handles rendering the task list, displaying task details, and managing
 * agent-specific UI state while delegating actual task monitoring to TaskMonitor.
 *
 * Depends on:
 * - utils.js (for global state, escapeHtml, showToast)
 * - agent_api.js (for API calls)
 * - agent_stream.js (to initiate streaming)
 */

// Global state for agent tasks (backward compatibility)
window.agentTasks = new Map(); // task_id -> task object

/**
 * Legacy function maintained for backward compatibility.
 * Now delegates to TaskMonitor while updating local agent state.
 * @param {object} newTask - The initial task object.
 */
function addTaskToManager(newTask) {
  // --- REFACTORED: Remove local polling, delegate to TaskMonitor ---
  // **Rationale Block**:
  // Pre-state: addTaskToManager maintained separate polling loop via startTaskStatusPolling
  // Limitation: Duplicate polling logic, inefficient resource usage, state inconsistency
  // Decision Path: Remove polling responsibility, delegate to TaskMonitor, maintain UI state only
  // Post-state: TaskMonitor handles polling, agent_tasks focuses on agent-specific UI rendering

  window.agentTasks.set(newTask.task_id, newTask);
  renderAgentTaskList();

  // TaskMonitor should already be handling this task, but ensure it's tracked
  if (
    typeof TaskMonitor !== "undefined" &&
    TaskMonitor.addTask &&
    !window.allActiveTasks.has(newTask.task_id)
  ) {
    TaskMonitor.addTask({
      task_id: newTask.task_id,
      title: newTask.goal || "Agent Task",
      type: "Agent",
      status: newTask.status || "submitted",
      metadata: {
        goal: newTask.goal,
        provider: newTask.provider,
        model: newTask.model,
      },
    });
  }

  console.log(
    `AGENT_TASKS: Task ${newTask.task_id} added to agent tracking (polling delegated to TaskMonitor)`,
  );
}

/**
 * Renders the list of agent tasks in the left panel.
 * Now reads from both local agentTasks and global allActiveTasks for consistency.
 */
function renderAgentTaskList() {
  const taskListContainer = document.getElementById("agent-task-list");
  if (!taskListContainer) return;

  // Merge tasks from both local and global state for comprehensive view
  const allTasks = new Map();

  // Add local agent tasks
  for (const [taskId, task] of window.agentTasks.entries()) {
    allTasks.set(taskId, { ...task, source: "local" });
  }

  // Add/update with global TaskMonitor state if available
  if (typeof window.allActiveTasks !== "undefined") {
    for (const [taskId, globalTask] of window.allActiveTasks.entries()) {
      if (globalTask.type === "Agent") {
        const localTask = allTasks.get(taskId);
        if (localTask) {
          // Update local task with global state
          allTasks.set(taskId, {
            ...localTask,
            status: globalTask.status,
            result_available: globalTask.result_available,
            last_updated: globalTask.last_updated,
            source: "merged",
          });
        } else {
          // Add global task to local view
          allTasks.set(taskId, {
            task_id: taskId,
            goal: globalTask.title || globalTask.metadata?.goal || "Agent Task",
            status: globalTask.status,
            created_at: globalTask.created_at,
            provider: globalTask.metadata?.provider || "default",
            model: globalTask.metadata?.model || "default",
            result_available: globalTask.result_available,
            source: "global",
          });
        }
      }
    }
  }

  if (allTasks.size === 0) {
    taskListContainer.innerHTML =
      '<p class="text-muted small p-2">No agent tasks yet. Submit a goal to get started.</p>';
    return;
  }

  const tasks = Array.from(allTasks.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );

  let html = "";
  tasks.forEach((task) => {
    const statusClass = getStatusBadgeClass(task.status);
    const truncatedGoal =
      task.goal.length > 50 ? task.goal.substring(0, 50) + "..." : task.goal;
    const taskIdShort = task.task_id.substring(0, 8);

    html += `
      <div class="agent-task-item" data-task-id="${escapeHtml(task.task_id)}">
        <div class="agent-task-header">
          <div class="agent-task-goal">${escapeHtml(truncatedGoal)}</div>
          <span class="badge ${statusClass}">${escapeHtml(task.status)}</span>
        </div>
        <div class="agent-task-meta">
          <small class="text-muted">
            ID: ${escapeHtml(taskIdShort)} |
            Model: ${escapeHtml(task.model)} |
            ${new Date(task.created_at).toLocaleTimeString()}
            ${task.source !== "local" ? " • " + task.source : ""}
          </small>
        </div>
      </div>
    `;
  });

  taskListContainer.innerHTML = html;
}

/**
 * Returns the appropriate Bootstrap badge class for a task status.
 * @param {string} status - The task status.
 * @returns {string} Bootstrap badge class.
 */
function getStatusBadgeClass(status) {
  switch (status.toLowerCase()) {
    case "pending":
    case "queued":
    case "submitted":
      return "bg-secondary";
    case "running":
    case "in_progress":
      return "bg-primary";
    case "complete":
    case "success":
      return "bg-success";
    case "failed":
    case "error":
      return "bg-danger";
    default:
      return "bg-info";
  }
}

/**
 * Selects a task for detailed viewing and starts streaming if appropriate.
 * @param {string} taskId - The task ID to select.
 */
function selectTaskForDetailView(taskId) {
  // Try to get task from global state first, then fall back to local
  let task = window.allActiveTasks?.get(taskId);
  if (!task) {
    task = window.agentTasks.get(taskId);
  }

  if (!task) return;

  document.querySelectorAll(".agent-task-item").forEach((item) => {
    item.classList.remove("selected");
  });
  const selectedItem = document.querySelector(`[data-task-id="${taskId}"]`);
  if (selectedItem) selectedItem.classList.add("selected");

  const detailView = document.getElementById("agent-task-detail-view");
  const welcomePane = document.getElementById("agent-welcome-pane");
  const detailHeader = document.getElementById("agent-detail-header");

  // Use task data from global state if available, otherwise local
  const displayGoal = task.title || task.goal || "Agent Task";
  const displayProvider = task.metadata?.provider || task.provider || "default";
  const displayModel = task.metadata?.model || task.model || "default";
  const displayStatus = task.status || "unknown";

  detailHeader.innerHTML = `
    <h5><i class="fas fa-robot"></i> Agent Task Details</h5>
    <div class="agent-detail-meta">
      <strong>Goal:</strong> ${escapeHtml(displayGoal)}<br>
      <strong>Status:</strong> <span class="badge ${getStatusBadgeClass(displayStatus)}">${escapeHtml(displayStatus)}</span><br>
      <strong>Model:</strong> ${escapeHtml(displayProvider)}/${escapeHtml(displayModel)}<br>
      <strong>Task ID:</strong> <code>${escapeHtml(taskId)}</code>
    </div>
  `;

  if (welcomePane) welcomePane.style.display = "none";
  detailView.style.display = "block";

  const streamContainer = document.getElementById("agent-stream-container");
  const resultContainer = document.getElementById("agent-result-container");

  if (displayStatus === "running" || displayStatus === "in_progress") {
    streamAgentProgress(taskId);
  } else if (displayStatus === "complete" && task.result_available) {
    streamContainer.innerHTML =
      '<p class="text-muted">Task completed. See result below.</p>';
    fetchAndDisplayTaskResult(taskId);
  } else if (
    displayStatus === "pending" ||
    displayStatus === "queued" ||
    displayStatus === "submitted"
  ) {
    streamContainer.innerHTML =
      '<p class="text-muted">Task is queued. Progress will appear here.</p>';
    resultContainer.style.display = "none";
  }
}

/**
 * Fetches and displays the final result of a completed agent task.
 * @param {string} taskId - The unique identifier of the completed task.
 */
async function fetchAndDisplayTaskResult(taskId) {
  try {
    const resultData = await apiGetTaskResult(taskId);

    // Update both local and global task state
    const localTask = window.agentTasks.get(taskId);
    if (localTask) {
      localTask.result = resultData.result;
      localTask.final_status = resultData.status;
    }

    const resultContainer = document.getElementById("agent-result-container");
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="agent-result-header mb-2">
          <h6><i class="fas fa-flag-checkered"></i> Final Result</h6>
        </div>
        <div class="agent-result-content">
          <pre>${escapeHtml(JSON.stringify(resultData.result, null, 2))}</pre>
        </div>
      `;
      resultContainer.style.display = "block";
    }
  } catch (error) {
    console.error(
      `AGENT_TASKS: Error fetching result for task ${taskId}:`,
      error,
    );
  }
}

/**
 * Initializes event listeners for the task list.
 */
function initAgentTasksEventListeners() {
  const taskList = document.getElementById("agent-task-list");
  if (taskList) {
    taskList.addEventListener("click", function (e) {
      const taskItem = e.target.closest(".agent-task-item");
      if (taskItem) {
        const taskId = taskItem.dataset.taskId;
        selectTaskForDetailView(taskId);
      }
    });
  }

  // Subscribe to TaskMonitor updates to refresh agent task list
  if (typeof TaskMonitor !== "undefined") {
    // Set up periodic refresh to sync with TaskMonitor state
    setInterval(() => {
      renderAgentTaskList();
    }, 2000); // Refresh every 2 seconds to stay in sync
  }
}

console.log(
  "AGENT_TASKS: Agent tasks module loaded (refactored for TaskMonitor integration).",
);
