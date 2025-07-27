// llmchat_web/static/js/agent_ui.js

/**
 * @file agent_ui.js
 * @description UI orchestrator for the autonomous agent tab.
 * This refactored module handles the goal submission form and delegates
 * task monitoring to the unified TaskMonitor service.
 *
 * REFACTORED: Now uses TaskMonitor instead of addTaskToManager for centralized monitoring.
 *
 * Key Features:
 * - Goal submission form with provider/model override options.
 * - Initialization of all agent-related event listeners.
 * - Integration with unified task monitoring system.
 *
 * Depends on:
 * - utils.js (for showToast, escapeHtml, global state)
 * - agent_api.js (for API calls)
 * - agent_tasks.js (for task management)
 * - agent_stream.js (for stream rendering)
 * - Bootstrap 5 (for UI components)
 */

/**
 * Submits a new agent goal to the backend and initiates monitoring.
 * This function handles the form submission, creates the task, and delegates to TaskMonitor.
 */
async function handleAgentGoalSubmit() {
  const goalTextarea = document.getElementById("agent-goal-input");
  const goal = goalTextarea.value.trim();

  if (!goal) {
    showToast("Error", "Please enter a goal for the agent.", "danger");
    return;
  }

  // Get provider/model overrides if selected
  const providerOverride = document.getElementById(
    "agent-provider-select",
  ).value;
  const modelOverride = document.getElementById("agent-model-select").value;

  // Build request payload
  const payload = {
    goal: goal,
    session_id: window.currentLlmSessionId,
  };

  if (providerOverride) payload.provider = providerOverride;
  if (modelOverride) payload.model = modelOverride;

  console.log("AGENT_UI: Submitting agent goal:", payload);

  try {
    const result = await apiRunAgent(payload);
    const taskId = result.task_id;

    console.log(
      "AGENT_UI: Agent task submitted successfully. Task ID:",
      taskId,
    );

    goalTextarea.value = "";

    // --- REFACTORED: Delegate to TaskMonitor instead of addTaskToManager ---
    // **Rationale Block**:
    // Pre-state: Agent UI called addTaskToManager() which maintained separate task state
    // Limitation: Duplicate task tracking, inconsistent with unified monitoring approach
    // Decision Path: Use TaskMonitor.addTask() for centralized task state management
    // Post-state: All tasks managed by TaskMonitor, consistent monitoring across UI modules

    if (typeof TaskMonitor !== "undefined" && TaskMonitor.addTask) {
      // Create comprehensive task object for TaskMonitor
      TaskMonitor.addTask({
        task_id: taskId,
        title: goal.length > 60 ? goal.substring(0, 60) + "..." : goal,
        type: "Agent",
        status: "submitted",
        metadata: {
          goal: goal,
          provider:
            providerOverride ||
            window.currentLlmSettings?.providerName ||
            "default",
          model:
            modelOverride || window.currentLlmSettings?.modelName || "default",
          session_id: window.currentLlmSessionId,
        },
      });

      showToast(
        "Success",
        `Agent task submitted. Monitor in Activity tab.`,
        "success",
      );

      // Also add to agent-specific tracking for backward compatibility
      const newTask = {
        task_id: taskId,
        goal: goal,
        status: "submitted",
        created_at: new Date().toISOString(),
        provider:
          providerOverride ||
          window.currentLlmSettings?.providerName ||
          "default",
        model:
          modelOverride || window.currentLlmSettings?.modelName || "default",
      };

      // Update agent-specific UI state
      window.agentTasks.set(taskId, newTask);
      renderAgentTaskList();

      // Automatically select this task for detailed view
      selectTaskForDetailView(taskId);
    } else {
      // Fallback if TaskMonitor is not available
      console.warn(
        "AGENT_UI: TaskMonitor not available, using legacy task management",
      );

      const newTask = {
        task_id: taskId,
        goal: goal,
        status: "submitted",
        created_at: new Date().toISOString(),
        provider:
          providerOverride ||
          window.currentLlmSettings?.providerName ||
          "default",
        model:
          modelOverride || window.currentLlmSettings?.modelName || "default",
      };

      // Fallback to legacy addTaskToManager if available
      if (typeof addTaskToManager === "function") {
        addTaskToManager(newTask);
      } else {
        window.agentTasks.set(taskId, newTask);
        renderAgentTaskList();
      }

      showToast(
        "Success",
        `Agent task submitted. ID: ${taskId.substring(0, 8)}...`,
        "success",
      );

      selectTaskForDetailView(taskId);
    }
  } catch (error) {
    console.error("AGENT_UI: Error submitting agent goal:", error);
    showToast(
      "Error",
      `Failed to submit agent goal: ${error.message}`,
      "danger",
    );
  }
}

/**
 * Fetches available providers and models to populate the override dropdowns.
 */
async function fetchProviderAndModelOptions() {
  try {
    const providers = await apiGetLlmProviders();
    const providerSelect = document.getElementById("agent-provider-select");

    providerSelect.innerHTML = '<option value="">Use Session Default</option>';
    providers.forEach((provider) => {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = provider;
      providerSelect.appendChild(option);
    });

    providerSelect.addEventListener("change", async function () {
      const modelSelect = document.getElementById("agent-model-select");
      modelSelect.innerHTML = '<option value="">Use Session Default</option>';
      if (this.value) {
        try {
          const models = await apiGetLlmModels(this.value);
          models.forEach((model) => {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
          });
        } catch (error) {
          console.error("AGENT_UI: Error fetching models:", error);
        }
      }
    });
  } catch (error) {
    console.error("AGENT_UI: Error fetching provider options:", error);
  }
}

/**
 * Initializes all event listeners and UI components for the agent interface.
 * This function should be called from main_controller.js.
 */
function initAgentEventListeners() {
  console.log("AGENT_UI: Initializing agent UI event listeners...");

  // Goal submission form
  const goalForm = document.getElementById("agent-goal-form");
  if (goalForm) {
    goalForm.addEventListener("submit", function (e) {
      e.preventDefault();
      handleAgentGoalSubmit();
    });
  }

  // Task list click handling (event delegation in agent_tasks.js)
  initAgentTasksEventListeners();

  // Initialize provider/model options
  fetchProviderAndModelOptions();

  console.log("AGENT_UI: Agent UI event listeners initialized successfully.");
}

console.log(
  "AGENT_UI: Agent UI orchestrator module loaded (refactored for TaskMonitor).",
);
