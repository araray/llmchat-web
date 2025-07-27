// llmchat_web/static/js/agent_stream.js

/**
 * @file agent_stream.js
 * @description Handles real-time streaming of agent progress via SSE.
 * This module is responsible for creating the EventSource, parsing incoming
 * events, and rendering them to the UI, including special visualizations for
 * memory access.
 *
 * Depends on:
 * - utils.js (for escapeHtml)
 */

// Global state for active SSE streams
window.activeTaskStreams = new Map(); // task_id -> EventSource instance

/**
 * Initiates real-time streaming of an agent's Think -> Act -> Observe loop.
 * @param {string} taskId - The unique identifier of the task to stream.
 */
function streamAgentProgress(taskId) {
  if (window.activeTaskStreams.has(taskId)) {
    window.activeTaskStreams.get(taskId).close();
  }

  const eventSource = new EventSource(`/api/v2/tasks/${taskId}/stream`);
  window.activeTaskStreams.set(taskId, eventSource);

  const streamContainer = document.getElementById("agent-stream-container");
  streamContainer.innerHTML = `
    <div class="agent-stream-header mb-3">
      <h6><i class="fas fa-broadcast-tower"></i> Live Agent Progress</h6>
      <small class="text-muted">Task ID: ${escapeHtml(taskId)}</small>
    </div>
    <div id="agent-steps-container" class="agent-steps"></div>
  `;
  const stepsContainer = document.getElementById("agent-steps-container");
  let stepCounter = 0;
  let lastAction = null;

  eventSource.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "status":
        case "status_change":
          const task = window.agentTasks.get(taskId);
          if (task) {
            task.status = data.status;
            renderAgentTaskList();
          }
          appendStreamEvent(stepsContainer, {
            type: "status",
            content: `Status: ${data.status}`,
          });
          break;
        case "thought":
          stepCounter++;
          const thoughtContent = data.content || data.thought;
          const hasMemoryOp = [
            "searching my knowledge",
            "recalling",
            "looking for information",
            "checking my memory",
            "retrieving from knowledge base",
            "searching for",
          ].some((kw) => thoughtContent.toLowerCase().includes(kw));
          const enhancedThought = hasMemoryOp
            ? `<i class="fas fa-brain text-info me-2 memory-indicator" title="Memory Operation"></i>${thoughtContent}`
            : thoughtContent;
          appendStreamEvent(stepsContainer, {
            type: "thought",
            content: enhancedThought,
            isHtml: hasMemoryOp,
            stepNumber: stepCounter,
          });
          break;
        case "action":
          const toolName =
            data.tool_name || (data.action ? data.action.name : "");
          const isMemoryAction =
            toolName === "semantic_search" || toolName === "episodic_search";
          let actionContent;
          if (isMemoryAction) {
            const query =
              data.action?.arguments?.query ||
              data.arguments?.query ||
              "unknown";
            actionContent = `
              <div class="memory-search-action">
                <div class="spinner-border spinner-border-sm me-2"></div>
                <span>Searching ${toolName.replace("_", " ")} for: "<strong>${escapeHtml(query)}</strong>"</span>
              </div>`;
          } else {
            actionContent = `Tool: ${toolName}, Args: ${JSON.stringify(data.action?.arguments || data.arguments || {})}`;
          }
          lastAction = { tool_name: toolName, is_memory: isMemoryAction };
          appendStreamEvent(stepsContainer, {
            type: "action",
            content: actionContent,
            isHtml: isMemoryAction,
            tool_name: toolName,
          });
          break;
        case "observation":
          let obsContent = data.content || data.observation;
          let isMemoryObs = false;
          if (lastAction?.is_memory) {
            try {
              const docs = JSON.parse(obsContent);
              obsContent = renderRetrievedDocs(docs, lastAction.tool_name);
              isMemoryObs = true;
            } catch (e) {
              obsContent = renderTextMemoryResult(
                obsContent,
                lastAction.tool_name,
              );
              isMemoryObs = true;
            }
          }
          appendStreamEvent(stepsContainer, {
            type: "observation",
            content: obsContent,
            isHtml: isMemoryObs,
          });
          lastAction = null;
          break;
        case "complete":
          appendStreamEvent(stepsContainer, {
            type: "complete",
            content: "Task completed successfully",
          });
          eventSource.close();
          window.activeTaskStreams.delete(taskId);
          setTimeout(() => fetchAndDisplayTaskResult(taskId), 1000);
          break;
        case "failed":
        case "error":
          appendStreamEvent(stepsContainer, {
            type: "error",
            content: data.error || data.message || "Task failed",
          });
          eventSource.close();
          window.activeTaskStreams.delete(taskId);
          break;
      }
      streamContainer.scrollTop = streamContainer.scrollHeight;
    } catch (error) {
      console.error(
        "AGENT_STREAM: Error parsing SSE event:",
        error,
        event.data,
      );
    }
  };

  eventSource.onerror = function (error) {
    console.error(`AGENT_STREAM: SSE error for task ${taskId}`, error);
    appendStreamEvent(stepsContainer, {
      type: "error",
      content: "Connection error occurred while streaming.",
    });
    eventSource.close();
    window.activeTaskStreams.delete(taskId);
  };
}

/**
 * Appends a new event to the agent stream display with appropriate styling.
 * @param {HTMLElement} container - The container to append the event to.
 * @param {object} event - The event data to display.
 */
function appendStreamEvent(container, event) {
  const eventDiv = document.createElement("div");
  eventDiv.className = `agent-step agent-step-${event.type}`;
  const timestamp = new Date().toLocaleTimeString();
  let icon, title, contentHtml;

  switch (event.type) {
    case "thought":
      icon = "fas fa-brain";
      title = `Step ${event.stepNumber}: Thinking`;
      break;
    case "action":
      icon = "fas fa-cog";
      title = "Action";
      break;
    case "observation":
      icon = "fas fa-eye";
      title = "Observation";
      break;
    case "complete":
      icon = "fas fa-check-circle";
      title = "Completed";
      break;
    case "error":
      icon = "fas fa-exclamation-triangle";
      title = "Error";
      break;
    case "status":
      icon = "fas fa-info-circle";
      title = "Status Update";
      break;
    default:
      icon = "fas fa-circle";
      title = "Event";
      break;
  }

  contentHtml = event.isHtml ? event.content : escapeHtml(event.content);

  eventDiv.innerHTML = `
    <div class="agent-step-header">
      <i class="${icon}"></i>
      <span class="agent-step-title">${title}</span>
      <small class="agent-step-time text-muted">${timestamp}</small>
    </div>
    <div class="agent-step-content">${contentHtml}</div>
  `;
  container.appendChild(eventDiv);
}

/**
 * Renders retrieved documents from memory search into a collapsible HTML block.
 * @param {Array<object>} documents - The documents from the memory search observation.
 * @param {string} toolName - The name of the memory tool used.
 * @returns {string} The generated HTML string.
 */
function renderRetrievedDocs(documents, toolName) {
  if (!documents || documents.length === 0)
    return '<p class="text-muted small">No documents found.</p>';
  const collapseId = `collapse-${Date.now()}`;
  const memoryType = toolName.includes("semantic")
    ? "Semantic Memory"
    : "Episodic Memory";
  const itemsHtml = documents
    .map(
      (doc, index) => `
    <div class="retrieved-doc-item">
      <div class="retrieved-doc-header">
        <strong>Result ${index + 1} ${doc.score ? `(Relevance: ${doc.score.toFixed(3)})` : ""}</strong>
      </div>
      <div class="retrieved-doc-content">${escapeHtml(doc.content || JSON.stringify(doc))}</div>
    </div>
  `,
    )
    .join("");
  return `
    <div class="retrieved-docs-container">
      <div class="memory-search-header"><i class="fas fa-database text-success me-2"></i><strong>Retrieved from ${memoryType}</strong></div>
      <p class="mt-2"><a class="btn btn-sm btn-outline-info" data-bs-toggle="collapse" href="#${collapseId}"><i class="fas fa-eye me-1"></i>Show ${documents.length} Document(s)</a></p>
      <div class="collapse" id="${collapseId}"><div class="memory-results-container">${itemsHtml}</div></div>
    </div>`;
}

/**
 * Renders text-based memory search results.
 * @param {string} resultText - The text result from memory search.
 * @param {string} toolName - The name of the memory tool used.
 * @returns {string} The generated HTML string.
 */
function renderTextMemoryResult(resultText, toolName) {
  const memoryType = toolName.includes("semantic")
    ? "Semantic Memory"
    : "Episodic Memory";
  return `
      <div class="retrieved-docs-container">
        <div class="memory-search-header"><i class="fas fa-database text-success me-2"></i><strong>Retrieved from ${memoryType}</strong></div>
        <div class="memory-observation-fallback"><pre class="memory-result-text">${escapeHtml(resultText)}</pre></div>
      </div>`;
}

console.log("AGENT_STREAM: Agent stream module loaded.");
