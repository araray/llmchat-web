// llmchat_web/static/js/agent_ui.js

/**
 * @file agent_ui.js
 * @description UI orchestrator for the autonomous agent tab.
 * This refactored module handles the goal submission form and initializes
 * the more specialized agent modules (API, tasks, stream).
 *
 * Key Features:
 * - Goal submission form with provider/model override options.
 * - Initialization of all agent-related event listeners.
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
 * This function handles the form submission, creates the task, and starts streaming.
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

    // Create initial task object and add to our tracking via the tasks module
    const newTask = {
      task_id: taskId,
      goal: goal,
      status: "PENDING",
      created_at: new Date().toISOString(),
      provider:
        providerOverride ||
        window.currentLlmSettings?.providerName ||
        "default",
      model: modelOverride || window.currentLlmSettings?.modelName || "default",
    };

    // Add the task and start monitoring it
    addTaskToManager(newTask);

    showToast(
      "Success",
      `Agent task submitted. ID: ${taskId.substring(0, 8)}...`,
      "success",
    );

    // Automatically select this task for detailed view
    selectTaskForDetailView(taskId);
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

console.log("AGENT_UI: Agent UI orchestrator module loaded.");
