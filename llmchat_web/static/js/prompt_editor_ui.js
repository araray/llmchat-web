// llmchat_web/static/js/prompt_editor_ui.js

/**
 * @file prompt_editor_ui.js
 * @description Handles all UI logic for the main Prompt Preset editor pane,
 * including the form, item list, item editor modal, and save/delete actions.
 */

// State variables for the editor
let currentlyEditingPreset = null;
let presetEditorItems = [];
let editingItemId = null;
const FAVORITE_PRESETS_KEY = "llmchat_favorite_presets"; // Shared with shortcuts UI

/**
 * Switches the right-hand pane to show the editor form.
 */
function showPresetEditor() {
  $("#prompt-preset-welcome-pane").addClass("d-none");
  $("#prompt-preset-editor-pane").removeClass("d-none");
}

/**
 * Switches the right-hand pane to show the welcome/placeholder message.
 */
function showPresetWelcomePane() {
  $("#prompt-preset-editor-pane").addClass("d-none");
  $("#prompt-preset-welcome-pane").removeClass("d-none");
}

/**
 * Populates the editor form with the data of a specific preset.
 * @param {object} preset - The full preset object from the backend.
 */
function displayPresetForEditing(preset) {
  currentlyEditingPreset = preset;
  presetEditorItems = preset.items.map((item) => ({ ...item }));

  $("#prompt-preset-editor-original-name").val(preset.name);
  $("#prompt-preset-name").val(preset.name);
  $("#prompt-preset-description").val(preset.description || "");

  renderPresetItemsList();
  updateFavoriteStarUI(preset.name);
  showPresetEditor();
}

/**
 * Clears the editor form to prepare for creating a new preset.
 */
function clearAndShowNewPresetForm() {
  currentlyEditingPreset = null;
  presetEditorItems = [];

  $("#prompt-preset-editor-original-name").val("");
  $("#prompt-preset-name").val("").prop("disabled", false);
  $("#prompt-preset-description").val("");

  renderPresetItemsList();
  updateFavoriteStarUI(null);

  $("#prompt-preset-list .list-group-item.active").removeClass("active");
  showPresetEditor();
}

/**
 * Renders the list of items for the currently editing preset.
 */
function renderPresetItemsList() {
  const $list = $("#prompt-preset-items-list").empty();
  if (presetEditorItems.length === 0) {
    $list.html(
      '<p class="text-muted small text-center p-3">No items in this preset.</p>',
    );
    return;
  }
  presetEditorItems.forEach(function (item) {
    const contentPreview =
      item.type === "preset_file_reference"
        ? `Path: ${item.source_identifier || "Not set"}`
        : (item.content || "").substring(0, 100) + "...";
    const $itemDiv = $(`
      <div class="staged-context-item" data-item-id="${escapeHtml(item.item_id)}">
        <div class="staged-item-header">${escapeHtml(item.type.replace(/_/g, " ").replace(/(?:^|\s)\S/g, (a) => a.toUpperCase()))}</div>
        <div class="staged-item-content-preview">${escapeHtml(contentPreview)}</div>
        <div class="staged-item-actions mt-1">
          <button class="btn btn-sm btn-outline-warning btn-edit-preset-item" title="Edit Item"><i class="fas fa-edit fa-xs"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-remove-preset-item" title="Remove Item"><i class="fas fa-trash-alt fa-xs"></i></button>
        </div>
      </div>`);
    $list.append($itemDiv);
  });
}

/**
 * Handles the logic for saving a preset (create or update).
 */
function savePreset() {
  const originalName = $("#prompt-preset-editor-original-name").val();
  const newName = $("#prompt-preset-name").val().trim();
  if (!newName) {
    showToast("Error", "Preset name cannot be empty.", "danger");
    return;
  }

  const payload = {
    name: newName,
    description: $("#prompt-preset-description").val().trim(),
    items: presetEditorItems,
    metadata: {},
  };

  const isCreating = !originalName;
  const isRenaming = !isCreating && originalName !== newName;

  const saveOrUpdate = (name) => {
    const url = isCreating
      ? "/api/presets"
      : `/api/presets/${encodeURIComponent(name)}`;
    const method = isCreating ? "POST" : "PUT";
    $.ajax({
      url,
      type: method,
      contentType: "application/json",
      data: JSON.stringify(payload),
    })
      .done(function (savedPreset) {
        showToast("Success", `Preset '${savedPreset.name}' saved.`, "success");
        fetchAndDisplayPresets();
        displayPresetForEditing(savedPreset);
        renderQuickPromptBar();
      })
      .fail((jqXHR) =>
        showToast(
          "Error",
          jqXHR.responseJSON?.error || "Failed to save preset.",
          "danger",
        ),
      );
  };

  if (isRenaming) {
    $.ajax({
      url: `/api/presets/${encodeURIComponent(originalName)}/rename`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ new_name: newName }),
    })
      .done(() => saveOrUpdate(newName))
      .fail((jqXHR) =>
        showToast(
          "Error",
          jqXHR.responseJSON?.error || "Failed to rename preset.",
          "danger",
        ),
      );
  } else {
    saveOrUpdate(newName);
  }
}

/**
 * Handles deleting the currently edited preset.
 */
function deletePreset() {
  const presetName = $("#prompt-preset-editor-original-name").val();
  if (!presetName) return;

  showToast(
    "Confirm",
    `Delete preset '${presetName}'?`,
    "warning",
    true,
    (confirmed) => {
      if (confirmed) {
        $.ajax({
          url: `/api/presets/${encodeURIComponent(presetName)}`,
          type: "DELETE",
        })
          .done(function (response) {
            showToast(
              "Success",
              response.message || "Preset deleted.",
              "success",
            );
            toggleFavoritePreset(presetName); // Also removes from favorites
            fetchAndDisplayPresets();
            showPresetWelcomePane();
          })
          .fail((jqXHR) =>
            showToast(
              "Error",
              jqXHR.responseJSON?.error || "Failed to delete preset.",
              "danger",
            ),
          );
      }
    },
  );
}

/**
 * Initializes event listeners for the preset editor UI.
 */
function initPromptEditorEventListeners() {
  // Editor Action Buttons
  $("#btn-save-prompt-preset").on("click", savePreset);
  $("#btn-delete-prompt-preset").on("click", deletePreset);

  // Favorite Star
  if ($("#btn-toggle-favorite-preset").length === 0) {
    $("#prompt-preset-editor-pane h5").append(
      '<i id="btn-toggle-favorite-preset" class="far fa-star ms-2" style="cursor: pointer;" title="Add to favorites"></i>',
    );
  }
  $("#prompt-preset-editor-pane").on(
    "click",
    "#btn-toggle-favorite-preset",
    function () {
      toggleFavoritePreset($("#prompt-preset-editor-original-name").val());
    },
  );

  // Preset Item Management
  $("#btn-add-preset-item").on("click", () => {
    editingItemId = null;
    $("#promptPresetItemModalLabel").text("Add New Preset Item");
    $("#form-prompt-preset-item-editor")[0].reset();
    $("#preset-item-type-select").trigger("change");
    new bootstrap.Modal(
      document.getElementById("promptPresetItemModal"),
    ).show();
  });

  $("#prompt-preset-items-list").on(
    "click",
    ".btn-edit-preset-item",
    function () {
      const itemId = $(this).closest(".staged-context-item").data("item-id");
      const item = presetEditorItems.find((i) => i.item_id === itemId);
      if (item) {
        editingItemId = itemId;
        $("#promptPresetItemModalLabel").text("Edit Preset Item");
        $("#preset-item-editor-item-id").val(item.item_id);
        $("#preset-item-type-select").val(item.type).trigger("change");
        $("#preset-item-content-input").val(item.content || "");
        $("#preset-item-path-input").val(
          item.type === "preset_file_reference" ? item.source_identifier : "",
        );
        $("#preset-item-metadata-input").val(
          item.metadata ? JSON.stringify(item.metadata, null, 2) : "",
        );
        new bootstrap.Modal(
          document.getElementById("promptPresetItemModal"),
        ).show();
      }
    },
  );

  $("#prompt-preset-items-list").on(
    "click",
    ".btn-remove-preset-item",
    function () {
      const itemId = $(this).closest(".staged-context-item").data("item-id");
      presetEditorItems = presetEditorItems.filter((i) => i.item_id !== itemId);
      renderPresetItemsList();
    },
  );

  // Item Editor Modal Logic
  $("#preset-item-type-select").on("change", function () {
    const isFile = $(this).val() === "preset_file_reference";
    $("#preset-item-content-group").toggle(!isFile);
    $("#preset-item-path-group").toggle(isFile);
  });

  $("#btn-save-preset-item").on("click", function () {
    let metadata;
    try {
      metadata = JSON.parse(
        $("#preset-item-metadata-input").val().trim() || "{}",
      );
    } catch (e) {
      showToast("Error", "Metadata is not valid JSON.", "danger");
      return;
    }
    const itemData = {
      item_id: $("#preset-item-editor-item-id").val() || `pi_${Date.now()}`,
      type: $("#preset-item-type-select").val(),
      content: $("#preset-item-content-input").val(),
      source_identifier: $("#preset-item-path-input").val(),
      metadata: metadata,
    };
    if (editingItemId) {
      const index = presetEditorItems.findIndex(
        (i) => i.item_id === editingItemId,
      );
      if (index > -1) presetEditorItems[index] = itemData;
    } else {
      presetEditorItems.push(itemData);
    }
    renderPresetItemsList();
    bootstrap.Modal.getInstance(
      document.getElementById("promptPresetItemModal"),
    ).hide();
  });

  console.log("Prompt Editor UI event listeners initialized.");
}
