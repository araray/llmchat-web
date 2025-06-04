// llmchat_web/static/js/rag_ui.js

/**
 * @file rag_ui.js
 * @description Handles RAG (Retrieval Augmented Generation) UI controls,
 * API calls for RAG settings, collections, direct search, and rendering results.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses global variables from custom.js (currentRagSettings).
 */

/**
 * Fetches available RAG collections and populates the dropdown.
 * Relies on global `currentRagSettings` to set the selected value.
 * Uses global `escapeHtml`.
 */
function fetchAndPopulateRagCollections() {
  console.log("RAG_UI: Fetching RAG collections...");
  $.ajax({
    url: "/api/rag/collections",
    type: "GET",
    dataType: "json",
    success: function (collections) {
      const $select = $("#rag-collection-select");
      $select
        .empty()
        .append('<option selected value="">Select Collection...</option>');
      if (collections && collections.length > 0) {
        collections.forEach(function (collection) {
          const collectionName =
            typeof collection === "string" ? collection : collection.name;
          const collectionId =
            typeof collection === "string" ? collection : collection.id;
          $select.append(
            $("<option>", {
              value: collectionId,
              text: escapeHtml(collectionName), // escapeHtml from utils.js
            }),
          );
        });
        if (currentRagSettings.collectionName) {
          // currentRagSettings from custom.js
          $select.val(currentRagSettings.collectionName);
        }
      } else {
        $select.append(
          '<option value="" disabled>No collections found</option>',
        );
      }
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Error fetching RAG collections:",
        textStatus,
        errorThrown,
      );
      $("#rag-collection-select")
        .empty()
        .append('<option value="" disabled>Error loading collections</option>');
    },
  });
}

/**
 * Updates the state of RAG controls in the UI based on global `currentRagSettings`.
 * Uses global `escapeHtml`.
 */
function updateRagControlsState() {
  $("#rag-toggle-switch").prop("checked", currentRagSettings.enabled); // currentRagSettings from custom.js
  const controlsShouldBeDisabled = !currentRagSettings.enabled;
  $("#rag-collection-select").prop("disabled", controlsShouldBeDisabled);
  $("#rag-k-value")
    .prop("disabled", controlsShouldBeDisabled)
    .val(currentRagSettings.kValue || 3);
  $("#rag-filter-input")
    .prop("disabled", controlsShouldBeDisabled)
    .val(
      currentRagSettings.filter &&
        Object.keys(currentRagSettings.filter).length > 0
        ? JSON.stringify(currentRagSettings.filter)
        : "",
    );

  const $ragStatusEl = $("#status-rag");
  if (currentRagSettings.enabled) {
    let statusText = `ON (${escapeHtml(currentRagSettings.collectionName) || "Default"}, K:${currentRagSettings.kValue || "Def"})`; // escapeHtml from utils.js
    if (
      currentRagSettings.filter &&
      Object.keys(currentRagSettings.filter).length > 0
    ) {
      statusText += " Filter*";
    }
    $ragStatusEl
      .text(statusText)
      .removeClass("bg-danger")
      .addClass("bg-success");
  } else {
    $ragStatusEl.text("OFF").removeClass("bg-success").addClass("bg-danger");
  }
  console.log("RAG_UI: RAG controls state updated.");
}

/**
 * Sends updated RAG settings (from global `currentRagSettings`) to the backend.
 * Uses global `showToast`.
 */
function sendRagSettingsUpdate() {
  console.log(
    "RAG_UI: Sending RAG settings update to backend:",
    currentRagSettings,
  ); // currentRagSettings from custom.js
  let filterToSend = currentRagSettings.filter;
  if (typeof filterToSend === "string" && filterToSend.trim() === "") {
    filterToSend = null;
  }

  const payload = {
    enabled: currentRagSettings.enabled,
    collectionName: currentRagSettings.collectionName,
    kValue: currentRagSettings.kValue,
    filter: filterToSend,
  };

  $.ajax({
    url: "/api/settings/rag/update", // Note: This URL is under /api/settings, might be better under /api/rag
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (response) {
      console.log(
        "RAG_UI: RAG settings updated successfully on backend:",
        response,
      );
      if (response && response.rag_settings) {
        // Update the global currentRagSettings in custom.js
        // This requires currentRagSettings to be mutable from here or use a setter.
        // For now, assuming direct modification of the global object.
        window.currentRagSettings = response.rag_settings; // Explicitly use window to clarify global modification
        // Ensure filter is stored as an object or null locally
        if (typeof window.currentRagSettings.filter === "string") {
          try {
            window.currentRagSettings.filter = JSON.parse(
              window.currentRagSettings.filter,
            );
          } catch (e) {
            console.warn(
              "RAG_UI: Could not parse filter string from backend, setting to null",
              e,
            );
            window.currentRagSettings.filter = null;
          }
        }
      }
      updateRagControlsState(); // Re-render controls based on (potentially updated) global state
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Error updating RAG settings on backend:",
        textStatus,
        errorThrown,
      );
      showToast(
        // showToast from utils.js
        "Error",
        "Failed to update RAG settings on the server.",
        "danger",
      );
    },
  });
}

/**
 * Renders the results of a Direct RAG Search into the modal.
 * Uses global `escapeHtml`.
 * @param {Array} results - Array of document objects from the backend.
 */
function renderDirectRagSearchResults(results) {
  const $modalBody = $("#directRagSearchResultsBody").empty();
  if (!results || results.length === 0) {
    $modalBody.append(
      '<p class="text-muted">No results found for your query.</p>',
    );
    return;
  }

  const $listGroup = $('<ul class="list-group list-group-flush"></ul>');
  results.forEach(function (doc) {
    const scoreDisplay =
      doc.score !== null && doc.score !== undefined
        ? `<strong>Score:</strong> ${doc.score.toFixed(4)}`
        : "Score: N/A";
    const metadataDisplay = doc.metadata
      ? `<small class="text-muted d-block">Metadata: ${escapeHtml(JSON.stringify(doc.metadata).substring(0, 100))}...</small>` // escapeHtml from utils.js
      : "";
    const contentPreview = doc.content
      ? `<pre>${escapeHtml(doc.content.substring(0, 250))}${doc.content.length > 250 ? "..." : ""}</pre>` // escapeHtml from utils.js
      : '<p class="text-muted small">No content preview.</p>';

    const $listItem = $(`
            <li class="list-group-item">
                <div><strong>ID:</strong> ${escapeHtml(doc.id)}</div>
                <div>${scoreDisplay}</div>
                ${metadataDisplay}
                <div class="mt-1">Content Preview:</div>
                ${contentPreview}
            </li>
        `);
    $listGroup.append($listItem);
  });
  $modalBody.append($listGroup);
  console.log("RAG_UI: Direct RAG search results rendered.");
}

/**
 * Handles the submission of the Direct RAG Search form.
 * Relies on global `currentRagSettings`, `showToast`, `escapeHtml`.
 * Calls `renderDirectRagSearchResults`.
 */
function handleDirectRagSearch() {
  const query = $("#direct-rag-search-query").val().trim();
  if (!query) {
    showToast(
      // showToast from utils.js
      "Error",
      "Please enter a search query for Direct RAG Search.",
      "danger",
    );
    return;
  }
  // Use global currentRagSettings from custom.js
  const payload = {
    query: query,
    collection_name: currentRagSettings.collectionName,
    k: currentRagSettings.kValue,
    filter: currentRagSettings.filter,
  };

  console.log("RAG_UI: Performing Direct RAG Search with payload:", payload);
  $("#directRagSearchResultsBody").html(
    '<p class="text-muted">Searching...</p>',
  );
  var searchModal = new bootstrap.Modal(
    document.getElementById("directRagSearchResultsModal"),
  );
  searchModal.show();

  $.ajax({
    url: "/api/rag/direct_search",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    dataType: "json",
    success: function (results) {
      console.log("RAG_UI: Direct RAG Search results:", results);
      renderDirectRagSearchResults(results);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Direct RAG Search error:",
        textStatus,
        errorThrown,
      );
      const errorMsg = jqXHR.responseJSON
        ? jqXHR.responseJSON.error
        : "Failed to perform RAG search.";
      $("#directRagSearchResultsBody").html(
        `<p class="text-danger">Error: ${escapeHtml(errorMsg)}</p>`, // escapeHtml from utils.js
      );
      showToast("Error", `Direct RAG Search failed: ${errorMsg}`, "danger"); // showToast from utils.js
    },
  });
}

/**
 * Initializes event listeners for RAG controls.
 */
function initRagEventListeners() {
  $("#rag-tab-btn").on("shown.bs.tab", function () {
    fetchAndPopulateRagCollections();
    updateRagControlsState();
  });

  $("#rag-toggle-switch").on("change", function () {
    window.currentRagSettings.enabled = $(this).is(":checked"); // Modify global
    sendRagSettingsUpdate();
  });

  $("#rag-collection-select").on("change", function () {
    window.currentRagSettings.collectionName = $(this).val() || null; // Modify global
    sendRagSettingsUpdate();
  });

  $("#rag-k-value").on("change", function () {
    const val = parseInt($(this).val(), 10);
    window.currentRagSettings.kValue = isNaN(val) ? 3 : val; // Modify global
    sendRagSettingsUpdate();
  });

  $("#rag-filter-input").on("change", function () {
    const filterStr = $(this).val().trim();
    if (filterStr === "") {
      window.currentRagSettings.filter = null; // Modify global
    } else {
      try {
        const parsedFilter = JSON.parse(filterStr);
        if (typeof parsedFilter === "object" && parsedFilter !== null) {
          window.currentRagSettings.filter = parsedFilter; // Modify global
        } else {
          showToast(
            // showToast from utils.js
            "Error",
            'Invalid JSON for RAG filter. It must be an object (e.g., {"key": "value"}).',
            "danger",
          );
          $(this).val(
            window.currentRagSettings.filter && // Access global
              Object.keys(window.currentRagSettings.filter).length > 0
              ? JSON.stringify(window.currentRagSettings.filter)
              : "",
          );
          return;
        }
      } catch (e) {
        showToast("Error", "Invalid JSON format for RAG filter.", "danger"); // showToast from utils.js
        $(this).val(
          window.currentRagSettings.filter && // Access global
            Object.keys(window.currentRagSettings.filter).length > 0
            ? JSON.stringify(window.currentRagSettings.filter)
            : "",
        );
        return;
      }
    }
    sendRagSettingsUpdate();
  });

  $("#direct-rag-search-form").on("submit", function (e) {
    e.preventDefault();
    handleDirectRagSearch();
  });
  console.log("RAG UI event listeners initialized.");
}
