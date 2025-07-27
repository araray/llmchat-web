/**
 * @file ingestion_ui.js
 * @description Handles UI logic for the data ingestion modal, including form submissions
 * and task delegation to the unified TaskMonitor service.
 *
 * REFACTORED: Now delegates task monitoring to TaskMonitor instead of local polling.
 *
 * Depends on utils.js for helper functions (escapeHtml, showToast) and
 * rag_ui.js for fetchAndPopulateRagCollections.
 */

/**
 * Handles the submission of ingestion forms using the new async task-based approach.
 * Uses fetch to submit the task and then delegates monitoring to TaskMonitor.
 * @param {string} ingestType - The type of ingestion ('file', 'dir_zip', 'git').
 * @param {FormData} formData - The form data to submit.
 */
async function handleIngestionFormSubmit(ingestType, formData) {
  const $resultMsg = $("#ingestion-result-message");
  const $progressBar = $("#ingestion-progress-bar");
  const $progressContainer = $("#ingestion-progress-container");

  $resultMsg
    .removeClass("text-success text-danger")
    .addClass("text-muted")
    .text("Submitting ingestion request...");
  $progressContainer.show();
  $progressBar
    .css("width", "10%")
    .removeClass("bg-success bg-danger")
    .attr("aria-valuenow", 10)
    .text("Starting...");

  try {
    // Submit the ingestion task
    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
      // No 'Content-Type' header for FormData, browser sets it with boundary
    });

    if (!response.ok) {
      let errorText = `Server error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorText;
      } catch (e) {
        /* Ignore if response is not JSON */
      }
      throw new Error(errorText);
    }

    const responseData = await response.json();
    const taskId = responseData.task_id;

    if (!taskId) {
      throw new Error("No task ID received from server");
    }

    console.log(`INGEST_UI: Received task ID: ${taskId}`);

    // Get collection name for task title
    const collectionName =
      formData.get("collection_name") || "Unknown Collection";

    // Create descriptive task title based on ingestion type
    let taskTitle;
    switch (ingestType) {
      case "file":
        const fileCount = formData.getAll("files[]").length;
        taskTitle = `File Ingestion: ${fileCount} file(s) → ${collectionName}`;
        break;
      case "dir_zip":
        taskTitle = `ZIP Ingestion: Archive → ${collectionName}`;
        break;
      case "git":
        const gitUrl = formData.get("git_url") || "";
        const repoName =
          gitUrl.split("/").pop()?.replace(".git", "") || "Git Repository";
        taskTitle = `Git Ingestion: ${repoName} → ${collectionName}`;
        break;
      default:
        taskTitle = `Data Ingestion → ${collectionName}`;
    }

    // --- REFACTORED: Delegate to TaskMonitor instead of local polling ---
    // **Rationale Block**:
    // Pre-state: Ingestion UI maintained its own polling loop via pollTaskStatus()
    // Limitation: Duplicate polling logic across multiple UI modules, inefficient resource usage
    // Decision Path: Centralize all task monitoring in TaskMonitor service for consistency
    // Post-state: TaskMonitor handles all polling, ingestion UI shows confirmation and redirects user

    if (typeof TaskMonitor !== "undefined" && TaskMonitor.addTask) {
      TaskMonitor.addTask({
        task_id: taskId,
        title: taskTitle,
        type: "Ingestion",
        status: "submitted",
        metadata: {
          ingest_type: ingestType,
          collection_name: collectionName,
          source:
            ingestType === "git"
              ? formData.get("git_url")
              : `${ingestType} upload`,
        },
      });

      // Update UI to show task was submitted and redirect user
      $progressBar
        .css("width", "100%")
        .addClass("bg-success")
        .text("Submitted!");
      $resultMsg.removeClass("text-muted text-danger").addClass("text-success")
        .html(`
          <strong>Task submitted successfully!</strong><br>
          <small>Task ID: ${escapeHtml(taskId)}</small><br>
          <em>Monitor progress in the Activity tab →</em>
        `);

      // Show toast notification
      if (typeof showToast === "function") {
        showToast(
          "Ingestion Started",
          `${taskTitle} - Monitor in Activity tab`,
          "success",
        );
      }

      // Auto-hide progress after a few seconds
      setTimeout(() => {
        $progressContainer.fadeOut();
        // Close modal if still open
        const modal = bootstrap.Modal.getInstance(
          document.getElementById("ingestionModal"),
        );
        if (modal) {
          modal.hide();
        }
      }, 3000);
    } else {
      // Fallback if TaskMonitor is not available - should not happen in normal operation
      console.warn(
        "INGEST_UI: TaskMonitor not available, falling back to basic confirmation",
      );
      $progressBar
        .css("width", "100%")
        .addClass("bg-warning")
        .text("Submitted");
      $resultMsg.removeClass("text-muted text-danger").addClass("text-warning")
        .html(`
          <strong>Task submitted!</strong><br>
          <small>Task ID: ${escapeHtml(taskId)}</small><br>
          <em>Status tracking not available - check manually</em>
        `);
    }

    // Refresh RAG collections if available
    if (typeof fetchAndPopulateRagCollections === "function") {
      // Delay refresh to allow backend to process
      setTimeout(fetchAndPopulateRagCollections, 2000);
    }
  } catch (error) {
    console.error(`INGEST_UI: Ingestion error (Type: ${ingestType}):`, error);
    $progressBar.css("width", "100%").addClass("bg-danger").text("Failed!");
    $resultMsg
      .removeClass("text-muted text-success")
      .addClass("text-danger")
      .html(
        `<strong>Error!</strong> Failed to submit ingestion task: ${escapeHtml(error.message)}`,
      );
    setTimeout(() => $progressContainer.fadeOut(), 5000);
  }
}

/**
 * Initializes event listeners for data ingestion controls.
 */
function initIngestionEventListeners() {
  $("#btn-ingest-data").on("click", function () {
    var ingestionModal = new bootstrap.Modal(
      document.getElementById("ingestionModal"),
    );
    // Reset forms and messages within the modal
    $("#form-ingest-file")[0].reset();
    $("#form-ingest-dir")[0].reset();
    $("#form-ingest-git")[0].reset();
    $("#ingestion-result-message")
      .empty()
      .addClass("text-muted")
      .text("Ingestion progress will appear here...");
    $("#ingestion-progress-bar")
      .css("width", "0%")
      .attr("aria-valuenow", 0)
      .text("");
    $("#ingestion-progress-container").hide();
    ingestionModal.show();
  });

  $("#form-ingest-file").on("submit", function (e) {
    e.preventDefault();
    const files = $("#ingest-file-input")[0].files;
    const collectionName = $("#ingest-file-collection").val().trim();
    if (!files.length || !collectionName) {
      showToast(
        "Error",
        "Please select file(s) and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "file");
    formData.append("collection_name", collectionName);
    for (let i = 0; i < files.length; i++) {
      formData.append("files[]", files[i]);
    }
    handleIngestionFormSubmit("file", formData);
  });

  $("#form-ingest-dir").on("submit", function (e) {
    e.preventDefault();
    const zipFile = $("#ingest-dir-zip-input")[0].files[0];
    const collectionName = $("#ingest-dir-collection").val().trim();
    const repoName = $("#ingest-dir-repo-name").val().trim() || null;
    if (!zipFile || !collectionName) {
      showToast(
        "Error",
        "Please select a ZIP file and specify a target collection name.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "dir_zip");
    formData.append("collection_name", collectionName);
    formData.append("zip_file", zipFile);
    if (repoName) formData.append("repo_name", repoName);
    handleIngestionFormSubmit("dir_zip", formData);
  });

  $("#form-ingest-git").on("submit", function (e) {
    e.preventDefault();
    const gitUrl = $("#ingest-git-url").val().trim();
    const collectionName = $("#ingest-git-collection").val().trim();
    const repoName = $("#ingest-git-repo-name").val().trim();
    const gitRef = $("#ingest-git-ref").val().trim() || null;
    if (!gitUrl || !collectionName || !repoName) {
      showToast(
        "Error",
        "Please provide Git URL, Target Collection, and Repository Identifier.",
        "danger",
      );
      return;
    }
    const formData = new FormData();
    formData.append("ingest_type", "git");
    formData.append("git_url", gitUrl);
    formData.append("collection_name", collectionName);
    formData.append("repo_name", repoName);
    if (gitRef) formData.append("git_ref", gitRef);
    handleIngestionFormSubmit("git", formData);
  });

  console.log(
    "INGEST_UI: Ingestion UI event listeners initialized with TaskMonitor delegation.",
  );
}
