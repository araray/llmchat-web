// llmchat_web/static/js/context_workspace_ui.js

/**
 * @file context_workspace_ui.js
 * @description Handles UI logic for the Workspace & Staging sub-tab within the
 * LLMCore Managed context mode. This includes the workspace item pool and the
 * active context specification (staged items).
 * Depends on utils.js, context_preview_ui.js and accesses/modifies global state.
 */

/**
 * Fetches and displays workspace items for the current session.
 * Relies on global `currentLlmSessionId` from main_controller.js.
 */
function fetchAndDisplayWorkspaceItems() {
  if (!window.currentLlmSessionId) {
    $("#workspace-items-list").html(
      '<p class="text-muted p-2">No active session.</p>',
    );
    return;
  }
  console.log(
    `CTX_WORKSPACE_UI: Fetching workspace items for session: ${window.currentLlmSessionId}`,
  );
  $.ajax({
    url: `/api/sessions/${window.currentLlmSessionId}/workspace/items`,
    type: "GET",
    dataType: "json",
    success: function (items) {
      console.log("CTX_WORKSPACE_UI: Workspace items received:", items);
      const $itemList = $("#workspace-items-list").empty();
      if (items && items.length > 0) {
        items.forEach(function (item) {
          const itemTypeDisplay = item.type || "UNKNOWN";
          const sourceIdDisplay = item.source_id || item.id;
          const contentPreview = item.content
            ? item.content.substring(0, 100) +
              (item.content.length > 100 ? "..." : "")
            : "No content preview.";
          const $itemDiv = $("<div>", {
            class: "workspace-item",
            "data-item-id": item.id,
            "data-item-type": item.type,
            "data-item-content-preview": item.content,
          });
          $itemDiv.append(
            `<div class="workspace-item-header">ID: ${escapeHtml(item.id)} (Type: ${escapeHtml(itemTypeDisplay)})</div>`,
          );
          $itemDiv.append(
            `<div class="small text-muted">Source: ${escapeHtml(sourceIdDisplay)}</div>`,
          );
          $itemDiv.append(
            `<div class="workspace-item-content-preview">${escapeHtml(contentPreview.replace(/\n/g, " "))}</div>`,
          );
          const $actions = $("<div>", { class: "workspace-item-actions mt-1" });
          $actions.append(
            $("<button>", {
              class: "btn btn-sm btn-outline-info me-1 btn-view-workspace-item",
              title: "View Content",
            }).html('<i class="fas fa-eye fa-xs"></i> Show'),
          );
          $actions.append(
            $("<button>", {
              class:
                "btn btn-sm btn-outline-primary me-1 btn-stage-this-workspace-item",
              title: "Stage for Active Context",
            }).html('<i class="fas fa-arrow-right fa-xs"></i> Stage'),
          );
          $actions.append(
            $("<button>", {
              class:
                "btn btn-sm btn-outline-secondary me-1 btn-add-to-workbench",
              title: "Add to Prompt Workbench",
            }).html('<i class="fas fa-file-import fa-xs"></i> To Workbench'),
          );
          $actions.append(
            $("<button>", {
              class: "btn btn-sm btn-outline-danger btn-remove-workspace-item",
              title: "Remove Item",
            }).html('<i class="fas fa-trash-alt fa-xs"></i> Remove'),
          );
          $itemDiv.append($actions);
          $itemList.append($itemDiv);
        });
      } else {
        $itemList.append(
          '<p class="text-muted p-2">No workspace items found for this session.</p>',
        );
      }
    },
    error: function () {
      $("#workspace-items-list").html(
        '<p class="text-danger small p-2">Error loading workspace items.</p>',
      );
    },
  });
}

/**
 * **MODIFIED**: Renders the staged context items in the UI, now with visual indicators for inclusion status.
 * @param {Set<string>} [includedItemIds=new Set()] A Set containing the IDs of items confirmed to be in the final context.
 */
function renderStagedContextItems(includedItemIds = new Set()) {
  const $list = $("#active-context-spec-list").empty();
  if (window.stagedContextItems.length === 0) {
    $list.append(
      '<p class="text-muted p-2">No items staged for active context.</p>',
    );
    return;
  }

  window.stagedContextItems.forEach(function (item) {
    const idToCheck =
      item.type === "message_history" || item.type === "workspace_item"
        ? item.id_ref
        : item.spec_item_id;
    const isIncluded = includedItemIds.has(idToCheck);
    const droppedClass =
      window.stagedContextItems.length > 0 && !isIncluded
        ? "staged-item-dropped"
        : "";
    const droppedIcon = !isIncluded
      ? '<i class="fas fa-exclamation-triangle text-warning me-2" title="This item was not included in the final prompt, likely due to token limits."></i>'
      : "";

    const $itemDiv = $("<div>", {
      class: `staged-context-item ${droppedClass}`,
      "data-staged-item-spec-id": item.spec_item_id,
    });

    let itemTypeDisplay = item.type
      .replace(/_/g, " ")
      .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
    $itemDiv.append(
      `<div class="staged-item-header">${droppedIcon}${escapeHtml(itemTypeDisplay)}</div>`,
    );

    let sourceDisplay = "N/A";
    if (item.type === "workspace_item" || item.type === "message_history") {
      sourceDisplay = `Ref: ${item.id_ref || "Unknown"}`;
    } else if (item.type === "file_content" && item.path) {
      sourceDisplay = `File: ${item.path.split(/[\\/]/).pop()}`;
    } else if (item.type === "text_content") {
      sourceDisplay = "Direct Text";
    }
    $itemDiv.append(
      `<div class="small text-muted">${escapeHtml(sourceDisplay)}</div>`,
    );

    const contentPreview = item.content
      ? item.content.substring(0, 70) + (item.content.length > 70 ? "..." : "")
      : item.path || "No preview";
    $itemDiv.append(
      `<div class="staged-item-content-preview">${escapeHtml(contentPreview.replace(/\n/g, " "))}</div>`,
    );

    const $actions = $("<div>", { class: "staged-item-actions mt-1" });
    if (item.type === "text_content") {
      $actions.append(
        $("<button>", {
          class: "btn btn-sm btn-outline-warning me-1 btn-edit-staged-item",
          title: "Edit Staged Item",
          "data-staged-item-spec-id": item.spec_item_id,
        }).html('<i class="fas fa-edit fa-xs"></i>'),
      );
    }
    $actions.append(
      $("<button>", {
        class: "btn btn-sm btn-outline-danger btn-remove-staged-item",
        title: "Remove from Staged",
        "data-staged-item-spec-id": item.spec_item_id,
      }).html('<i class="fas fa-times-circle fa-xs"></i>'),
    );
    $itemDiv.append($actions);
    $list.append($itemDiv);
  });
  console.log(
    "CTX_WORKSPACE_UI: Staged context items rendered with inclusion status.",
  );
}

/**
 * Adds an item to the global `stagedContextItems` array and re-renders the list.
 */
function addStagedContextItem(
  type,
  id_ref,
  content,
  path,
  no_truncate = false,
) {
  const spec_item_id = `actx_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  window.stagedContextItems.push({
    spec_item_id,
    type,
    id_ref,
    content,
    path,
    no_truncate,
  });
  updateFullContextPreview();
  console.log(
    "CTX_WORKSPACE_UI: Added to staged items:",
    window.stagedContextItems[window.stagedContextItems.length - 1],
  );
}

/**
 * Removes an item from the global `stagedContextItems` array and re-renders.
 */
function removeStagedContextItem(spec_item_id_to_remove) {
  window.stagedContextItems = window.stagedContextItems.filter(
    (item) => item.spec_item_id !== spec_item_id_to_remove,
  );
  updateFullContextPreview();
  console.log(
    `CTX_WORKSPACE_UI: Removed staged item ${spec_item_id_to_remove}.`,
  );
}

/**
 * Initializes event listeners for the Workspace & Staging UI.
 */
function initWorkspaceEventListeners() {
  $("#workspace-items-list").on("click", ".btn-add-to-workbench", function () {
    const $itemDiv = $(this).closest(".workspace-item");
    const itemId = $itemDiv.data("item-id");
    if (!itemId || !window.currentLlmSessionId) return;

    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
      type: "GET",
      dataType: "json",
      success: function (item) {
        const currentWorkbenchContent = $("#prompt-workbench-textarea").val();
        const newContent =
          (currentWorkbenchContent ? currentWorkbenchContent + "\n\n" : "") +
          item.content;
        $("#prompt-workbench-textarea").val(newContent).trigger("input"); // Trigger token update
        showToast(
          "Added to Workbench",
          `Content from item ${itemId} has been added.`,
          "success",
        );
        if (!$("#context-mode-toggle").is(":checked")) {
          $("#context-mode-toggle").prop("checked", true).trigger("change");
        }
      },
      error: function () {
        showToast(
          "Error",
          "Could not fetch item content to add to workbench.",
          "danger",
        );
      },
    });
  });

  $("#form-add-text-snippet").on("submit", function (e) {
    e.preventDefault();
    const content = $("#text-snippet-content").val().trim();
    const customId = $("#text-snippet-id").val().trim() || null;
    if (!content || !window.currentLlmSessionId) {
      showToast("Error", "Content and active session are required.", "danger");
      return;
    }
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_text`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ content: content, item_id: customId }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          `Text snippet added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-text-snippet")[0].reset();
        fetchAndDisplayWorkspaceItems();
        updateFullContextPreview();
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to add text snippet.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#form-add-file-by-path").on("submit", function (e) {
    e.preventDefault();
    const filePath = $("#file-path-input").val().trim();
    const customId = $("#file-item-id").val().trim() || null;
    if (!filePath || !window.currentLlmSessionId) {
      showToast(
        "Error",
        "File path and active session are required.",
        "danger",
      );
      return;
    }
    $.ajax({
      url: `/api/sessions/${window.currentLlmSessionId}/workspace/add_file`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ file_path: filePath, item_id: customId }),
      dataType: "json",
      success: function (response) {
        showToast(
          "Success",
          `File added as item: ${escapeHtml(response.id)}`,
          "success",
        );
        $("#form-add-file-by-path")[0].reset();
        fetchAndDisplayWorkspaceItems();
        updateFullContextPreview();
      },
      error: function (jqXHR) {
        const errorMsg =
          jqXHR.responseJSON?.error || "Failed to add file by path.";
        showToast("Error", errorMsg, "danger");
      },
    });
  });

  $("#workspace-items-list").on(
    "click",
    ".btn-view-workspace-item",
    function () {
      const itemId = $(this).closest(".workspace-item").data("item-id");
      if (!itemId || !window.currentLlmSessionId) return;
      $.ajax({
        url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
        type: "GET",
        dataType: "json",
        success: function (item) {
          $("#modalItemContentDisplay").text(
            item.content || "No content available.",
          );
          $("#viewItemContentModalLabel").text(
            `Content of Item: ${escapeHtml(item.id)} (Type: ${escapeHtml(item.type)})`,
          );
          var myModal = new bootstrap.Modal(
            document.getElementById("viewItemContentModal"),
          );
          myModal.show();
        },
        error: function () {
          showToast("Error", "Error fetching item content.", "danger");
        },
      });
    },
  );

  $("#workspace-items-list").on(
    "click",
    ".btn-remove-workspace-item",
    function () {
      const itemId = $(this).closest(".workspace-item").data("item-id");
      if (!itemId || !window.currentLlmSessionId) return;
      showToast(
        "Confirm",
        `Remove workspace item ${itemId}?`,
        "warning",
        true,
        function (confirmed) {
          if (confirmed) {
            $.ajax({
              url: `/api/sessions/${window.currentLlmSessionId}/workspace/items/${itemId}`,
              type: "DELETE",
              dataType: "json",
              success: function (response) {
                showToast(
                  "Success",
                  response.message || "Item removed.",
                  "success",
                );
                fetchAndDisplayWorkspaceItems();
                window.stagedContextItems = window.stagedContextItems.filter(
                  (si) =>
                    !(si.type === "workspace_item" && si.id_ref === itemId),
                );
                renderStagedContextItems(new Set());
                updateFullContextPreview();
              },
              error: function () {
                showToast("Error", "Error removing item.", "danger");
              },
            });
          }
        },
      );
    },
  );

  $("#workspace-items-list").on(
    "click",
    ".btn-stage-this-workspace-item",
    function () {
      const $itemDiv = $(this).closest(".workspace-item");
      const itemId = $itemDiv.data("item-id");
      const contentPreview =
        $itemDiv.data("item-content-preview") ||
        "Content not available for preview.";
      addStagedContextItem("workspace_item", itemId, contentPreview, null);
      showToast(
        "Staged",
        `Workspace item ${itemId} added to active context.`,
        "info",
      );
    },
  );

  $(
    "#btn-stage-from-workspace, #btn-stage-from-history, #btn-stage-new-file, #btn-stage-new-text",
  ).on("click", function () {
    const actionId = $(this).attr("id");
    if (actionId === "btn-stage-new-file") {
      const filePath = prompt("Enter server path to file to stage:");
      if (filePath && filePath.trim() !== "") {
        addStagedContextItem("file_content", null, null, filePath.trim());
        showToast(
          "Staged",
          `File ${filePath} added to active context.`,
          "info",
        );
      }
    } else if (actionId === "btn-stage-new-text") {
      const textContent = prompt("Enter text content to stage:");
      if (textContent && textContent.trim() !== "") {
        addStagedContextItem("text_content", null, textContent.trim(), null);
        showToast("Staged", `Text snippet added to active context.`, "info");
      }
    } else {
      showToast(
        "Info",
        "This staging method is not fully implemented yet.",
        "info",
      );
    }
  });

  $("#active-context-spec-list").on(
    "click",
    ".btn-remove-staged-item",
    function () {
      const specItemId = $(this).data("staged-item-spec-id");
      removeStagedContextItem(specItemId);
      showToast(
        "Removed",
        `Item ${specItemId} removed from active context.`,
        "info",
      );
    },
  );

  $("#active-context-spec-list").on(
    "click",
    ".btn-edit-staged-item",
    function () {
      const specItemId = $(this).data("staged-item-spec-id");
      const item = window.stagedContextItems.find(
        (i) => i.spec_item_id === specItemId,
      );
      if (item && item.type === "text_content") {
        const newContent = prompt("Edit staged text content:", item.content);
        if (newContent !== null) {
          item.content = newContent;
          renderStagedContextItems(new Set());
          updateFullContextPreview();
          showToast("Updated", `Staged item ${specItemId} updated.`, "info");
        }
      } else {
        showToast(
          "Warning",
          "Can only edit staged text items directly.",
          "warning",
        );
      }
    },
  );

  console.log("Context Workspace UI event listeners initialized.");
}
