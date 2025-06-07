// llmchat_web/static/js/rag_ui.js

/**
 * @file rag_ui.js
 * @description Handles RAG (Retrieval Augmented Generation) UI controls,
 * API calls for RAG settings, collections, direct search, and rendering results.
 * Now includes the function to display RAG results from a chat SSE stream.
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * accesses global variables from main_controller.js (currentRagSettings, currentLlmSessionId).
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
            typeof collection === "string"
              ? collection
              : collection.name || collection.id;
          const collectionValue =
            typeof collection === "string"
              ? collection
              : collection.id || collection.name;
          $select.append(
            $("<option>", {
              value: collectionValue,
              text: escapeHtml(collectionName),
            }),
          );
        });
        if (
          window.currentRagSettings &&
          window.currentRagSettings.collectionName
        ) {
          $select.val(window.currentRagSettings.collectionName);
        } else if (!window.currentRagSettings) {
          console.warn(
            "RAG_UI: window.currentRagSettings is undefined during collection population.",
          );
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
        jqXHR.responseText,
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
  const ragSettings = window.currentRagSettings || {};
  const isEnabled = ragSettings.enabled || false;
  const collectionName = ragSettings.collectionName || null;
  const kValue = ragSettings.kValue || 3;
  const filter = ragSettings.filter || null;

  $("#rag-toggle-switch").prop("checked", isEnabled);
  const controlsShouldBeDisabled = !isEnabled;

  $("#rag-collection-select").prop("disabled", controlsShouldBeDisabled);
  if (collectionName) {
    $("#rag-collection-select").val(collectionName);
  }

  $("#rag-k-value").prop("disabled", controlsShouldBeDisabled).val(kValue);
  $("#rag-filter-input")
    .prop("disabled", controlsShouldBeDisabled)
    .val(
      filter && Object.keys(filter).length > 0 ? JSON.stringify(filter) : "",
    );

  const $ragStatusEl = $("#status-rag");
  if (isEnabled) {
    let statusText = `ON (${escapeHtml(collectionName) || "Default"}, K:${kValue || "Def"})`;
    if (filter && Object.keys(filter).length > 0) {
      statusText += " Filter*";
    }
    $ragStatusEl
      .text(statusText)
      .removeClass("bg-danger")
      .addClass("bg-success");
  } else {
    $ragStatusEl.text("OFF").removeClass("bg-success").addClass("bg-danger");
  }
  console.log("RAG_UI: RAG controls state updated based on:", ragSettings);
}

/**
 * Sends updated RAG settings (from global `currentRagSettings`) to the backend.
 * Uses global `showToast`.
 */
function sendRagSettingsUpdate() {
  const ragSettings = window.currentRagSettings || {};
  console.log("RAG_UI: Sending RAG settings update to backend:", ragSettings);

  let filterToSend = ragSettings.filter;
  if (typeof filterToSend === "string" && filterToSend.trim() === "") {
    filterToSend = null;
  }

  const payload = {
    enabled: ragSettings.enabled || false,
    collectionName: ragSettings.collectionName || null,
    kValue: ragSettings.kValue || 3,
    filter: filterToSend,
  };

  $.ajax({
    url: "/api/rag/settings/update",
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
        if (
          typeof window.currentRagSettings === "undefined" ||
          window.currentRagSettings === null
        ) {
          window.currentRagSettings = {
            enabled: false,
            collectionName: null,
            kValue: 3,
            filter: null,
          };
        }
        window.currentRagSettings.enabled = response.rag_settings.enabled;
        window.currentRagSettings.collectionName =
          response.rag_settings.collection_name;
        window.currentRagSettings.kValue = response.rag_settings.k_value;
        window.currentRagSettings.filter = response.rag_settings.filter;
      }
      updateRagControlsState();
    },
    error: function (jqXHR, textStatus, errorThrown) {
      console.error(
        "RAG_UI: Error updating RAG settings on backend:",
        textStatus,
        errorThrown,
        jqXHR.responseText,
      );
      showToast(
        "Error",
        `Failed to update RAG settings: ${jqXHR.responseJSON ? jqXHR.responseJSON.error : errorThrown}`,
        "danger",
      );
    },
  });
}

/**
 * Renders the results of a Direct RAG Search into the search results modal.
 * @param {Array<Object>} results - Array of document objects from the backend.
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
      ? `<small class="text-muted d-block">Metadata: ${escapeHtml(JSON.stringify(doc.metadata).substring(0, 100))}...</small>`
      : "";
    const contentPreview = doc.content
      ? `<pre>${escapeHtml(doc.content.substring(0, 250))}${doc.content.length > 250 ? "..." : ""}</pre>`
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
 * Renders the RAG documents used for a chat response into the main RAG tab.
 * This is the display function for the RAG Content Inspector.
 * @param {Array<Object>} documents - Array of document objects from the SSE stream.
 */
function displayRetrievedDocuments(documents) {
  const $displayArea = $("#rag-retrieved-docs-display"); // This element will be added to index.html
  $displayArea.empty().removeClass("d-none"); // Clear previous results and ensure it's visible

  if (!documents || documents.length === 0) {
    $displayArea.html(
      '<p class="text-muted small">No documents were retrieved by RAG for the last response.</p>',
    );
    return;
  }

  console.log(`RAG_UI: Displaying ${documents.length} retrieved documents.`);
  const $listGroup = $('<div class="list-group"></div>');
  documents.forEach(function (doc) {
    const scoreDisplay =
      doc.score !== null
        ? `<span class="badge bg-info float-end">Score: ${doc.score.toFixed(3)}</span>`
        : "";
    const metadataDisplay = doc.metadata
      ? `<small class="text-muted d-block">Source: ${escapeHtml(JSON.stringify(doc.metadata.source || doc.id))}</small>`
      : "";
    const contentPreview = doc.content
      ? `<p class="mb-1 small">${escapeHtml(doc.content.substring(0, 300))}...</p>`
      : "";

    const $item = $(`
            <div class="list-group-item list-group-item-action flex-column align-items-start">
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">ID: ${escapeHtml(doc.id)}</h6>
                    ${scoreDisplay}
                </div>
                ${contentPreview}
                ${metadataDisplay}
                <div class="rag-doc-actions mt-2">
                    <button class="btn btn-sm btn-outline-secondary btn-add-rag-doc-to-workspace" data-doc-id="${escapeHtml(doc.id)}" title="Add to Workspace">
                        <i class="fas fa-plus-square"></i> Add to Workspace
                    </button>
                </div>
            </div>
        `);
    $listGroup.append($item);
  });
  $displayArea.append($listGroup);
}

/**
 * Handles the submission of the Direct RAG Search form.
 */
function handleDirectRagSearch() {
  const query = $("#direct-rag-search-query").val().trim();
  if (!query) {
    showToast(
      "Error",
      "Please enter a search query for Direct RAG Search.",
      "danger",
    );
    return;
  }
  const ragSettingsToUse = window.currentRagSettings || {
    collectionName: null,
    kValue: 3,
    filter: null,
  };

  const payload = {
    query: query,
    collection_name: ragSettingsToUse.collectionName,
    k: ragSettingsToUse.kValue,
    filter: ragSettingsToUse.filter,
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
        jqXHR.responseText,
      );
      const errorMsg = jqXHR.responseJSON
        ? jqXHR.responseJSON.error
        : "Failed to perform RAG search.";
      $("#directRagSearchResultsBody").html(
        `<p class="text-danger">Error: ${escapeHtml(errorMsg)}</p>`,
      );
      showToast("Error", `Direct RAG Search failed: ${errorMsg}`, "danger");
    },
  });
}

/**
 * Initializes event listeners for RAG controls.
 */
function initRagEventListeners() {
  $("#rag-tab-main-btn").on("shown.bs.tab", function () {
    // Updated selector for main RAG tab
    fetchAndPopulateRagCollections();
    updateRagControlsState();
  });

  $("#rag-toggle-switch").on("change", function () {
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.enabled = $(this).is(":checked");
    sendRagSettingsUpdate();
  });

  $("#rag-collection-select").on("change", function () {
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.collectionName = $(this).val() || null;
    sendRagSettingsUpdate();
  });

  $("#rag-k-value").on("change", function () {
    const val = parseInt($(this).val(), 10);
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    window.currentRagSettings.kValue = isNaN(val) ? 3 : val;
    sendRagSettingsUpdate();
  });

  $("#rag-filter-input").on("change", function () {
    const filterStr = $(this).val().trim();
    if (
      typeof window.currentRagSettings === "undefined" ||
      window.currentRagSettings === null
    )
      window.currentRagSettings = {};
    if (filterStr === "") {
      window.currentRagSettings.filter = null;
    } else {
      try {
        const parsedFilter = JSON.parse(filterStr);
        if (typeof parsedFilter === "object" && parsedFilter !== null) {
          window.currentRagSettings.filter = parsedFilter;
        } else {
          showToast(
            "Error",
            'Invalid JSON for RAG filter. It must be an object (e.g., {"key": "value"}). Sticking to previous value.',
            "danger",
          );
          $(this).val(
            window.currentRagSettings.filter &&
              Object.keys(window.currentRagSettings.filter).length > 0
              ? JSON.stringify(window.currentRagSettings.filter)
              : "",
          );
          return;
        }
      } catch (e) {
        showToast(
          "Error",
          "Invalid JSON format for RAG filter. Sticking to previous value.",
          "danger",
        );
        $(this).val(
          window.currentRagSettings.filter &&
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

  // Event listener for adding a retrieved RAG doc to the workspace
  $("#rag-pane-main").on("click", ".btn-add-rag-doc-to-workspace", function () {
    const docId = $(this).data("doc-id");
    // Placeholder for now. We need the full document content.
    // This will likely require caching the retrieved docs in a global variable.
    showToast(
      "Info",
      `Action to add RAG doc '${docId}' to workspace is not fully implemented yet.`,
      "info",
    );
    // TODO: Get the full content of the document with this ID (may need to cache results)
    // and then call `llmcore.add_text_context_item`.
  });

  console.log("RAG UI event listeners initialized.");
}
