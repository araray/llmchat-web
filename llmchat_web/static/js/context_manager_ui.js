// llmchat_web/static/js/context_manager_ui.js

/**
 * @file context_manager_ui.js
 * @description Main orchestrator for the Context Manager tab.
 * This script initializes all sub-modules for the context manager UI and
 * handles high-level tab switching logic to ensure content is loaded correctly.
 */

/**
 * Initializes all event listeners for the Context Manager tab by calling
 * the init functions of its sub-modules.
 */
function initContextManagerEventListeners() {
  // Initialize listeners from all the new modules
  initWorkbenchEventListeners();
  initWorkspaceEventListeners();
  initHistoryEventListeners();
  initPreviewEventListeners();

  // Handle top-level tab switching to ensure content is loaded correctly
  $("#context-manager-tab-btn").on("shown.bs.tab", function () {
    if (!$("#context-mode-toggle").is(":checked")) {
      // LLMCore Managed Mode
      if ($("#workspace-subtab-btn").hasClass("active")) {
        fetchAndDisplayWorkspaceItems();
        renderStagedContextItems(new Set()); // Render with default state
      } else if ($("#history-subtab-btn").hasClass("active")) {
        fetchAndDisplayHistoryContext();
      }
      updateFullContextPreview();
    } else {
      // UI Managed Mode
      updatePromptWorkbenchTokenEstimate();
    }
  });

  // Handle sub-tab switching inside the LLMCore Managed view
  $("#workspace-subtab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayWorkspaceItems();
    renderStagedContextItems(new Set());
    updateFullContextPreview();
  });

  $("#history-subtab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayHistoryContext();
    updateFullContextPreview();
  });

  console.log("Context Manager UI orchestrator initialized.");
}
