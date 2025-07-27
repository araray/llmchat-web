// llmchat_web/static/js/task_monitor_ui.js

/**
 * @file task_monitor_ui.js
 * @description Unified task monitoring service for all asynchronous background tasks.
 * This module provides centralized polling, status tracking, and UI management for
 * data ingestion, agent runs, and other long-running operations.
 *
 * Key Features:
 * - Single polling loop for all task types
 * - Global task state management via window.allActiveTasks Map
 * - Unified Activity tab UI with real-time status updates
 * - Integration points for ingestion_ui.js and agent_ui.js
 *
 * Depends on:
 * - utils.js (for showToast, escapeHtml, global state)
 * - Bootstrap 5 (for UI components)
 */

// Global state for unified task monitoring
window.allActiveTasks = new Map(); // task_id -> task object

/**
 * TaskMonitor - Centralized service for monitoring all asynchronous tasks
 */
const TaskMonitor = {
  // Polling configuration
  POLL_INTERVAL: 3000, // 3 seconds
  MAX_POLL_ATTEMPTS: 240, // 12 minutes total (240 * 3s = 720s)

  // Internal state
  _pollTimer: null,
  _isMonitoring: false,

  /**
   * Adds a new task to the global monitoring system
   * @param {Object} taskDetails - Task information
   * @param {string} taskDetails.task_id - Unique task identifier
   * @param {string} taskDetails.title - Human-readable task description
   * @param {string} taskDetails.type - Task type ('Ingestion', 'Agent', etc.)
   * @param {string} taskDetails.status - Initial status ('submitted', 'queued', etc.)
   * @param {Object} [taskDetails.metadata] - Additional task metadata
   */
  addTask(taskDetails) {
    if (!taskDetails.task_id) {
      console.error("TASK_MONITOR: Cannot add task without task_id");
      return;
    }

    const taskObject = {
      task_id: taskDetails.task_id,
      title: taskDetails.title || "Unknown Task",
      type: taskDetails.type || "Unknown",
      status: taskDetails.status || "submitted",
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      poll_attempts: 0,
      metadata: taskDetails.metadata || {},
      ...taskDetails, // Allow additional properties
    };

    window.allActiveTasks.set(taskDetails.task_id, taskObject);

    console.log(
      `TASK_MONITOR: Added task ${taskDetails.task_id} (${taskDetails.type}): ${taskDetails.title}`,
    );

    // Update UI immediately
    this.renderTaskList();

    // Ensure monitoring is active
    if (!this._isMonitoring) {
      this.startMonitoring();
    }
  },

  /**
   * Updates an existing task's status and metadata
   * @param {string} taskId - Task identifier
   * @param {Object} statusData - Updated status information from API
   */
  updateTask(taskId, statusData) {
    const task = window.allActiveTasks.get(taskId);
    if (!task) {
      console.warn(`TASK_MONITOR: Cannot update unknown task ${taskId}`);
      return;
    }

    const oldStatus = task.status;

    // Update task properties
    Object.assign(task, {
      status: statusData.status,
      last_updated: new Date().toISOString(),
      result_available: statusData.result_available,
      progress: statusData.progress,
      message: statusData.message,
      error: statusData.error,
    });

    // Log status changes
    if (oldStatus !== task.status) {
      console.log(
        `TASK_MONITOR: Task ${taskId} status: ${oldStatus} -> ${task.status}`,
      );
    }

    // Update UI if status changed
    this.renderTaskList();

    // Handle task completion
    if (this._isTaskComplete(task.status)) {
      this._handleTaskCompletion(taskId, task);
    }
  },

  /**
   * Starts the unified monitoring loop
   */
  startMonitoring() {
    if (this._isMonitoring) {
      console.log("TASK_MONITOR: Monitoring already active");
      return;
    }

    console.log("TASK_MONITOR: Starting unified task monitoring");
    this._isMonitoring = true;
    this._pollActiveTasks();
  },

  /**
   * Stops the monitoring loop
   */
  stopMonitoring() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this._isMonitoring = false;
    console.log("TASK_MONITOR: Task monitoring stopped");
  },

  /**
   * Main polling loop - checks status of all active tasks
   */
  async _pollActiveTasks() {
    if (!this._isMonitoring) return;

    const activeTasks = Array.from(window.allActiveTasks.values()).filter(
      (task) =>
        this._isTaskActive(task.status) &&
        task.poll_attempts < this.MAX_POLL_ATTEMPTS,
    );

    if (activeTasks.length === 0) {
      // No active tasks, check again in longer interval
      this._pollTimer = setTimeout(
        () => this._pollActiveTasks(),
        this.POLL_INTERVAL * 2,
      );
      return;
    }

    console.log(`TASK_MONITOR: Polling ${activeTasks.length} active tasks`);

    // Poll each active task
    const pollPromises = activeTasks.map((task) => this._pollSingleTask(task));
    await Promise.allSettled(pollPromises);

    // Schedule next poll
    this._pollTimer = setTimeout(
      () => this._pollActiveTasks(),
      this.POLL_INTERVAL,
    );
  },

  /**
   * Polls a single task's status
   * @param {Object} task - Task object to poll
   */
  async _pollSingleTask(task) {
    try {
      task.poll_attempts++;

      const response = await fetch(`/api/tasks/${task.task_id}`);

      if (!response.ok) {
        console.warn(
          `TASK_MONITOR: Failed to poll task ${task.task_id}: ${response.status}`,
        );
        return;
      }

      const statusData = await response.json();
      this.updateTask(task.task_id, statusData);
    } catch (error) {
      console.error(`TASK_MONITOR: Error polling task ${task.task_id}:`, error);

      // Mark task as errored if too many failed polls
      if (task.poll_attempts >= 10) {
        this.updateTask(task.task_id, {
          status: "error",
          error: "Polling failed repeatedly",
        });
      }
    }
  },

  /**
   * Handles task completion (success or failure)
   * @param {string} taskId - Completed task ID
   * @param {Object} task - Task object
   */
  _handleTaskCompletion(taskId, task) {
    console.log(
      `TASK_MONITOR: Task ${taskId} completed with status: ${task.status}`,
    );

    // Show completion notification
    const isSuccess = task.status === "complete" || task.status === "success";
    const toastType = isSuccess ? "success" : "danger";
    const message = isSuccess
      ? `Task completed: ${task.title}`
      : `Task failed: ${task.title}`;

    if (typeof showToast === "function") {
      showToast(
        isSuccess ? "Task Complete" : "Task Failed",
        message,
        toastType,
      );
    }

    // Keep completed tasks in the list for a while, but stop polling them
    // They will be cleaned up by the cleanup routine
  },

  /**
   * Renders the unified task list in the Activity tab
   */
  renderTaskList() {
    const taskListContainer = document.getElementById("unified-task-list");
    if (!taskListContainer) {
      console.warn("TASK_MONITOR: unified-task-list container not found");
      return;
    }

    const tasks = Array.from(window.allActiveTasks.values()).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    ); // Newest first

    if (tasks.length === 0) {
      taskListContainer.innerHTML = `
        <div class="text-center text-muted p-4">
          <i class="fas fa-tasks fa-2x mb-2"></i>
          <p>No background tasks yet.</p>
          <small>Tasks from data ingestion and agent runs will appear here.</small>
        </div>
      `;
      return;
    }

    let html = "";
    tasks.forEach((task) => {
      const statusClass = this._getStatusBadgeClass(task.status);
      const statusIcon = this._getStatusIcon(task.status);
      const timeAgo = this._getTimeAgo(task.created_at);
      const lastUpdated = this._getTimeAgo(task.last_updated);

      // Truncate title if too long
      const displayTitle =
        task.title.length > 60
          ? task.title.substring(0, 60) + "..."
          : task.title;

      html += `
        <div class="task-monitor-item border rounded p-3 mb-2" data-task-id="${escapeHtml(task.task_id)}">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="task-monitor-header">
              <h6 class="mb-1">
                <i class="fas ${statusIcon} me-2"></i>
                ${escapeHtml(displayTitle)}
              </h6>
              <small class="text-muted">
                ${escapeHtml(task.type)} • ID: ${escapeHtml(task.task_id.substring(0, 8))}...
              </small>
            </div>
            <span class="badge ${statusClass}">${escapeHtml(task.status)}</span>
          </div>

          <div class="task-monitor-details">
            <div class="row">
              <div class="col-6">
                <small class="text-muted">Created: ${timeAgo}</small>
              </div>
              <div class="col-6">
                <small class="text-muted">Updated: ${lastUpdated}</small>
              </div>
            </div>

            ${
              task.message
                ? `
              <div class="mt-2">
                <small class="text-info">${escapeHtml(task.message)}</small>
              </div>
            `
                : ""
            }

            ${
              task.error
                ? `
              <div class="mt-2">
                <small class="text-danger">
                  <i class="fas fa-exclamation-triangle"></i> ${escapeHtml(task.error)}
                </small>
              </div>
            `
                : ""
            }

            ${
              task.progress
                ? `
              <div class="mt-2">
                <div class="progress" style="height: 4px;">
                  <div class="progress-bar" role="progressbar" style="width: ${task.progress}%"
                       aria-valuenow="${task.progress}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
              </div>
            `
                : ""
            }
          </div>

          <div class="task-monitor-actions mt-2">
            <div class="btn-group btn-group-sm" role="group">
              ${
                task.result_available
                  ? `
                <button class="btn btn-outline-info btn-view-task-result"
                        data-task-id="${escapeHtml(task.task_id)}" title="View Result">
                  <i class="fas fa-eye"></i> Result
                </button>
              `
                  : ""
              }
              ${
                this._isTaskActive(task.status)
                  ? `
                <button class="btn btn-outline-warning btn-cancel-task"
                        data-task-id="${escapeHtml(task.task_id)}" title="Cancel Task">
                  <i class="fas fa-stop"></i> Cancel
                </button>
              `
                  : ""
              }
              <button class="btn btn-outline-secondary btn-remove-task"
                      data-task-id="${escapeHtml(task.task_id)}" title="Remove from List">
                <i class="fas fa-times"></i> Remove
              </button>
            </div>
          </div>
        </div>
      `;
    });

    taskListContainer.innerHTML = html;
  },

  /**
   * Removes a task from monitoring (but doesn't cancel it)
   * @param {string} taskId - Task to remove
   */
  removeTask(taskId) {
    if (window.allActiveTasks.delete(taskId)) {
      console.log(`TASK_MONITOR: Removed task ${taskId} from monitoring`);
      this.renderTaskList();
    }
  },

  /**
   * Gets the appropriate Bootstrap badge class for a status
   * @param {string} status - Task status
   * @returns {string} Bootstrap badge class
   */
  _getStatusBadgeClass(status) {
    switch (status.toLowerCase()) {
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
      case "cancelled":
        return "bg-warning";
      default:
        return "bg-info";
    }
  },

  /**
   * Gets an appropriate icon for a task status
   * @param {string} status - Task status
   * @returns {string} FontAwesome icon class
   */
  _getStatusIcon(status) {
    switch (status.toLowerCase()) {
      case "queued":
      case "submitted":
        return "fa-clock";
      case "running":
      case "in_progress":
        return "fa-spinner fa-spin";
      case "complete":
      case "success":
        return "fa-check-circle";
      case "failed":
      case "error":
        return "fa-exclamation-circle";
      case "cancelled":
        return "fa-ban";
      default:
        return "fa-question-circle";
    }
  },

  /**
   * Checks if a task status indicates active processing
   * @param {string} status - Task status
   * @returns {boolean} True if task is still active
   */
  _isTaskActive(status) {
    const activeStatuses = ["queued", "submitted", "running", "in_progress"];
    return activeStatuses.includes(status.toLowerCase());
  },

  /**
   * Checks if a task status indicates completion
   * @param {string} status - Task status
   * @returns {boolean} True if task is complete
   */
  _isTaskComplete(status) {
    const completeStatuses = [
      "complete",
      "success",
      "failed",
      "error",
      "cancelled",
    ];
    return completeStatuses.includes(status.toLowerCase());
  },

  /**
   * Formats a timestamp as "time ago" string
   * @param {string} timestamp - ISO timestamp
   * @returns {string} Human-readable time ago
   */
  _getTimeAgo(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  },

  /**
   * Performs periodic cleanup of old completed tasks
   */
  cleanupOldTasks() {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let cleaned = 0;

    for (const [taskId, task] of window.allActiveTasks.entries()) {
      if (
        this._isTaskComplete(task.status) &&
        new Date(task.last_updated) < cutoffTime
      ) {
        window.allActiveTasks.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`TASK_MONITOR: Cleaned up ${cleaned} old completed tasks`);
      this.renderTaskList();
    }
  },
};

/**
 * Initializes task monitor event listeners and UI components
 */
function initTaskMonitorEventListeners() {
  console.log("TASK_MONITOR: Initializing task monitor event listeners...");

  // Task action button handlers (using event delegation)
  const taskListContainer = document.getElementById("unified-task-list");
  if (taskListContainer) {
    taskListContainer.addEventListener("click", async function (e) {
      const button = e.target.closest("button");
      if (!button) return;

      const taskId = button.dataset.taskId;
      if (!taskId) return;

      if (button.classList.contains("btn-view-task-result")) {
        await viewTaskResult(taskId);
      } else if (button.classList.contains("btn-cancel-task")) {
        await cancelTask(taskId);
      } else if (button.classList.contains("btn-remove-task")) {
        TaskMonitor.removeTask(taskId);
      }
    });
  }

  // Start periodic cleanup
  setInterval(() => TaskMonitor.cleanupOldTasks(), 60000); // Every minute

  console.log(
    "TASK_MONITOR: Task monitor event listeners initialized successfully.",
  );
}

/**
 * Views the result of a completed task
 * @param {string} taskId - Task identifier
 */
async function viewTaskResult(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/result`);

    if (!response.ok) {
      throw new Error(`Failed to fetch result: ${response.status}`);
    }

    const resultData = await response.json();

    // Display result in a modal or alert
    const resultText = JSON.stringify(resultData.result, null, 2);
    alert(`Task Result:\n\n${resultText}`);
  } catch (error) {
    console.error(
      `TASK_MONITOR: Error viewing result for task ${taskId}:`,
      error,
    );
    if (typeof showToast === "function") {
      showToast(
        "Error",
        `Failed to load task result: ${error.message}`,
        "danger",
      );
    }
  }
}

/**
 * Attempts to cancel an active task
 * @param {string} taskId - Task identifier
 */
async function cancelTask(taskId) {
  // Note: This would require a cancel endpoint in the backend
  // For now, just show a message
  if (typeof showToast === "function") {
    showToast(
      "Info",
      "Task cancellation not yet implemented in backend",
      "info",
    );
  }
}

// Export TaskMonitor for use by other modules
window.TaskMonitor = TaskMonitor;

console.log("TASK_MONITOR: Task monitor module loaded successfully.");
