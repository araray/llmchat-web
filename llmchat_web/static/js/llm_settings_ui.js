// llmchat_web/static/js/llm_settings_ui.js

/**
 * @file llm_settings_ui.js
 * @description Handles UI logic for LLM provider/model selection and system messages.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses/modifies global variables from custom.js (window.currentLlmSettings).
 */

/**
 * Fetches available LLM providers and populates the provider dropdown.
 * Calls fetchAndPopulateLlmModels if a provider is already selected in window.currentLlmSettings.
 * Relies on global `window.currentLlmSettings` and `escapeHtml`.
 */
function fetchAndPopulateLlmProviders() {
  console.log("LLM_UI: Fetching LLM providers...");
  $.ajax({
    url: "/api/settings/llm/providers",
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
        // Ensure window.currentLlmSettings is defined before accessing properties
        if (
          window.currentLlmSettings &&
          window.currentLlmSettings.providerName
        ) {
          $select.val(window.currentLlmSettings.providerName);
          fetchAndPopulateLlmModels(window.currentLlmSettings.providerName); // Trigger model population
        } else {
          // If no provider is pre-selected, ensure model dropdown is in a sensible default state
          $("#llm-model-select")
            .empty()
            .append('<option selected value="">Select provider first</option>')
            .prop("disabled", true);
          if (!window.currentLlmSettings) {
            console.warn(
              "LLM_UI: window.currentLlmSettings was undefined during provider population.",
            );
          }
        }
      } else {
        $select.append('<option value="" disabled>No providers found</option>');
        $("#llm-model-select")
          .empty()
          .append('<option selected value="">No providers available</option>')
          .prop("disabled", true);
      }
      $select.prop("disabled", false);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error fetching LLM providers:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      $("#llm-provider-select")
        .empty()
        .append('<option value="" disabled>Error loading providers</option>');
      $("#llm-model-select")
        .empty()
        .append('<option value="">Select provider first</option>')
        .prop("disabled", true);
      showToast(
        "Error",
        "Could not load LLM providers. Check server logs.",
        "danger",
      );
    },
  });
}

/**
 * Fetches available models for the selected LLM provider and populates the model dropdown.
 * Relies on global `window.currentLlmSettings` and `escapeHtml`.
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
    url: `/api/settings/llm/providers/${providerName}/models`,
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
          window.currentLlmSettings && // Check defined
          window.currentLlmSettings.providerName === providerName &&
          window.currentLlmSettings.modelName
        ) {
          $modelSelect.val(window.currentLlmSettings.modelName);
        } else if (!window.currentLlmSettings) {
          console.warn(
            "LLM_UI: window.currentLlmSettings was undefined during model population.",
          );
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
        jqXHR.responseText,
      );
      $modelSelect
        .empty()
        .append('<option value="" disabled>Error loading models</option>')
        .prop("disabled", false); // Enable even on error to allow manual input if desired
      showToast(
        "Error",
        `Could not load models for ${providerName}. Check server logs.`,
        "danger",
      );
    },
  });
}

/**
 * Sends selected LLM provider and model to the backend.
 * Updates global `window.currentLlmSettings` and UI status display.
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
        // Defensive check and re-initialization for window.currentLlmSettings
        if (
          typeof window.currentLlmSettings === "undefined" ||
          window.currentLlmSettings === null
        ) {
          console.warn(
            "LLM_UI: window.currentLlmSettings was undefined/null in applyLlmSettings AJAX success. Re-initializing.",
          );
          window.currentLlmSettings = {
            providerName: null,
            modelName: null,
            systemMessage: "",
          };
        }

        window.currentLlmSettings.providerName =
          response.llm_settings.provider_name;
        window.currentLlmSettings.modelName = response.llm_settings.model_name;
        window.currentLlmSettings.systemMessage =
          response.llm_settings.system_message !== undefined
            ? response.llm_settings.system_message
            : window.currentLlmSettings.systemMessage || ""; // Preserve if not in response

        $("#status-provider").text(
          window.currentLlmSettings.providerName || "N/A",
        );
        $("#status-model").text(window.currentLlmSettings.modelName || "N/A");
        showToast("Success", "LLM settings applied successfully!", "success");
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error updating LLM settings on backend:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      showToast("Error", "Failed to apply LLM settings.", "danger");
    },
  });
}

/**
 * Fetches and displays the current system message for the session.
 * Relies on global `window.currentLlmSettings`.
 */
function fetchAndDisplaySystemMessage() {
  console.log("LLM_UI: Fetching current system message...");
  // Use the globally synced window.currentLlmSettings.systemMessage from custom.js
  // This is typically populated by fetchAndUpdateInitialStatus
  if (
    window.currentLlmSettings && // Check defined
    window.currentLlmSettings.systemMessage !== null &&
    window.currentLlmSettings.systemMessage !== undefined
  ) {
    $("#system-message-input").val(window.currentLlmSettings.systemMessage);
  } else {
    if (!window.currentLlmSettings) {
      console.warn(
        "LLM_UI: window.currentLlmSettings was undefined during system message fetch. Attempting fallback AJAX call.",
      );
    } else {
      console.warn(
        "LLM_UI: window.currentLlmSettings.systemMessage is not set, attempting fallback fetch. This might indicate an earlier init problem.",
      );
    }
    $.ajax({
      url: "/api/settings/system_message",
      type: "GET",
      dataType: "json",
      success: function (response) {
        console.log("LLM_UI: System message received (fallback):", response);
        if (response && response.system_message !== undefined) {
          // Ensure window.currentLlmSettings exists before assigning
          if (
            typeof window.currentLlmSettings === "undefined" ||
            window.currentLlmSettings === null
          ) {
            console.warn(
              "LLM_UI: window.currentLlmSettings was undefined in system message fallback. Re-initializing.",
            );
            window.currentLlmSettings = {
              providerName: null,
              modelName: null,
              systemMessage: "",
            };
          }
          window.currentLlmSettings.systemMessage = response.system_message; // Update global
          $("#system-message-input").val(response.system_message);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        console.error(
          "LLM_UI: Error fetching system message (fallback):",
          textStatus,
          errorThrown,
          jqXHR.responseText,
        );
      },
    });
  }
}

/**
 * Sends the updated system message to the backend.
 * Updates global `window.currentLlmSettings`.
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
        // Ensure window.currentLlmSettings exists before assigning
        if (
          typeof window.currentLlmSettings === "undefined" ||
          window.currentLlmSettings === null
        ) {
          console.warn(
            "LLM_UI: window.currentLlmSettings was undefined in applySystemMessage. Re-initializing.",
          );
          window.currentLlmSettings = {
            providerName: null,
            modelName: null,
            systemMessage: "",
          };
        }
        window.currentLlmSettings.systemMessage = response.system_message;
        showToast("Success", "System message applied successfully!", "success");
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "LLM_UI: Error updating system message:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      showToast("Error", "Failed to apply system message.", "danger");
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
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log(
      "LLM_UI: Settings tab shown, initializing LLM provider/model and system message.",
    );
    fetchAndPopulateLlmProviders();
    fetchAndDisplaySystemMessage();
  });
  console.log("LLM Settings UI event listeners initialized.");
}
