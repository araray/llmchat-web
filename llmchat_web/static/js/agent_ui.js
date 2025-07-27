// llmchat_web/static/js/agent_ui.js

/**
 * @file agent_ui.js
 * @description UI module for managing autonomous agent tasks in llmchat-web.
 * This module provides the interface for submitting high-level goals to agents,
 * monitoring their progress through real-time streaming, and displaying results.
 *
 * Key Features:
 * - Goal submission form with provider/model override options
 * - Real-time agent task list with status updates
 * - Live streaming of the Think -> Act -> Observe loop via Server-Sent Events
 * - Visual memory access indicators and retrieved document display
 * - Final result display and task management
 *
 * Depends on:
 * - utils.js (for showToast, escapeHtml, global state)
 * - Bootstrap 5 (for modals and UI components)
 * - EventSource API (for SSE streaming)
 */

// Global state for agent tasks
window.agentTasks = new Map(); // task_id -> task object
window.activeTaskStreams = new Map(); // task_id -> EventSource instance

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

  // Add provider/model overrides if specified
  if (providerOverride && providerOverride !== "") {
    payload.provider = providerOverride;
  }
  if (modelOverride && modelOverride !== "") {
    payload.model = modelOverride;
  }

  console.log("AGENT_UI: Submitting agent goal:", payload);

  try {
    // Submit the agent task to the backend
    const response = await fetch("/api/v2/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail ||
          errorData.error ||
          `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const result = await response.json();
    const taskId = result.task_id;

    console.log(
      "AGENT_UI: Agent task submitted successfully. Task ID:",
      taskId,
    );

    // Clear the goal input
    goalTextarea.value = "";

    // Create initial task object and add to our tracking
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

    window.agentTasks.set(taskId, newTask);
    renderAgentTaskList();

    // Start monitoring this task
    startTaskStatusPolling(taskId);

    // Show success message
    showToast(
      "Success",
      `Agent task submitted successfully. Task ID: ${taskId.substring(0, 8)}...`,
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
 * Starts polling for task status updates and manages the overall task lifecycle.
 * @param {string} taskId - The unique identifier of the task to monitor
 */
function startTaskStatusPolling(taskId) {
  const pollInterval = 2000; // Poll every 2 seconds

  const pollFunction = async () => {
    try {
      const response = await fetch(`/api/v2/tasks/${taskId}`);

      if (!response.ok) {
        console.warn(
          `AGENT_UI: Failed to poll status for task ${taskId}: ${response.status}`,
        );
        return;
      }

      const statusData = await response.json();
      const task = window.agentTasks.get(taskId);

      if (task) {
        const oldStatus = task.status;
        task.status = statusData.status;
        task.result_available = statusData.result_available;

        // Update the task list UI if status changed
        if (oldStatus !== task.status) {
          console.log(
            `AGENT_UI: Task ${taskId} status changed: ${oldStatus} -> ${task.status}`,
          );
          renderAgentTaskList();
        }

        // Handle status transitions
        if (task.status === "complete" || task.status === "failed") {
          // Task is finished, stop polling
          console.log(
            `AGENT_UI: Task ${taskId} finished with status: ${task.status}`,
          );

          // Close any active stream for this task
          const activeStream = window.activeTaskStreams.get(taskId);
          if (activeStream) {
            activeStream.close();
            window.activeTaskStreams.delete(taskId);
          }

          // Fetch final result if available
          if (task.result_available) {
            await fetchAndDisplayTaskResult(taskId);
          }
        } else if (task.status === "running" || task.status === "in_progress") {
          // Task is actively running, continue polling
          setTimeout(pollFunction, pollInterval);
        } else {
          // Task is still pending or queued, continue polling
          setTimeout(pollFunction, pollInterval);
        }
      }
    } catch (error) {
      console.error(
        `AGENT_UI: Error polling status for task ${taskId}:`,
        error,
      );
      // Continue polling despite errors, but with longer interval
      setTimeout(pollFunction, pollInterval * 2);
    }
  };

  // Start the first poll immediately
  pollFunction();
}

/**
 * Initiates real-time streaming of an agent's Think -> Act -> Observe loop.
 * @param {string} taskId - The unique identifier of the task to stream
 */
function streamAgentProgress(taskId) {
  // Close any existing stream for this task
  const existingStream = window.activeTaskStreams.get(taskId);
  if (existingStream) {
    existingStream.close();
  }

  console.log(`AGENT_UI: Starting SSE stream for task ${taskId}`);

  // Create new EventSource for this task
  const eventSource = new EventSource(`/api/v2/tasks/${taskId}/stream`);
  window.activeTaskStreams.set(taskId, eventSource);

  // Get the detail view container
  const detailView = document.getElementById("agent-task-detail-view");
  const streamContainer = document.getElementById("agent-stream-container");

  // Initialize the streaming UI
  streamContainer.innerHTML = `
        <div class="agent-stream-header mb-3">
            <h6><i class="fas fa-broadcast-tower"></i> Live Agent Progress</h6>
            <small class="text-muted">Task ID: ${escapeHtml(taskId)}</small>
        </div>
        <div id="agent-steps-container" class="agent-steps">
            <!-- Agent steps will be appended here -->
        </div>
    `;

  const stepsContainer = document.getElementById("agent-steps-container");
  let stepCounter = 0;
  let lastAction = null; // Track the last action for memory operation detection

  // Handle incoming SSE messages
  eventSource.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      console.log("AGENT_UI: Received SSE event:", data);

      switch (data.type) {
        case "status":
        case "status_change":
          // Update task status in our tracking
          const task = window.agentTasks.get(taskId);
          if (task) {
            task.status = data.status;
            renderAgentTaskList();
          }

          // Add status update to stream
          appendStreamEvent(stepsContainer, {
            type: "status",
            content: `Status: ${data.status}`,
            timestamp: new Date().toLocaleTimeString(),
          });
          break;

        case "thought":
          stepCounter++;

          // Check if thought contains memory operation keywords
          const thoughtContent = data.content || data.thought;
          let enhancedThought = thoughtContent;

          // Look for memory operation indicators in the thought
          const memoryKeywords = [
            "searching my knowledge",
            "recalling our last conversation",
            "looking for information",
            "checking my memory",
            "retrieving from knowledge base",
            "searching for",
          ];

          const hasMemoryOperation = memoryKeywords.some((keyword) =>
            thoughtContent.toLowerCase().includes(keyword),
          );

          if (hasMemoryOperation) {
            enhancedThought = `<i class="fas fa-brain text-info me-2 memory-indicator" title="Memory Operation in Progress"></i>${thoughtContent}`;
          }

          appendStreamEvent(stepsContainer, {
            type: "thought",
            content: enhancedThought,
            isHtml: hasMemoryOperation,
            stepNumber: stepCounter,
            timestamp: new Date().toLocaleTimeString(),
          });
          break;

        case "action":
          const toolName =
            data.tool_name || (data.action ? data.action.name : "");
          let actionContent = `Tool: ${toolName}, Arguments: ${JSON.stringify(data.action ? data.action.arguments : data.arguments || {})}`;
          let isMemoryAction = false;

          // Check if this is a memory search action
          if (
            toolName === "semantic_search" ||
            toolName === "episodic_search"
          ) {
            const memoryType =
              toolName === "semantic_search"
                ? "Semantic Memory"
                : "Episodic Memory";
            const query = data.action
              ? data.action.arguments.query
              : data.arguments
                ? data.arguments.query
                : "unknown query";

            // Create a special visual element for the memory search action
            actionContent = `
              <div class="memory-search-action">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Searching ${memoryType} for: "<strong>${escapeHtml(query)}</strong>"</span>
              </div>
            `;
            isMemoryAction = true;
          }

          // Store the last action for observation processing
          lastAction = {
            tool_name: toolName,
            is_memory: isMemoryAction,
            data: data,
          };

          appendStreamEvent(stepsContainer, {
            type: "action",
            content: actionContent,
            isHtml: isMemoryAction,
            tool_name: toolName,
            timestamp: new Date().toLocaleTimeString(),
          });
          break;

        case "observation":
          let observationContent = escapeHtml(data.content || data.observation);
          let isMemoryObservation = false;

          // Check if this observation is from a memory search
          if (lastAction && lastAction.is_memory) {
            try {
              // Try to parse the observation as memory search results
              const documents = JSON.parse(data.content || data.observation);
              if (Array.isArray(documents)) {
                observationContent = renderRetrievedDocs(
                  documents,
                  lastAction.tool_name,
                );
                isMemoryObservation = true;
              }
            } catch (e) {
              // If parsing fails, check if it's a text-based memory result
              const obsText = data.content || data.observation;
              if (
                obsText.includes("search results") ||
                obsText.includes("Retrieved") ||
                obsText.includes("Found")
              ) {
                observationContent = renderTextMemoryResult(
                  obsText,
                  lastAction.tool_name,
                );
                isMemoryObservation = true;
              } else {
                // Fallback for unparseable memory results
                observationContent = `
                  <div class="memory-observation-fallback">
                    <p class="text-muted small">Memory search result (could not parse format):</p>
                    <pre class="memory-result-text">${escapeHtml(obsText)}</pre>
                  </div>
                `;
                isMemoryObservation = true;
              }
            }
          }

          appendStreamEvent(stepsContainer, {
            type: "observation",
            content: observationContent,
            isHtml: isMemoryObservation,
            timestamp: new Date().toLocaleTimeString(),
          });

          // Clear the last action after processing observation
          lastAction = null;
          break;

        case "complete":
          appendStreamEvent(stepsContainer, {
            type: "complete",
            content: "Task completed successfully",
            result: data.result,
            timestamp: new Date().toLocaleTimeString(),
          });

          // Close the stream
          eventSource.close();
          window.activeTaskStreams.delete(taskId);

          // Fetch and display final result
          setTimeout(() => fetchAndDisplayTaskResult(taskId), 1000);
          break;

        case "failed":
        case "error":
          appendStreamEvent(stepsContainer, {
            type: "error",
            content: data.error || data.message || "Task failed",
            timestamp: new Date().toLocaleTimeString(),
          });

          // Close the stream
          eventSource.close();
          window.activeTaskStreams.delete(taskId);
          break;

        case "heartbeat":
          // Just log heartbeats, don't display them
          console.log("AGENT_UI: Heartbeat received for task", taskId);
          break;

        default:
          console.log("AGENT_UI: Unknown SSE event type:", data.type, data);
          break;
      }

      // Auto-scroll to bottom of stream
      streamContainer.scrollTop = streamContainer.scrollHeight;
    } catch (error) {
      console.error("AGENT_UI: Error parsing SSE event:", error, event.data);
    }
  };

  // Handle SSE errors
  eventSource.onerror = function (error) {
    console.error("AGENT_UI: SSE error for task", taskId, error);

    appendStreamEvent(stepsContainer, {
      type: "error",
      content: "Connection error occurred while streaming agent progress",
      timestamp: new Date().toLocaleTimeString(),
    });

    // Clean up
    eventSource.close();
    window.activeTaskStreams.delete(taskId);
  };
}

/**
 * Renders retrieved documents from memory search into a collapsible HTML block.
 * @param {Array<Object>} documents - The documents from the memory search observation.
 * @param {string} toolName - The name of the memory tool used ('semantic_search' or 'episodic_search').
 * @returns {string} The generated HTML string.
 */
function renderRetrievedDocs(documents, toolName) {
  if (!documents || documents.length === 0) {
    return '<p class="text-muted small">No documents found in memory search.</p>';
  }

  const collapseId = `collapse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const memoryType =
    toolName === "semantic_search" ? "Semantic Memory" : "Episodic Memory";

  let itemsHtml = documents
    .map((doc, index) => {
      const score = doc.score ? `(Relevance: ${doc.score.toFixed(3)})` : "";
      const metadata = doc.metadata
        ? `Source: ${escapeHtml(JSON.stringify(doc.metadata))}`
        : "";

      return `
      <div class="retrieved-doc-item">
        <div class="retrieved-doc-header">
          <strong>Result ${index + 1} ${score}</strong>
          ${metadata ? `<small class="text-muted d-block">${metadata}</small>` : ""}
        </div>
        <div class="retrieved-doc-content">
          ${escapeHtml(doc.content || doc.text || JSON.stringify(doc))}
        </div>
      </div>
    `;
    })
    .join("");

  return `
    <div class="retrieved-docs-container">
      <div class="memory-search-header">
        <i class="fas fa-database text-success me-2"></i>
        <strong>Retrieved from ${memoryType}</strong>
      </div>
      <p class="mt-2">
        <a class="btn btn-sm btn-outline-info" data-bs-toggle="collapse" href="#${collapseId}" role="button" aria-expanded="false" aria-controls="${collapseId}">
          <i class="fas fa-eye me-1"></i>Show ${documents.length} Retrieved Document(s)
        </a>
      </p>
      <div class="collapse" id="${collapseId}">
        <div class="memory-results-container">
          ${itemsHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders text-based memory search results when documents can't be parsed as JSON.
 * @param {string} resultText - The text result from memory search.
 * @param {string} toolName - The name of the memory tool used.
 * @returns {string} The generated HTML string.
 */
function renderTextMemoryResult(resultText, toolName) {
  const memoryType =
    toolName === "semantic_search" ? "Semantic Memory" : "Episodic Memory";
  const collapseId = `text-collapse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return `
    <div class="retrieved-docs-container">
      <div class="memory-search-header">
        <i class="fas fa-database text-success me-2"></i>
        <strong>Retrieved from ${memoryType}</strong>
      </div>
      <p class="mt-2">
        <a class="btn btn-sm btn-outline-info" data-bs-toggle="collapse" href="#${collapseId}" role="button" aria-expanded="false" aria-controls="${collapseId}">
          <i class="fas fa-eye me-1"></i>Show Memory Search Results
        </a>
      </p>
      <div class="collapse" id="${collapseId}">
        <div class="memory-results-container">
          <div class="retrieved-doc-item">
            <div class="retrieved-doc-content memory-text-result">
              ${escapeHtml(resultText)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Appends a new event to the agent stream display with appropriate styling.
 * @param {HTMLElement} container - The container to append the event to
 * @param {Object} event - The event data to display
 */
function appendStreamEvent(container, event) {
  const eventDiv = document.createElement("div");
  eventDiv.className = `agent-step agent-step-${event.type}`;

  let icon, title, contentHtml;

  switch (event.type) {
    case "thought":
      icon = "fas fa-brain";
      title = `Step ${event.stepNumber}: Thinking`;
      if (event.isHtml) {
        contentHtml = `<div class="agent-thought">${event.content}</div>`;
      } else {
        contentHtml = `<div class="agent-thought">${escapeHtml(event.content)}</div>`;
      }
      break;

    case "action":
      icon = "fas fa-cog";
      title = "Action";
      if (event.isHtml) {
        contentHtml = `<div class="agent-action">${event.content}</div>`;
      } else {
        const toolDisplay = event.tool_name
          ? ` (${escapeHtml(event.tool_name)})`
          : "";
        contentHtml = `<div class="agent-action"><strong>Tool${toolDisplay}:</strong> ${escapeHtml(event.content)}</div>`;
      }
      break;

    case "observation":
      icon = "fas fa-eye";
      title = "Observation";
      if (event.isHtml) {
        contentHtml = `<div class="agent-observation">${event.content}</div>`;
      } else {
        contentHtml = `<div class="agent-observation">${escapeHtml(event.content)}</div>`;
      }
      break;

    case "complete":
      icon = "fas fa-check-circle";
      title = "Completed";
      contentHtml = `<div class="agent-complete">${escapeHtml(event.content)}</div>`;
      break;

    case "error":
      icon = "fas fa-exclamation-triangle";
      title = "Error";
      contentHtml = `<div class="agent-error">${escapeHtml(event.content)}</div>`;
      break;

    case "status":
      icon = "fas fa-info-circle";
      title = "Status Update";
      contentHtml = `<div class="agent-status">${escapeHtml(event.content)}</div>`;
      break;

    default:
      icon = "fas fa-circle";
      title = "Event";
      contentHtml = `<div class="agent-generic">${escapeHtml(event.content)}</div>`;
      break;
  }

  eventDiv.innerHTML = `
        <div class="agent-step-header">
            <i class="${icon}"></i>
            <span class="agent-step-title">${title}</span>
            <small class="agent-step-time text-muted">${event.timestamp}</small>
        </div>
        <div class="agent-step-content">
            ${contentHtml}
        </div>
    `;

  container.appendChild(eventDiv);
}

/**
 * Fetches and displays the final result of a completed agent task.
 * @param {string} taskId - The unique identifier of the completed task
 */
async function fetchAndDisplayTaskResult(taskId) {
  try {
    const response = await fetch(`/api/v2/tasks/${taskId}/result`);

    if (!response.ok) {
      console.warn(
        `AGENT_UI: Failed to fetch result for task ${taskId}: ${response.status}`,
      );
      return;
    }

    const resultData = await response.json();
    console.log("AGENT_UI: Fetched task result:", resultData);

    // Update task in our tracking
    const task = window.agentTasks.get(taskId);
    if (task) {
      task.result = resultData.result;
      task.final_status = resultData.status;
    }

    // Display result in the detail view
    const resultContainer = document.getElementById("agent-result-container");
    if (resultContainer) {
      resultContainer.innerHTML = `
                <div class="agent-result-header mb-2">
                    <h6><i class="fas fa-flag-checkered"></i> Final Result</h6>
                </div>
                <div class="agent-result-content">
                    <pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(JSON.stringify(resultData.result, null, 2))}</pre>
                </div>
            `;
      resultContainer.style.display = "block";
    }
  } catch (error) {
    console.error(`AGENT_UI: Error fetching result for task ${taskId}:`, error);
  }
}

/**
 * Renders the list of agent tasks in the left panel.
 */
function renderAgentTaskList() {
  const taskListContainer = document.getElementById("agent-task-list");

  if (window.agentTasks.size === 0) {
    taskListContainer.innerHTML =
      '<p class="text-muted small p-2">No agent tasks yet. Submit a goal above to get started.</p>';
    return;
  }

  // Convert Map to Array and sort by creation time (newest first)
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
 * @param {string} status - The task status
 * @returns {string} Bootstrap badge class
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
 * @param {string} taskId - The task ID to select
 */
function selectTaskForDetailView(taskId) {
  const task = window.agentTasks.get(taskId);
  if (!task) {
    console.warn("AGENT_UI: Task not found for detail view:", taskId);
    return;
  }

  console.log("AGENT_UI: Selecting task for detail view:", taskId);

  // Update visual selection in task list
  document.querySelectorAll(".agent-task-item").forEach((item) => {
    item.classList.remove("selected");
  });

  const selectedItem = document.querySelector(`[data-task-id="${taskId}"]`);
  if (selectedItem) {
    selectedItem.classList.add("selected");
  }

  // Show detail view and populate header
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

  // Hide welcome pane and show detail view
  if (welcomePane) welcomePane.style.display = "none";
  detailView.style.display = "block";

  // Start streaming if task is running, or fetch result if complete
  if (task.status === "running" || task.status === "in_progress") {
    streamAgentProgress(taskId);
  } else if (task.status === "complete" && task.result_available) {
    // Clear stream container and show result
    document.getElementById("agent-stream-container").innerHTML =
      '<p class="text-muted">Task completed. See result below.</p>';
    fetchAndDisplayTaskResult(taskId);
  } else if (task.status === "pending" || task.status === "queued") {
    // Show waiting message
    document.getElementById("agent-stream-container").innerHTML =
      '<p class="text-muted">Task is queued. Progress will appear here when the agent starts running.</p>';
    document.getElementById("agent-result-container").style.display = "none";
  }
}

/**
 * Fetches available providers and models to populate the override dropdowns.
 */
async function fetchProviderAndModelOptions() {
  try {
    // Fetch providers
    const providersResponse = await fetch("/api/settings/llm/providers");
    if (providersResponse.ok) {
      const providers = await providersResponse.json();
      const providerSelect = document.getElementById("agent-provider-select");

      // Clear and populate provider dropdown
      providerSelect.innerHTML =
        '<option value="">Use Session Default</option>';
      providers.forEach((provider) => {
        const option = document.createElement("option");
        option.value = provider;
        option.textContent = provider;
        providerSelect.appendChild(option);
      });

      // Set up model dropdown update when provider changes
      providerSelect.addEventListener("change", async function () {
        const modelSelect = document.getElementById("agent-model-select");
        modelSelect.innerHTML = '<option value="">Use Session Default</option>';

        if (this.value) {
          try {
            const modelsResponse = await fetch(
              `/api/settings/llm/providers/${this.value}/models`,
            );
            if (modelsResponse.ok) {
              const models = await modelsResponse.json();
              models.forEach((model) => {
                const option = document.createElement("option");
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
              });
            }
          } catch (error) {
            console.error("AGENT_UI: Error fetching models:", error);
          }
        }
      });
    }
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

  // Task list click handling (using event delegation)
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

  // Initialize provider/model options
  fetchProviderAndModelOptions();

  console.log("AGENT_UI: Agent UI event listeners initialized successfully.");
}

console.log("AGENT_UI: Agent UI module loaded.");
