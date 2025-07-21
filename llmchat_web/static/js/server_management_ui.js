// llmchat_web/static/js/server_management_ui.js

/**
 * @file server_management_ui.js
 * @description Handles UI logic for server management features in the Settings tab.
 * This includes displaying server status, and providing controls to start the
 * daemon or shut down the development server.
 * Depends on utils.js for helper functions (escapeHtml, showToast).
 */

/**
 * Fetches the server's status and updates the UI accordingly.
 * This function determines if the server is a development server and shows
 * relevant controls. It's called when the settings tab is displayed.
 */
function fetchAndDisplayServerStatus() {
  console.log("SERVER_UI: Fetching server status...");
  const $statusDiv = $("#server-management-status");
  const $controlsDiv = $("#server-management-controls");

  $statusDiv.html('<p class="small text-muted">Loading server status...</p>');
  $controlsDiv.empty();

  $.ajax({
    url: "/api/server/status",
    type: "GET",
    dataType: "json",
    success: function (status) {
      console.log("SERVER_UI: Server status received:", status);
      let statusHtml = `
                <p class="small mb-1">
                    <strong>Type:</strong> ${escapeHtml(status.server_software)}
                </p>`;

      if (status.is_development_server) {
        statusHtml += `
                    <p class="small text-warning mb-1">
                        <i class="fas fa-exclamation-triangle"></i> Running in foreground (Development Mode)
                    </p>`;
        $controlsDiv.html(`
                    <button id="btn-promote-to-daemon" class="btn btn-sm btn-info me-2">
                        <i class="fas fa-rocket"></i> Promote to Daemon
                    </button>
                    <button id="btn-shutdown-server" class="btn btn-sm btn-danger">
                        <i class="fas fa-power-off"></i> Shutdown This Server
                    </button>
                `);
      } else {
        statusHtml += `
                    <p class="small text-success mb-1">
                        <i class="fas fa-check-circle"></i> Running as a production server (likely a daemon).
                    </p>`;
        $controlsDiv.html(`
                    <p class="small text-muted">Manage the server daemon from the command line using 'llmchat web stop' or 'llmchat web restart'.</p>
                `);
      }
      $statusDiv.html(statusHtml);
    },
    error: function () {
      console.error("SERVER_UI: Failed to fetch server status.");
      $statusDiv.html(
        '<p class="small text-danger">Could not fetch server status.</p>',
      );
    },
  });
}

/**
 * Handles the logic for the "Promote to Daemon" button click event.
 * It shows a confirmation modal, and if confirmed, calls the API to start the
 * daemon process, followed by a countdown to shut down the current server.
 */
function handlePromoteToDaemon() {
  showToast(
    "Confirm Action",
    "This will launch a new background server and then shut down this temporary server. You will be disconnected. Continue?",
    "warning",
    true, // needsConfirmation
    function (confirmed) {
      if (confirmed) {
        console.log("SERVER_UI: User confirmed daemon promotion.");
        showToast("Info", "Issuing daemon start command...", "info");

        $.ajax({
          url: "/api/server/daemon/start",
          type: "POST",
          dataType: "json",
          success: function (response) {
            showToast(
              "Success",
              response.message || "Daemon start command sent.",
              "success",
            );

            // Countdown before shutting down this server
            let countdown = 5;
            const countdownToast = setInterval(function () {
              showToast(
                "Shutdown",
                `This server will shut down in ${countdown}...`,
                "info",
              );
              countdown--;
              if (countdown < 0) {
                clearInterval(countdownToast);
                handleShutdownServer(true); // isFromDaemonPromotion = true
              }
            }, 1000);
          },
          error: function (jqXHR) {
            const errorMsg =
              jqXHR.responseJSON?.error ||
              "Failed to issue daemon start command.";
            showToast("Error", errorMsg, "danger");
          },
        });
      } else {
        console.log("SERVER_UI: User cancelled daemon promotion.");
      }
    },
  );
}

/**
 * Handles the logic for the "Shutdown Server" button click event.
 * @param {boolean} [isFromDaemonPromotion=false] - If true, the shutdown is
 * triggered automatically after a daemon promotion and shows a different message.
 * If false, it shows a confirmation prompt first.
 */
function handleShutdownServer(isFromDaemonPromotion = false) {
  console.log("SERVER_UI: Initiating server shutdown.");
  if (isFromDaemonPromotion) {
    showToast(
      "Shutdown",
      "Shutting down temporary server. Please refresh your browser in a few moments.",
      "info",
    );
  } else {
    showToast(
      "Confirm Action",
      "Are you sure you want to shut down this server process?",
      "warning",
      true,
      function (confirmed) {
        if (!confirmed) return;
        $.post("/api/server/shutdown")
          .done(function (response) {
            showToast(
              "Shutdown",
              response.message || "Server is shutting down...",
              "info",
            );
            // The page will become unresponsive as the server dies.
            $("body").html(
              '<h3 class="text-center p-5">Server has been shut down. You can close this window.</h3>',
            );
          })
          .fail(function () {
            showToast("Error", "Failed to send shutdown command.", "danger");
          });
      },
    );
  }

  if (isFromDaemonPromotion) {
    $.post("/api/server/shutdown").done(function (response) {
      $("body").html(
        '<h3 class="text-center p-5">Daemon started. This temporary server has been shut down. Please refresh the page to connect to the new server.</h3>',
      );
    });
  }
}

/**
 * Initializes all event listeners for the server management UI.
 * This includes binding click handlers and refreshing the status when the
 * settings tab is shown.
 */
function initServerManagementEventListeners() {
  // Event delegation for buttons inside the dynamically loaded controls div
  $("#server-management-controls").on(
    "click",
    "#btn-promote-to-daemon",
    handlePromoteToDaemon,
  );
  $("#server-management-controls").on(
    "click",
    "#btn-shutdown-server",
    function () {
      handleShutdownServer(false);
    },
  );

  // When the settings tab is shown, refresh the server status
  $("#settings-tab-btn").on("shown.bs.tab", function () {
    console.log("SERVER_UI: Settings tab shown, fetching server status.");
    fetchAndDisplayServerStatus();
  });

  console.log("Server Management UI event listeners initialized.");
}
