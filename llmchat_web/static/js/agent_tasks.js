// llmchat_web/static/js/agent_tasks.js

/**
 * @file agent_tasks.js
 * @description Manages the state and lifecycle of agent tasks.
 * This module handles adding tasks, polling for their status, rendering the
 * task list, and displaying final results.
 *
 * Depends on:
 * - utils.js (for global state, escapeHtml, showToast)
 * - agent_api.js (for API calls)
 * - agent_stream.js (to initiate streaming)
 */

// Global state for agent tasks
window.agentTasks = new Map(); // task_id -> task object

/**
 * Adds a new task to the manager and starts polling.
 * @param {object} newTask - The initial task object.
 */
function addTaskToManager(newTask) {
  window.agentTasks.set(newTask.task_id, newTask);
  renderAgentTaskList();
  startTaskStatusPolling(newTask.task_id);
}

/**
 * Starts polling for task status updates and manages the overall task lifecycle.
 * @param {string} taskId - The unique identifier of the task to monitor.
 */
function startTaskStatusPolling(taskId) {
  const pollInterval = 2000; // Poll every 2 seconds

  const pollFunction = async () => {
    try {
      const statusData = await apiGetTaskStatus(taskId);
      const task = window.agentTasks.get(taskId);

      if (task) {
        const oldStatus = task.status;
        task.status = statusData.status;
        task.result_available = statusData.result_available;

        if (oldStatus !== task.status) {
          console.log(
            `AGENT_TASKS: Task ${taskId} status changed: ${oldStatus} -> ${task.status}`,
          );
          renderAgentTaskList();
        }

        const isFinished =
          task.status === "complete" || task.status === "failed";
        if (isFinished) {
          const activeStream = window.activeTaskStreams.get(taskId);
          if (activeStream) {
            activeStream.close();
            window.activeTaskStreams.delete(taskId);
          }
          if (task.result_available) {
            await fetchAndDisplayTaskResult(taskId);
          }
        } else {
          setTimeout(pollFunction, pollInterval);
        }
      }
    } catch (error) {
      console.error(
        `AGENT_TASKS: Error polling status for task ${taskId}:`,
        error,
      );
      setTimeout(pollFunction, pollInterval * 2); // Retry on error
    }
  };

  pollFunction();
}

/**
 * Renders the list of agent tasks in the left panel.
 */
function renderAgentTaskList() {
  const taskListContainer = document.getElementById("agent-task-list");
  if (!taskListContainer) return;

  if (window.agentTasks.size === 0) {
    taskListContainer.innerHTML =
      '<p class="text-muted small p-2">No agent tasks yet. Submit a goal to get started.</p>';
    return;
  }

  const tasks = Array.from(window.agentTasks.values()).sort(
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
  const task = window.agentTasks.get(taskId);
  if (!task) return;

  document.querySelectorAll(".agent-task-item").forEach((item) => {
    item.classList.remove("selected");
  });
  const selectedItem = document.querySelector(`[data-task-id="${taskId}"]`);
  if (selectedItem) selectedItem.classList.add("selected");

  const detailView = document.getElementById("agent-task-detail-view");
  const welcomePane = document.getElementById("agent-welcome-pane");
  const detailHeader = document.getElementById("agent-detail-header");

  detailHeader.innerHTML = `
    <h5><i class="fas fa-robot"></i> Agent Task Details</h5>
    <div class="agent-detail-meta">
      <strong>Goal:</strong> ${escapeHtml(task.goal)}<br>
      <strong>Status:</strong> <span class="badge ${getStatusBadgeClass(task.status)}">${escapeHtml(task.status)}</span><br>
      <strong>Model:</strong> ${escapeHtml(task.provider)}/${escapeHtml(task.model)}<br>
      <strong>Task ID:</strong> <code>${escapeHtml(task.task_id)}</code>
    </div>
  `;

  if (welcomePane) welcomePane.style.display = "none";
  detailView.style.display = "block";

  const streamContainer = document.getElementById("agent-stream-container");
  const resultContainer = document.getElementById("agent-result-container");

  if (task.status === "running" || task.status === "in_progress") {
    streamAgentProgress(taskId);
  } else if (task.status === "complete" && task.result_available) {
    streamContainer.innerHTML =
      '<p class="text-muted">Task completed. See result below.</p>';
    fetchAndDisplayTaskResult(taskId);
  } else if (task.status === "pending" || task.status === "queued") {
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
    const task = window.agentTasks.get(taskId);
    if (task) {
      task.result = resultData.result;
      task.final_status = resultData.status;
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
}

console.log("AGENT_TASKS: Agent tasks module loaded.");
