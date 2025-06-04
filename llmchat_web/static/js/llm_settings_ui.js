// llmchat_web/static/js/llm_settings_ui.js

/**
 * @file llm_settings_ui.js
 * @description Handles UI logic for LLM provider/model selection and system messages.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses/modifies global variables from custom.js (currentLlmSettings).
 */

/**
 * Fetches available LLM providers and populates the provider dropdown.
 * Calls fetchAndPopulateLlmModels if a provider is already selected in currentLlmSettings.
 * Relies on global `currentLlmSettings` and `escapeHtml`.
 */
function fetchAndPopulateLlmProviders() {
  console.log("LLM_UI: Fetching LLM providers...");
  $.ajax({
    url: "/api/llm/providers",
    type: "GET",
    dataType: "json",
    success: function (providers) {
      console.log("LLM_UI: LLM Providers received:", providers);
      const $select = $("#llm-provider-select");
      $select
        .empty()
        .append('<option selected value="">Select Provider...</option>');
      if (providers && providers.length > 0) {
        providers.forEach(function (provider) {
          const providerName =
            typeof provider === "string"
              ? provider
              : provider.name || provider.id;
          const providerValue =
            typeof provider === "string"
              ? provider
              : provider.id || provider.name;
          $select.append(
            $("<option>", {
              value: providerValue,
              text: escapeHtml(providerName), // escapeHtml from utils.js
            }),
          );
        });
        if (currentLlmSettings.providerName) {
          // currentLlmSettings from custom.js
          $select.val(currentLlmSettings.providerName);
          fetchAndPopulateLlmModels(currentLlmSettings.providerName); // Trigger model population
        }
      } else {
        $select.append('<option value="" disabled>No providers found</option>');
      }
      $select.prop("disabled", false);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error fetching LLM providers:",
        textStatus,
        errorThrown,
      );
      $("#llm-provider-select")
        .empty()
        .append('<option value="" disabled>Error loading providers</option>');
      $("#llm-model-select")
        .empty()
        .append('<option value="">Select provider first</option>')
        .prop("disabled", true);
    },
  });
}

/**
 * Fetches available models for the selected LLM provider and populates the model dropdown.
 * Relies on global `currentLlmSettings` and `escapeHtml`.
 * @param {string} providerName - The name of the selected LLM provider.
 */
function fetchAndPopulateLlmModels(providerName) {
  console.log(`LLM_UI: Fetching models for provider: ${providerName}...`);
  const $modelSelect = $("#llm-model-select");
  $modelSelect
    .empty()
    .append('<option selected value="">Loading models...</option>')
    .prop("disabled", true);

  if (!providerName) {
    $modelSelect
      .empty()
      .append('<option selected value="">Select provider first</option>')
      .prop("disabled", true);
    return;
  }

  $.ajax({
    url: `/api/llm/providers/${providerName}/models`,
    type: "GET",
    dataType: "json",
    success: function (models) {
      console.log(`LLM_UI: Models for ${providerName}:`, models);
      $modelSelect
        .empty()
        .append('<option selected value="">Select Model...</option>');
      if (models && models.length > 0) {
        models.forEach(function (model) {
          const modelName =
            typeof model === "string" ? model : model.name || model.id;
          const modelValue =
            typeof model === "string" ? model : model.id || model.name;
          $modelSelect.append(
            $("<option>", { value: modelValue, text: escapeHtml(modelName) }), // escapeHtml from utils.js
          );
        });
        // Set model if current settings match the provider and a model is selected
        if (
          currentLlmSettings.providerName === providerName && // currentLlmSettings from custom.js
          currentLlmSettings.modelName
        ) {
          $modelSelect.val(currentLlmSettings.modelName);
        }
      } else {
        $modelSelect.append(
          '<option value="" disabled>No models found for this provider (or type any)</option>',
        );
      }
      $modelSelect.prop("disabled", false);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        `LLM_UI: Error fetching models for ${providerName}:`,
        textStatus,
        errorThrown,
      );
      $modelSelect
        .empty()
        .append('<option value="" disabled>Error loading models</option>')
        .prop("disabled", false); // Enable even on error to allow manual input if desired
    },
  });
}

/**
 * Sends selected LLM provider and model to the backend.
 * Updates global `currentLlmSettings` and UI status display.
 * Uses global `showToast`.
 */
function applyLlmSettings() {
  const providerName = $("#llm-provider-select").val();
  const modelName = $("#llm-model-select").val();

  if (!providerName) {
    showToast("Warning", "Please select an LLM provider.", "warning"); // showToast from utils.js
    return;
  }
  console.log(
    `LLM_UI: Applying LLM settings: Provider=${providerName}, Model=${modelName}`,
  );

  $.ajax({
    url: "/api/settings/llm/update",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      provider_name: providerName,
      model_name: modelName || null, // Send null if modelName is empty
    }),
    dataType: "json",
    success: function (response) {
      console.log(
        "LLM_UI: LLM settings updated successfully on backend:",
        response,
      );
      if (response && response.llm_settings) {
        // Update global currentLlmSettings from custom.js
        window.currentLlmSettings.providerName =
          response.llm_settings.provider_name;
        window.currentLlmSettings.modelName = response.llm_settings.model_name;

        $("#status-provider").text(
          window.currentLlmSettings.providerName || "N/A",
        );
        $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
        showToast("Success", "LLM settings applied successfully!", "success"); // showToast from utils.js
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error updating LLM settings on backend:",
        textStatus,
        errorThrown,
      );
      showToast("Error", "Failed to apply LLM settings.", "danger"); // showToast from utils.js
    },
  });
}

/**
 * Fetches and displays the current system message for the session.
 * Relies on global `currentLlmSettings`.
 */
function fetchAndDisplaySystemMessage() {
  console.log("LLM_UI: Fetching current system message...");
  // Use the globally synced currentLlmSettings.systemMessage from custom.js
  if (
    currentLlmSettings.systemMessage !== null &&
    currentLlmSettings.systemMessage !== undefined
  ) {
    $("#system-message-input").val(currentLlmSettings.systemMessage);
  } else {
    // Fallback AJAX call if global state is not set (should ideally be set by fetchAndUpdateInitialStatus)
    $.ajax({
      url: "/api/settings/system_message",
      type: "GET",
      dataType: "json",
      success: function (response) {
        console.log("LLM_UI: System message received (fallback):", response);
        if (response && response.system_message !== undefined) {
          window.currentLlmSettings.systemMessage = response.system_message; // Update global
          $("#system-message-input").val(response.system_message);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "LLM_UI: Error fetching system message (fallback):",
          textStatus,
          errorThrown,
        );
      },
    });
  }
}

/**
 * Sends the updated system message to the backend.
 * Updates global `currentLlmSettings`.
 * Uses global `showToast`.
 */
function applySystemMessage() {
  const systemMessage = $("#system-message-input").val();
  console.log("LLM_UI: Applying system message:", systemMessage);

  $.ajax({
    url: "/api/settings/system_message/update",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ system_message: systemMessage }),
    dataType: "json",
    success: function (response) {
      console.log("LLM_UI: System message updated successfully:", response);
      if (response && response.system_message !== undefined) {
        window.currentLlmSettings.systemMessage = response.system_message; // Update global currentLlmSettings
        showToast("Success", "System message applied successfully!", "success"); // showToast from utils.js
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error updating system message:",
        textStatus,
        errorThrown,
      );
      showToast("Error", "Failed to apply system message.", "danger"); // showToast from utils.js
    },
  });
}

/**
 * Initializes event listeners for LLM settings controls.
 */
function initLlmSettingsEventListeners() {
  // Provider selection changes, fetch models
  $("#llm-provider-select").on("change", function () {
    const selectedProvider = $(this).val();
    if (selectedProvider) {
      fetchAndPopulateLlmModels(selectedProvider);
    } else {
      $("#llm-model-select")
        .empty()
        .append('<option value="">Select provider first</option>')
        .prop("disabled", true);
    }
  });

  // Apply LLM provider and model settings
  $("#btn-apply-llm-settings").on("click", function () {
    applyLlmSettings();
  });

  // Apply System Message
  $("#btn-apply-system-message").on("click", function () {
    applySystemMessage();
  });

  // When settings tab is shown, ensure LLM settings UI is up-to-date
  // Note: The prompt template values part of this handler remains in custom.js
  // or will be moved to its own module.
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "LLM_UI: Settings tab shown, initializing LLM provider/model and system message.",
    );
    fetchAndPopulateLlmProviders(); // This will also populate models if a provider is set
    fetchAndDisplaySystemMessage();
    // The call to fetchAndDisplayPromptTemplateValues() remains in custom.js's $(document).ready()
    // or will be part of a separate prompt_template_ui.js initialization.
  });
  console.log("LLM Settings UI event listeners initialized.");
}
