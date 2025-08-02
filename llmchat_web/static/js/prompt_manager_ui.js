// llmchat_web/static/js/prompt_manager_ui.js

/**
 * @file prompt_manager_ui.js
 * @description Main orchestrator for the Prompt Management tab.
 * This script initializes all sub-modules for preset lists, the editor,
 * and shortcuts.
 */

/**
 * Initializes all event listeners for the Prompt Management tab by calling
 * the init functions of its sub-modules.
 */
function initPromptManagerEventListeners() {
  // Initialize listeners from all the new prompt modules
  initPromptListEventListeners();
  initPromptEditorEventListeners();
  initPromptShortcutsEventListeners();

  // When the main "Prompts" tab is shown, fetch the initial list of presets.
  $("#prompts-tab-btn").on("shown.bs.tab", function () {
    fetchAndDisplayPresets();
    showPresetWelcomePane(); // Ensure editor is hidden initially
  });

  console.log("Prompt Manager UI orchestrator initialized.");
}
