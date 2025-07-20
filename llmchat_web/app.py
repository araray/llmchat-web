# llmchat_web/app.py
"""
Flask application for the llmchat-web interface.

This is the main Flask application that provides a web interface for
interacting with LLMCore via its HTTP API. The application is now a
self-contained service with its own command-line interface for starting,
stopping, and managing the server process as a daemon.
"""

import asyncio
import logging
import os
import threading
import platform
import sys
import signal
import time
import errno
import subprocess
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Generator, Optional, Tuple, List

import click
from flask import Flask, session as flask_session

from .get_version import get_version
from .routes import all_blueprints

# --- Optional Imports for Server Functionality ---
try:
    import daemon
    import daemon.pidfile
    PYTHON_DAEMON_AVAILABLE = True
except ImportError:
    daemon = None
    PYTHON_DAEMON_AVAILABLE = False

try:
    subprocess.run(["gunicorn", "--version"], capture_output=True, check=False)
    GUNICORN_AVAILABLE = True
except (FileNotFoundError, subprocess.CalledProcessError):
    GUNICORN_AVAILABLE = False


# Application version
APP_VERSION = get_version()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("llmchat_web.app")

# Thread-local storage for event loops
_thread_locals = threading.local()


def get_or_create_event_loop() -> asyncio.AbstractEventLoop:
    """
    Get or create an event loop for the current thread.

    This is needed because Flask runs in multiple threads and each thread
    needs its own event loop for async operations.
    """
    try:
        return asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop


def async_to_sync_in_flask(async_func):
    """
    Decorator to run async functions in Flask route handlers.
    """
    def wrapper(*args, **kwargs):
        loop = get_or_create_event_loop()
        return loop.run_until_complete(async_func(*args, **kwargs))
    return wrapper


def run_async_generator_synchronously(async_gen_func, *args, **kwargs) -> Generator[str, None, None]:
    """
    Convert an async generator to a sync generator for Flask streaming.
    """
    loop = get_or_create_event_loop()

    async def _run_async_gen():
        async for item in async_gen_func(*args, **kwargs):
            yield item

    async_gen = _run_async_gen()

    try:
        while True:
            try:
                item = loop.run_until_complete(async_gen.__anext__())
                yield item
            except StopAsyncIteration:
                break
    finally:
        loop.run_until_complete(async_gen.aclose())


def get_current_web_session_id() -> Optional[str]:
    """
    Get the current LLMCore session ID from Flask session.
    """
    return flask_session.get('current_llm_session_id')


def set_current_web_session_id(session_id: Optional[str]) -> None:
    """
    Set the current LLMCore session ID in Flask session.
    """
    if session_id is None:
        flask_session.pop('current_llm_session_id', None)
    else:
        flask_session['current_llm_session_id'] = session_id


def create_app() -> Flask:
    """
    Create and configure the Flask application.
    """
    app = Flask(__name__)
    app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-key-change-in-production')

    for blueprint in all_blueprints:
        app.register_blueprint(blueprint)
        logger.info(f"Registered blueprint: {blueprint.name}")

    logger.info(f"llmchat-web v{APP_VERSION} Flask application created successfully")
    return app


# Create the Flask application instance
app = create_app()

# ==============================================================================
# SECTION: Standalone Server Management CLI
# Logic ported from llmchat.cli.web_commands
# ==============================================================================

def _get_pid_file_path(pid_file_arg: Optional[str]) -> Path:
    """Determines the absolute path for the PID file."""
    if pid_file_arg:
        return Path(pid_file_arg).resolve()
    # Use appdirs or a similar library for robust config path determination
    try:
        from appdirs import user_config_dir
        config_dir = Path(user_config_dir("llmchat-web", appauthor=False))
    except ImportError:
        config_dir = Path.home() / ".config" / "llmchat-web"
    return config_dir / "llmchat_web.pid"

def _check_pid_running(pid: int) -> bool:
    """Checks if a process with the given PID is running."""
    if pid <= 0: return False
    try:
        os.kill(pid, 0)
    except OSError as err:
        if err.errno == errno.ESRCH: return False
        elif err.errno == errno.EPERM: return True
        raise
    return True

def _get_server_status(pid_file_path: Path) -> Tuple[str, Optional[int]]:
    """Checks server status based on PID file. Returns status message and PID if running."""
    if not pid_file_path.exists():
        return "Server not running (PID file not found).", None
    try:
        with open(pid_file_path, "r") as pf:
            pid_str = pf.read().strip()
            if not pid_str:
                try: pid_file_path.unlink()
                except OSError: pass
                return "Server not running (stale PID file - empty).", None
            pid = int(pid_str)
    except (IOError, ValueError) as e:
        logger.warning(f"Could not read/parse PID from {pid_file_path}: {e}. Assuming stale.")
        try: pid_file_path.unlink()
        except OSError: pass
        return f"Server not running (stale PID file - read error: {e}).", None

    if _check_pid_running(pid):
        return f"Server is running with PID {pid}.", pid
    else:
        logger.info(f"Process with PID {pid} from {pid_file_path} not found. Cleaning up stale PID file.")
        try: pid_file_path.unlink()
        except OSError as e_unlink: logger.warning(f"Could not remove stale PID file {pid_file_path}: {e_unlink}")
        return f"Server not running (stale PID file - process {pid} not found).", None

def start_server_logic(host: str, port: int, flask_debug: bool, wsgi_server_choice: str, gunicorn_workers: int):
    """
    Core logic to start the chosen WSGI server.
    This function is the actual target for daemonization or foreground execution.
    It does NOT initialize LLMCore; it simply runs the Flask app.
    """
    logger.info("start_server_logic: Preparing to start WSGI server.")

    use_gunicorn = False
    if wsgi_server_choice == "gunicorn":
        if GUNICORN_AVAILABLE:
            if flask_debug:
                logger.warning("Flask debug mode is enabled; Gunicorn will not be used despite being chosen.")
                click.echo(click.style("Warning: Flask debug is ON. Using Flask development server instead of Gunicorn.", fg="yellow"))
            else:
                use_gunicorn = True
        else:
            logger.warning("Gunicorn chosen but not available. Falling back to Flask development server.")
            click.echo(click.style("Warning: Gunicorn selected but not found. Falling back to Flask dev server.", fg="yellow"))

    if use_gunicorn:
        logger.info(f"Starting server with Gunicorn. Host: {host}, Port: {port}, Workers: {gunicorn_workers}")
        try:
            from appdirs import user_config_dir
            log_dir = Path(user_config_dir("llmchat-web", appauthor=False)) / "logs"
        except ImportError:
            log_dir = Path.home() / ".config" / "llmchat-web" / "logs"

        log_dir.mkdir(parents=True, exist_ok=True)
        gunicorn_access_log = log_dir / "gunicorn_access.log"
        gunicorn_error_log = log_dir / "gunicorn_error.log"

        gunicorn_cmd: List[str] = [
            "gunicorn", "--bind", f"{host}:{port}", "--workers", str(gunicorn_workers),
            "--access-logfile", str(gunicorn_access_log), "--error-logfile", str(gunicorn_error_log),
            "llmchat_web.app:app",
        ]
        logger.info(f"Executing Gunicorn command: {' '.join(gunicorn_cmd)}")
        try:
            os.execvp(gunicorn_cmd[0], gunicorn_cmd)
        except Exception as e_exec:
            logger.critical(f"Failed to execute Gunicorn: {e_exec}", exc_info=True)
            raise RuntimeError(f"Failed to start Gunicorn: {e_exec}")
    else:
        logger.info(f"Starting Flask development server. Host: {host}, Port: {port}, Debug: {flask_debug}")
        try:
            # use_reloader=False is important for daemon mode and single-process stability
            app.run(host=host, port=port, debug=flask_debug, use_reloader=False)
        except Exception as e_flask_run:
            logger.error(f"Failed to start Flask development server: {e_flask_run}", exc_info=True)
            raise RuntimeError(f"Flask dev server failed to start: {e_flask_run}")

@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "--pid-file", type=click.Path(dir_okay=False, writable=True, resolve_path=True),
    default=None, help="Path to PID file for daemon mode."
)
@click.version_option(APP_VERSION, prog_name="llmchat-web")
@click.pass_context
def main_cli(ctx, pid_file: Optional[str]):
    """Manages the LLMChat web interface server."""
    ctx.ensure_object(dict)
    ctx.obj['pid_file_path'] = _get_pid_file_path(pid_file)

@main_cli.command("start")
@click.option("--host", default="127.0.0.1", show_default=True, help="Hostname to listen on.")
@click.option("--port", default=5000, type=int, show_default=True, help="Port for the webserver.")
@click.option("--flask-debug/--no-flask-debug", default=False, show_default=True, help="Enable Flask's debug mode (forces Flask dev server).")
@click.option("--daemon/--foreground", "daemon_mode", default=True, show_default=True, help="Run server as a daemon (background) or in the foreground.")
@click.option("--wsgi-server", type=click.Choice(["flask", "gunicorn", "auto"]), default="auto", show_default=True, help="WSGI server to use.")
@click.option("--workers", default=4, type=int, show_default=True, help="Number of Gunicorn worker processes.")
@click.pass_context
def start_command(ctx, host: str, port: int, flask_debug: bool, daemon_mode: bool, wsgi_server: str, workers: int):
    """Starts the llmchat-web server."""
    pid_file_path = ctx.obj['pid_file_path']
    status_msg, running_pid = _get_server_status(pid_file_path)
    if running_pid is not None:
        click.echo(click.style(f"Server already running (PID: {running_pid}). Use 'stop' or 'restart'.", fg="yellow"))
        return

    actual_wsgi_server = wsgi_server
    if wsgi_server == "auto":
        actual_wsgi_server = "gunicorn" if GUNICORN_AVAILABLE and not flask_debug else "flask"

    server_name_display = "Gunicorn" if actual_wsgi_server == "gunicorn" else "Flask dev server"

    if not daemon_mode:
        logger.info(f"Starting web server in foreground mode with {server_name_display}.")
        click.echo(f"Starting llmchat-web server in foreground ({server_name_display}) on http://{host}:{port}/")
        try:
            start_server_logic(host, port, flask_debug, actual_wsgi_server, workers)
        except RuntimeError as e:
            click.echo(click.style(f"Failed to start server: {e}", fg="red"), err=True); sys.exit(1)
    else:
        if platform.system() == "Windows" or not PYTHON_DAEMON_AVAILABLE:
            click.echo(click.style("Daemon mode not available on this system. Starting in foreground.", fg="yellow"))
            try: start_server_logic(host, port, flask_debug, actual_wsgi_server, workers)
            except RuntimeError as e: click.echo(click.style(f"Failed to start server: {e}", fg="red"), err=True); sys.exit(1)
            return

        pid_file_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            from appdirs import user_config_dir
            log_dir = Path(user_config_dir("llmchat-web", appauthor=False)) / "logs"
        except ImportError:
            log_dir = Path.home() / ".config" / "llmchat-web" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)

        daemon_context = daemon.DaemonContext(
            working_directory=str(Path.cwd()), umask=0o022,
            pidfile=daemon.pidfile.PIDLockFile(str(pid_file_path)),
            stdout=open(log_dir / "daemon.stdout.log", 'a+'),
            stderr=open(log_dir / "daemon.stderr.log", 'a+'),
        )

        click.echo(f"Starting llmchat-web server as a daemon ({server_name_display})...")
        click.echo(f"  PID file: {pid_file_path}")
        click.echo(f"  Logs: {log_dir}")
        click.echo(f"  Server will listen on http://{host}:{port}/")

        try:
            with daemon_context:
                logger.info("Daemon context entered. Starting server logic.")
                start_server_logic(host, port, flask_debug, actual_wsgi_server, workers)
        except Exception as e:
            logger.critical(f"Failed to daemonize/run server: {e}", exc_info=True)
            click.echo(click.style(f"Error starting daemon: {e}", fg="red"), err=True); sys.exit(1)

@main_cli.command("stop")
@click.pass_context
def stop_command(ctx):
    """Stops the daemonized llmchat-web server."""
    pid_file_path = ctx.obj['pid_file_path']
    status_msg, pid = _get_server_status(pid_file_path)

    if pid is None:
        click.echo(click.style(f"Server not running: {status_msg}", fg="yellow"))
        return

    click.echo(f"Attempting to stop server with PID {pid}...")
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(10): # Wait up to 5 seconds
            time.sleep(0.5)
            if not _check_pid_running(pid):
                click.echo(click.style(f"Server with PID {pid} stopped.", fg="green"))
                if pid_file_path.exists(): pid_file_path.unlink()
                return
        click.echo(click.style(f"Server PID {pid} did not stop. Try 'kill -9 {pid}'.", fg="red"))
    except Exception as e:
        click.echo(click.style(f"Error stopping server: {e}", fg="red"))

@main_cli.command("restart")
@click.pass_context
def restart_command(ctx):
    """Restarts the daemonized llmchat-web server."""
    stop_command.callback(ctx)
    time.sleep(1) # Give it a moment
    # We need to get the start options again. For now, this is a simple restart.
    # A more advanced version would store the last start options.
    click.echo("Attempting to start the server again with default options...")
    ctx.invoke(start_command)

@main_cli.command("status")
@click.pass_context
def status_command(ctx):
    """Checks and reports the status of the daemonized server."""
    pid_file_path = ctx.obj['pid_file_path']
    status_msg, pid = _get_server_status(pid_file_path)
    if pid is not None:
        click.echo(click.style(status_msg, fg="green"))
    else:
        click.echo(click.style(status_msg, fg="yellow"))


if __name__ == "__main__":
    # This entry point is now for the CLI, not just the dev server.
    main_cli()
