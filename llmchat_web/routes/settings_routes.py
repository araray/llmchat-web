# llmchat_web/routes/settings_routes.py
"""
Flask routes for managing application and session settings in llmchat-web.
Handles selection of LLM providers and models, system messages,
and RAG prompt template values.
"""
import logging
from typing import Any, Dict, Optional

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import settings_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    logger as app_logger
)

from llmcore import LLMCoreError

logger = logging.getLogger("llmchat_web.routes.settings")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)

@settings_bp.route("/llm/providers", methods=["GET"])
@async_to_sync_in_flask
async def get_llm_providers_route() -> Any:
    if not llmcore_instance:
        logger.error("Attempted to list LLM providers, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug("Fetching available LLM providers from LLMCore.")
        providers = llmcore_instance.get_available_providers()
        logger.info(f"Successfully listed {len(providers)} LLM providers.")
        return jsonify(providers)
    except LLMCoreError as e:
        logger.error(f"Error listing LLM providers: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list LLM providers: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing LLM providers: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500

@settings_bp.route("/llm/providers/<provider_name>/models", methods=["GET"])
@async_to_sync_in_flask
async def get_llm_models_route(provider_name: str) -> Any:
    if not llmcore_instance:
        logger.error(f"Attempted to list models for provider {provider_name}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug(f"Fetching models for LLM provider: {provider_name}")
        models = llmcore_instance.get_models_for_provider(provider_name)
        logger.info(f"Successfully listed {len(models)} models for provider {provider_name}.")
        return jsonify(models)
    except LLMCoreError as e:
        logger.error(f"Error listing models for provider {provider_name}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list models for provider '{provider_name}': {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing models for provider {provider_name}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500

@settings_bp.route("/llm/update", methods=["POST"])
def update_llm_settings_route() -> Any:
    data = request.json
    if not data:
        logger.warning("Update LLM settings called with no JSON data.")
        return jsonify({"error": "No data provided."}), 400

    new_provider_name: Optional[str] = data.get('provider_name')
    new_model_name: Optional[str] = data.get('model_name')

    if not new_provider_name:
        logger.warning("Update LLM settings called without 'provider_name'.")
        return jsonify({"error": "Provider name is required to update LLM settings."}), 400

    flask_session['current_provider_name'] = new_provider_name
    flask_session['current_model_name'] = new_model_name if new_model_name else None

    logger.info(f"Flask session LLM settings updated by /llm/update: Provider={flask_session['current_provider_name']}, Model={flask_session['current_model_name']}")

    # Log the state of the session immediately after update for debugging
    if logger.isEnabledFor(logging.DEBUG):
        session_details_after_update = {
            "current_llm_session_id_in_flask": flask_session.get('current_llm_session_id'),
            "current_provider_name_in_flask": flask_session.get('current_provider_name'),
            "current_model_name_in_flask": flask_session.get('current_model_name'),
            "flask_session_full_content_keys": list(flask_session.keys())
        }
        logger.debug(f"FLASK_SESSION_STATE_SUMMARY (After /api/settings/llm/update): {session_details_after_update}")


    if flask_session['current_model_name'] is None and llmcore_instance and llmcore_instance.config:
        provider_default_model = llmcore_instance.config.get(f"providers.{new_provider_name}.default_model")
        flask_session['current_model_name'] = provider_default_model
        logger.info(f"Model was empty for provider '{new_provider_name}', set to provider's default: {provider_default_model} in Flask session.")

    flask_session.modified = True

    return jsonify({
        "message": "LLM settings updated in session.",
        "llm_settings": {
            "provider_name": flask_session['current_provider_name'],
            "model_name": flask_session['current_model_name'],
        }
    })

@settings_bp.route("/system_message", methods=["GET"])
def get_system_message_route() -> Any:
    system_msg = flask_session.get('system_message', "")
    logger.debug(f"Retrieved system message from session: '{system_msg[:100]}...'")
    return jsonify({"system_message": system_msg})

@settings_bp.route("/system_message/update", methods=["POST"])
def update_system_message_route() -> Any:
    data = request.json
    new_system_message: str = data.get('system_message', "") if data else ""
    flask_session['system_message'] = new_system_message
    flask_session.modified = True
    logger.info(f"Flask session system_message updated: '{new_system_message[:100]}...'")
    return jsonify({
        "message": "System message updated in session.",
        "system_message": new_system_message
    })

@settings_bp.route("/prompt_template_values", methods=["GET"])
def get_prompt_template_values_route() -> Any:
    values = flask_session.get('prompt_template_values', {})
    logger.debug(f"Retrieved prompt template values from session: {values}")
    return jsonify({"prompt_template_values": values})

@settings_bp.route("/prompt_template_values/update", methods=["POST"])
def update_prompt_template_value_route() -> Any:
    data = request.json
    if not data or "key" not in data or "value" not in data:
        logger.warning("Update prompt template value called without 'key' or 'value' in payload.")
        return jsonify({"error": "Missing 'key' or 'value' for prompt template update."}), 400
    key_to_update = str(data["key"]); value_to_update = str(data["value"])
    if 'prompt_template_values' not in flask_session or not isinstance(flask_session['prompt_template_values'], dict):
        flask_session['prompt_template_values'] = {}
    flask_session['prompt_template_values'][key_to_update] = value_to_update
    flask_session.modified = True
    logger.info(f"Prompt template value updated/added in session: {key_to_update} = '{value_to_update}'")
    return jsonify({"prompt_template_values": flask_session['prompt_template_values']})

@settings_bp.route("/prompt_template_values/delete_key", methods=["POST"])
def delete_prompt_template_value_route() -> Any:
    data = request.json
    if not data or "key" not in data:
        logger.warning("Delete prompt template value called without 'key' in payload.")
        return jsonify({"error": "Missing 'key' for prompt template value deletion."}), 400
    key_to_delete = str(data["key"])
    if 'prompt_template_values' in flask_session and isinstance(flask_session['prompt_template_values'], dict):
        if key_to_delete in flask_session['prompt_template_values']:
            del flask_session['prompt_template_values'][key_to_delete]
            flask_session.modified = True
            logger.info(f"Prompt template value deleted from session for key: {key_to_delete}")
        else:
            logger.warning(f"Attempted to delete non-existent prompt template key from session: {key_to_delete}")
    return jsonify({"prompt_template_values": flask_session.get('prompt_template_values', {})})

@settings_bp.route("/prompt_template_values/clear_all", methods=["POST"])
def clear_all_prompt_template_values_route() -> Any:
    flask_session['prompt_template_values'] = {}
    flask_session.modified = True
    logger.info("All prompt template values cleared from Flask session.")
    return jsonify({"prompt_template_values": {}})

logger.info("Application settings routes (LLM, system message, prompt values) defined on settings_bp.")
