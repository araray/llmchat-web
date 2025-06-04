// llmchat_web/static/js/session_api.js

/**
 * @file session_api.js
 * @description Functions for making API calls related to session management.
 * These functions return jQuery AJAX promises.
 */

/**
 * Fetches the list of all available sessions from the backend.
 * @returns {Promise} jQuery AJAX promise.
 */
function apiFetchSessions() {
  console.log("API: Fetching all sessions...");
  return $.ajax({
    url: "/api/sessions",
    type: "GET",
    dataType: "json",
  });
}

/**
 * Requests the creation of a new session context from the backend.
 * @returns {Promise} jQuery AJAX promise.
 */
function apiCreateNewSession() {
  console.log("API: Requesting new session...");
  return $.ajax({
    url: "/api/sessions/new",
    type: "POST",
    dataType: "json",
  });
}

/**
 * Requests to load an existing session from the backend.
 * @param {string} sessionId - The ID of the session to load.
 * @returns {Promise} jQuery AJAX promise.
 */
function apiLoadSession(sessionId) {
  console.log(`API: Requesting to load session: ${sessionId}`);
  return $.ajax({
    url: `/api/sessions/${sessionId}/load`,
    type: "GET",
    dataType: "json",
  });
}

/**
 * Requests to delete a session from the backend.
 * @param {string} sessionId - The ID of the session to delete.
 * @returns {Promise} jQuery AJAX promise.
 */
function apiDeleteSession(sessionId) {
  console.log(`API: Requesting to delete session: ${sessionId}`);
  return $.ajax({
    url: `/api/sessions/${sessionId}`,
    type: "DELETE",
    dataType: "json",
  });
}
