# llmchat_web/routes/__init__.py
"""
Initialization module for the Flask routes sub-package.

This module defines and collects Blueprints for different parts of the
llmchat-web API. These blueprints are then registered with the main
Flask application. It also imports the route modules to ensure
routes are registered on the blueprints.
"""
import logging
from flask import Blueprint

# --- Logger for this routes package ---
logger = logging.getLogger("llmchat_web.routes")

# --- Blueprint Definitions ---
core_bp = Blueprint('core_bp', __name__) # Handles '/', /api/status, /api/command
chat_bp = Blueprint('chat_bp', __name__, url_prefix='/api/chat')
session_bp = Blueprint('session_bp', __name__, url_prefix='/api/sessions')
# workspace_bp uses session_bp's prefix and adds /<session_id>/workspace/* in its routes
workspace_bp = Blueprint('workspace_bp', __name__, url_prefix='/api/sessions')
rag_bp = Blueprint('rag_bp', __name__, url_prefix='/api/rag')
ingest_bp = Blueprint('ingest_bp', __name__, url_prefix='/api/ingest')
settings_bp = Blueprint('settings_bp', __name__, url_prefix='/api/settings')
preset_bp = Blueprint('preset_bp', __name__, url_prefix='/api/presets')


# --- Import route modules to register their routes with the blueprints ---
# These imports are crucial for the @bp.route decorators in each file to execute.
from . import core_routes
from . import chat_routes
from . import session_routes
from . import workspace_routes
from . import rag_routes
from . import ingest_routes
from . import settings_routes
from . import preset_routes

logger.info("Route modules imported and routes should be registered on their respective blueprints.")

# List of all blueprints to be registered by the app
all_blueprints = [
    core_bp,
    chat_bp,
    session_bp,
    workspace_bp,
    rag_bp,
    ingest_bp,
    settings_bp,
    preset_bp,
]

logger.info(f"Defined and collected {len(all_blueprints)} blueprints for llmchat_web routes.")
