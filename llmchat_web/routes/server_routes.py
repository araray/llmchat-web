# llmchat_web/routes/server_routes.py
"""
Flask routes for managing the web server process itself.

Provides endpoints for starting the daemon and shutting down the current server instance.
"""
import logging
import os
import signal
import subprocess
import sys
import time
from typing import Any

from flask import Blueprint, Response, jsonify

from ..app import logger as app_logger

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.server")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)

server_bp = Blueprint('server_bp', __name__, url_prefix='/api/server')


def _is_development_server() -> bool:
    """
    Checks if the server is the Flask development server (Werkzeug).

    Returns:
        True if the server software environment variable starts with 'werkzeug',
        False otherwise.
    """
    server_software = os.environ.get('SERVER_SOFTWARE', '').lower()
    return server_software.startswith('werkzeug')


@server_bp.route("/status", methods=["GET"])
def get_server_status() -> Response:
    """
    Returns the current server's status, including its software type.

    Returns:
        A JSON response containing the server software, a boolean indicating
        if it's a development server, and whether daemon management is permitted.
    """
    is_dev = _is_development_server()
    status_payload = {
        "server_software": os.environ.get('SERVER_SOFTWARE', 'Unknown'),
        "is_development_server": is_dev,
        "can_manage_daemon": is_dev  # Only allow daemon management from the dev server
    }
    return jsonify(status_payload)


@server_bp.route("/daemon/start", methods=["POST"])
def start_daemon_route() -> Response:
    """
    Attempts to start the llmchat-web server as a daemon using the 'llmchat' CLI.

    This endpoint should only be called from a development server. It launches a
    new, detached process to run 'llmchat web start'.

    Returns:
        A JSON response indicating success or failure. On success, returns a 202
        'Accepted' status code with the PID of the newly launched process.
    """
    if not _is_development_server():
        logger.warning("Attempted to start daemon from a non-development server. Denied.")
        return jsonify({"error": "Daemon can only be started from the development server."}), 403

    try:
        # Command to start the daemon. We assume 'llmchat' is in the PATH.
        command = ["llmchat", "web", "start"]
        logger.info(f"Executing daemon start command: {' '.join(command)}")

        # Use Popen to launch in a new session, completely detached from this process.
        # This is crucial for the daemon to outlive the current server process.
        if sys.platform != "win32":
            proc = subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            # `start_new_session` is not available on Windows.
            # `CREATE_NEW_PROCESS_GROUP` is a rough equivalent.
            DETACHED_PROCESS = 0x00000008
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            proc = subprocess.Popen(command, creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        logger.info(f"Daemon process launched with PID: {proc.pid}")
        return jsonify({"message": "Daemon start command issued successfully.", "pid": proc.pid}), 202
    except FileNotFoundError:
        logger.error("'llmchat' command not found. Cannot start daemon.")
        return jsonify({"error": "'llmchat' command not found in PATH. Ensure llmchat is installed correctly."}), 500
    except Exception as e:
        logger.error(f"Failed to start daemon process: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred while starting the daemon: {str(e)}"}), 500


@server_bp.route("/shutdown", methods=["POST"])
def shutdown_server_route() -> Response:
    """
    Shuts down the current server process.

    This is intended for use with the development server to allow the UI to
    terminate the temporary server after launching the daemon.

    Returns:
        A JSON response confirming that the shutdown command has been received.
    """
    if not _is_development_server():
        logger.warning("Attempted to shut down a non-development server. Denied.")
        return jsonify({"error": "This shutdown mechanism is intended for the development server only."}), 403

    logger.info("Shutdown requested. Server will now terminate.")

    def kill_server():
        """
        Sends a SIGTERM signal to the current process after a short delay.
        The delay allows the HTTP response to be sent before termination.
        """
        # Delay to allow the HTTP response to be sent
        time.sleep(1)
        os.kill(os.getpid(), signal.SIGTERM)

    # Run the kill process in a separate thread so it doesn't block the response.
    import threading
    threading.Thread(target=kill_server).start()

    return jsonify({"message": "Server is shutting down..."})


logger.info("Server management routes defined on server_bp.")
