// llmchat_web/static/js/main_controller.js

/**
 * @file main_controller.js
 * @description Main JavaScript controller and orchestrator for the llmchat-web interface.
 * This file initializes the application by dynamically loading external libraries,
 * fetching the initial server status, and then initializing all specialized UI modules.
 *
 * Global state variables are declared in utils.js and populated here.
 */

/**
 * Dynamically loads a script from a given URL and returns a Promise.
 * @param {string} url The URL of the script to load.
 * @returns {Promise<void>} A promise that resolves when the script is loaded.
 */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads all required external libraries in sequence before initializing the main application.
 */
async function loadDependenciesAndInitializeApp() {
  console.log("MAIN_CTRL: Starting dynamic library loading...");
  const libraryUrls = [
    "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js",
    "https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.umd.min.js",
    "https://cdn.jsdelivr.net/npm/marked-highlight@2.2.1/lib/index.umd.min.js",
    "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js",
  ];

  try {
    for (const url of libraryUrls) {
      await loadScript(url);
    }
    console.log(
      "MAIN_CTRL: All external libraries loaded. Initializing application.",
    );

    // Initialize core components first
    initRenderingPipeline();
    initializeTheme();
    fetchAndUpdateInitialStatus();

    // Initialize event listeners from all UI modules
    const initFunctions = [
      initThemeEventListeners,
      initSessionUIEventListeners,
      initChatEventListeners,
      initRagEventListeners,
      initLlmSettingsEventListeners,
      initContextManagerEventListeners,
      initPromptManagerEventListeners,
      initPromptTemplateEventListeners,
      initIngestionEventListeners,
      initAgentEventListeners,
    ];

    initFunctions.forEach((initFunc) => {
      if (typeof initFunc === "function") {
        initFunc();
      } else {
        console.warn(`MAIN_CTRL: A module's init function is not available.`);
      }
    });
  } catch (error) {
    console.error("FATAL: A critical library failed to load.", error);
    showToast(
      "Application Error",
      `A critical library failed to load: ${error.message}. Please refresh the page.`,
      "danger",
      false,
    );
  }
}

/**
 * Fetches initial status from the backend and updates the UI and global state.
 */
function fetchAndUpdateInitialStatus() {
  console.log("MAIN_CTRL: Fetching initial status from /api/status...");
  $.ajax({
    url: "/api/status",
    type: "GET",
    dataType: "json",
    success: function (status) {
      console.log("MAIN_CTRL: Initial status received:", status);

      // --- Update Global State ---
      window.currentLlmSessionId = status.current_session_id;
      window.currentLlmSettings = {
        providerName: status.current_provider || null,
        modelName: status.current_model || null,
        systemMessage: status.system_message || "",
      };
      window.currentRagSettings = {
        enabled: status.rag_enabled || false,
        collectionName: status.rag_collection_name || null,
        kValue: status.rag_k_value || 3,
        filter: status.rag_filter || null,
      };
      window.currentPromptTemplateValues = status.prompt_template_values || {};
      window.lastBaseContextUsage = status.context_usage;

      // --- Update UI Elements ---
      $("#app-version-display").text(`v${status.app_version || "?"}`);
      $("#llmcore-status-sidebar")
        .removeClass("bg-danger bg-warning")
        .addClass(
          status.llmcore_status === "operational" ? "bg-success" : "bg-danger",
        )
        .text(status.llmcore_status === "operational" ? "OK" : "Error");
      if (status.llmcore_status !== "operational" && status.llmcore_error) {
        showToast("LLMCore Error", status.llmcore_error, "danger");
      }

      $("#status-provider").text(
        window.currentLlmSettings.providerName || "N/A",
      );
      $("#status-model").text(window.currentLlmSettings.modelName || "N/A");

      // --- Trigger UI Module Updates ---
      updateChatPanelState(!!window.currentLlmSessionId);
      updateContextUsageDisplay(window.lastBaseContextUsage);
      fetchAndPopulateLlmProviders();
      fetchAndDisplaySystemMessage();
      updateRagControlsState();
      fetchAndPopulateRagCollections();
      fetchAndDisplayPromptTemplateValues();
      fetchAndDisplaySessions(); // From session_ui.js
      fetchAndPopulateThemes(); // From theme_manager.js
      renderQuickPromptBar(); // From prompt_shortcuts_ui.js

      console.log(
        "MAIN_CTRL: Initial UI state updated from /api/status response.",
      );
    },
    error: function () {
      showToast(
        "Initialization Error",
        "Could not fetch initial server status.",
        "danger",
      );
      updateChatPanelState(false);
    },
  });
}

/**
 * Enables or disables the main chat input panel based on session state.
 * @param {boolean} isEnabled - True to enable, false to disable.
 */
function updateChatPanelState(isEnabled) {
  const $chatInput = $("#chat-input");
  const $sendButton = $("#send-chat-message");
  if (isEnabled) {
    $chatInput
      .prop("disabled", false)
      .attr("placeholder", "Type your message...");
    $sendButton.prop("disabled", false);
  } else {
    $chatInput
      .prop("disabled", true)
      .attr("placeholder", "Create or load a session to begin chatting.");
    $sendButton.prop("disabled", true);
  }
}

/**
 * Fetches application logs from the backend and displays them in the logs modal.
 */
function fetchAndDisplayAppLogs() {
  const $logsDisplay = $("#app-logs-display");
  $logsDisplay.text("Fetching logs...");
  $.ajax({
    url: "/api/logs",
    type: "GET",
    dataType: "json",
    success: function (response) {
      $logsDisplay.text(
        response.logs || response.error || "No log content received.",
      );
      $logsDisplay.scrollTop($logsDisplay[0].scrollHeight);
    },
    error: function (jqXHR) {
      const errorMsg = jqXHR.responseJSON?.error || "Failed to fetch logs.";
      $logsDisplay.text(`Error: ${escapeHtml(errorMsg)}`);
    },
  });
}

// --- Application Entry Point ---
$(document).ready(function () {
  loadDependenciesAndInitializeApp();

  // Logs Modal Button (can stay here as it's a general utility)
  $("#btn-view-app-logs").on("click", function () {
    fetchAndDisplayAppLogs();
    var appLogsModal = new bootstrap.Modal(
      document.getElementById("appLogsModal"),
    );
    appLogsModal.show();
  });

  console.log("MAIN_CTRL: LLMChat Web UI core initialized.");
});
