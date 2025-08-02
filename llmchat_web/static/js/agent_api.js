// llmchat_web/static/js/agent_api.js

/**
 * @file agent_api.js
 * @description Encapsulates all API calls related to the agent functionality.
 * This module provides a clean, promise-based interface for communicating
 * with the backend's agent and task endpoints.
 */

/**
 * Submits a new agent goal to start a task.
 * @param {object} payload - The request payload.
 * @param {string} payload.goal - The high-level goal for the agent.
 * @param {string|null} [payload.session_id] - The session ID for context.
 * @param {string|null} [payload.provider] - LLM provider override.
 * @param {string|null} [payload.model] - Model override.
 * @returns {Promise<object>} A promise that resolves with the task creation response.
 */
async function apiRunAgent(payload) {
  const response = await fetch("/api/v2/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return response.json();
}

/**
 * Fetches the status of a specific task.
 * @param {string} taskId - The unique identifier of the task.
 * @returns {Promise<object>} A promise that resolves with the task status data.
 */
async function apiGetTaskStatus(taskId) {
  const response = await fetch(`/api/v2/tasks/${taskId}`);
  if (!response.ok) {
    throw new Error(`Failed to get task status: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetches the final result of a completed task.
 * @param {string} taskId - The unique identifier of the task.
 * @returns {Promise<object>} A promise that resolves with the task result data.
 */
async function apiGetTaskResult(taskId) {
  const response = await fetch(`/api/v2/tasks/${taskId}/result`);
  if (!response.ok) {
    throw new Error(`Failed to get task result: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetches the list of available LLM providers.
 * @returns {Promise<Array<string>>} A promise that resolves with an array of provider names.
 */
async function apiGetLlmProviders() {
  const response = await fetch("/api/settings/llm/providers");
  if (!response.ok) {
    throw new Error("Failed to fetch LLM providers");
  }
  return response.json();
}

/**
 * Fetches the list of available models for a given provider.
 * @param {string} providerName - The name of the provider.
 * @returns {Promise<Array<string>>} A promise that resolves with an array of model names.
 */
async function apiGetLlmModels(providerName) {
  const response = await fetch(
    `/api/settings/llm/providers/${providerName}/models`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch models for provider ${providerName}`);
  }
  return response.json();
}

console.log("AGENT_API: Agent API module loaded.");
