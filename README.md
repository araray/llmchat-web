# LLMChat-Web: Web Interface for LLMCore

**LLMChat-Web** is a Flask-based web application providing a user-friendly graphical interface to interact with Large Language Models (LLMs) through the powerful **LLMCore** library. It allows users to engage in chat sessions, manage conversation history, utilize Retrieval Augmented Generation (RAG) with ingested data, and configure LLM settings, all from a web browser.

This project is designed to work in conjunction with `LLMCore` and can be launched directly or via the `llmchat` command-line tool (if `llmchat` is installed with web server support).

## ✨ Key Features

- **Intuitive Chat Interface**: Engage in conversations with various LLMs supported by `LLMCore`.
- **Session Management**:
    - Create new chat sessions.
    - Load and continue previous sessions.
    - Delete sessions.
- **Retrieval Augmented Generation (RAG)**:
    - Enable/disable RAG for chat sessions.
    - Select target RAG collections (vector stores).
    - Configure retrieval parameters (e.g., number of documents `k`).
    - Apply metadata filters for RAG queries.
    - Perform direct RAG searches against your collections.
- **Data Ingestion for RAG**:
    - Upload local files (e.g., text, PDF, code files) for processing and ingestion into RAG collections.
    - Ingest entire directories (via ZIP upload).
    - Ingest Git repositories by URL.
    - Powered by `Apykatu` (via `LLMCore`) for advanced parsing, chunking, and embedding.
- **LLM Configuration**:
    - Select active LLM providers (e.g., OpenAI, Ollama, Anthropic, Gemini).
    - Choose specific models for the selected provider.
    - Set and update system messages for chat sessions.
- **Context Management**:
    - View and manage a "workspace" of context items (files, text snippets) associated with a session.
    - Stage items from the workspace, chat history, or new uploads into an "active context specification" for the next LLM prompt.
    - Preview the full context that will be sent to the LLM.
- **Prompt** Template Value **Management**:
    - Define and manage custom key-value pairs for placeholders in your RAG prompt templates.
- **Real-time Status Display**: View current provider, model, RAG status, and context token usage.
- **Responsive Design**: Usable across different screen sizes.

## 🚦 Prerequisites

- **Python**: Python 3.11 or later.
- **LLMCore**: `llmchat-web` relies on `LLMCore` (version 0.18.0 or later recommended) for all backend LLM interactions, session storage, and RAG functionalities. `LLMCore` must be configured with your LLM provider API keys, storage settings, etc.
- **Optional: `llmchat` CLI**: While `llmchat-web` can be run standalone, the `llmchat` CLI tool provides convenient commands (`llmchat web start`, `stop`, `restart`, `status`) to manage the web server, especially when running as a daemon.

## 🚀 Installation

There are two main ways to install and run `llmchat-web`:

### 1. As part of the `llmchat` CLI ecosystem (Recommended for ease of use)

If you are using the `llmchat` command-line tool, you can install `llmchat-web` along with its server dependencies (Flask, Gunicorn, python-daemon) using the `web` or `server` extra:

```
pip install llmchat[web]
# OR
pip install llmchat[server]
```

This will install `llmchat`, `llmcore`, `llmchat-web`, and other necessary server components. You can then use `llmchat web start` to run the web interface.

### 2. As a standalone package (for development or direct integration)

You can install `llmchat-web` directly if you intend to run it manually or integrate it into another Python application.

```
pip install llmchat-web
```

This will install `llmchat-web` and its direct dependencies like `Flask` and `llmcore`. You might need to manually install `gunicorn` or other WSGI servers if you plan to use them for production.

**From Source (for Development):**

```
git clone [https://github.com/araray/llmchat-web.git](https://github.com/araray/llmchat-web.git) # Or your repository URL
cd llmchat-web
pip install -e .
# For development, you might also want to install testing tools:
# pip install -e .[dev] # If a 'dev' extra is defined in pyproject.toml
```

## ⚙️ Configuration

`llmchat-web` itself does not have its own separate configuration file. It relies entirely on the configuration of the **`LLMCore`** instance it uses.

**Key `LLMCore` Configuration Aspects:**

- **LLM Providers**: API keys, default models, and other settings for providers like OpenAI, Ollama, Anthropic, Gemini, etc., must be configured in `LLMCore`. This is typically done via:
    - `LLMCore`'s user configuration file: `~/.config/llmcore/config.toml`
    - Environment variables (e.g., `LLMCORE_PROVIDERS__OPENAI__API_KEY="your_key"`)
- **Storage**: `LLMCore`'s configuration dictates where session data and RAG vector data (e.g., ChromaDB path) are stored. The `[storage.session]` and `[storage.vector]` sections in `LLMCore`'s config are crucial.
- **Embedding Models**: Configuration for embedding models used by `LLMCore` for RAG.
- **Apykatu Settings (for Ingestion)**: If using the data ingestion features, the `[apykatu]` section within `LLMCore`'s configuration file (`~/.config/llmcore/config.toml`) must be set up. This includes defining embedding models for ingestion, chunking strategies, etc.
- **Logging**: `LLMCore`'s logging settings will affect the backend logs. `llmchat-web` also has its own Flask application logger.

Refer to the `LLMCore` documentation for detailed configuration instructions. When `llmchat-web` is launched (either directly or via `llmchat web start`), `LLMCore` is initialized, and it will load its configuration from the standard locations or an explicitly provided path (if supported by the launch mechanism).

## 🏃 Running the Application

### Using `llmchat` CLI (Recommended)

If you have `llmchat` installed with the `web` extra:

1. **Start the server:**

    ```
    # Start as a daemon (background process) using Gunicorn (if available) or Flask dev server
    llmchat web start
    
    # Start in the foreground using Flask development server
    llmchat web start --wsgi-server flask --foreground
    
    # Start with Gunicorn, 4 workers, on port 8000, in the foreground
    llmchat web start --wsgi-server gunicorn --workers 4 --port 8000 --foreground
    ```

    The server typically defaults to `http://127.0.0.1:5000`.

2. **Manage the server (for daemonized instances):**

    ```
    llmchat web status    # Check if the server is running
    llmchat web stop      # Stop the server
    llmchat web restart   # Restart the server
    ```

    Use `llmchat web --help` for all options.

### Running Directly (Standalone / Development)

If you have installed `llmchat-web` as a standalone package or are running from source:

1. **Ensure `LLMCore` is configured**: Set up your `~/.config/llmcore/config.toml` or environment variables for `LLMCore`.

2. **Run the Flask application**:

    ```
    python -m llmchat_web.app
    ```

    This will typically start the Flask development server on `http://0.0.0.0:5000`. You can set environment variables like `FLASK_RUN_PORT` or `FLASK_ENV=development` to control its behavior.

    For production, you would typically use a WSGI server like Gunicorn:

    ```
    # Example: Ensure LLMCore is initialized before Gunicorn workers fork.
    # This might require a custom WSGI entry point or Gunicorn hooks if LLMCore
    # initialization needs to happen per-worker or once globally before workers.
    # The `llmchat web start` command handles this initialization sequence.
    # If running Gunicorn manually, ensure LLMCore is initialized in the app factory or before app run.
    gunicorn --bind 0.0.0.0:5000 llmchat_web.app:app
    ```

    The `llmchat_web.app.py` script includes logic to initialize `LLMCore` when run directly.

## 📖 Usage Overview

Once `llmchat-web` is running, open your web browser and navigate to the server address (e.g., `http://127.0.0.1:5000`).

The interface is generally organized into several key areas:

1. **Top Status Bar**:
    - Displays the currently selected LLM Provider and Model.
    - Shows RAG status (On/Off, current collection, K value, filter status).
    - Indicates "Coworker" mode status (if applicable).
    - Shows current context token usage (estimated tokens used / model's max tokens).
2. **Left Sidebar (Session Management)**:
    - **New Session**: Button to start a new chat session. This clears the current chat history and may reset some session-specific settings to defaults.
    - **Delete Session**: Button to delete the currently loaded persistent session from `LLMCore`'s storage.
    - **Session List**: Displays a list of saved sessions from `LLMCore`. Clicking a session loads its history and associated settings. The currently active session is highlighted.
    - **LLMCore Status**: Indicates if the backend `LLMCore` service initialized correctly.
3. **Main Content Area (Tabbed Interface)**:
    - **Chat Tab**:
        - **Message Display**: Shows the conversation history with user and assistant messages.
        - **Input Area**: Text area to type your messages. Press Enter or click "Send".
        - **Message Actions**: Buttons on messages for copying content, adding to workspace, or deleting the message.
    - **Context Manager Tab**:
        - **Workspace Items (Context Pool)**: Lists items (text snippets, file contents) added to the current session's persistent workspace. You can view, stage, or remove these items.
        - **Add to Workspace**: Forms to add new text snippets or files (by server path, if `llmchat-web` has access) to the workspace.
        - **Active Context Specification**: Shows items explicitly staged for the *next* LLM prompt. You can add items from the workspace, chat history, or create new text/file items to be staged.
        - **Preview Full Context**: Button to open a modal showing the exact context (history, RAG documents, staged items) that will be prepared and sent to the LLM for the next query, along with token counts.
    - **Raw Output Tab**: (May display raw LLM responses or diagnostic information).
4. **Bottom Control Bar (Tabbed Interface)**:
    - **Command Tab**: (May include a REPL-like command input for advanced actions, if implemented).
    - **Files Tab**: (May include file management or upload features for workspace/RAG).
    - **RAG Tab**:
        - **Enable RAG**: Toggle switch.
        - **Collection Select**: Dropdown to choose the RAG collection to query.
        - **K Value**: Input for the number of documents to retrieve.
        - **Metadata Filter**: Input for a JSON-formatted metadata filter.
        - **Ingest Data**: Button to open the Data Ingestion Modal.
        - **Direct RAG Search**: Form to perform a direct similarity search against the selected RAG collection.
    - **Logs Tab**: (May display application logs).
    - **Settings Tab**:
        - **LLM Configuration**: Dropdowns to select LLM Provider and Model. "Apply" button saves these to the current Flask session for subsequent chats.
        - **System Message**: Text area to set/update the system message for the current chat session. "Apply" button saves this.
        - **Prompt Template Values**: Table to manage key-value pairs for custom placeholders in your RAG prompt template. Add, edit, or delete values.

### Data Ingestion Modal

Accessed via the "Ingest Data" button in the RAG tab:

- **Upload File(s)**: Select one or more local files to upload, specify a target collection name, and start ingestion.
- **Upload Directory (ZIP)**: Upload a ZIP file containing a directory structure, specify a target collection, and an optional repository/directory identifier.
- **Git Repository URL**: Provide a Git repository URL, a target collection name, a repository identifier, and an optional branch/tag/commit to ingest.

Progress and status of the ingestion process are displayed within the modal.

## 🛠️ Dependencies

- **Flask**: Web framework.
- **LLMCore**: Backend for all LLM interactions, session management, RAG, and configuration.
- **Pydantic**: (Optional, for data validation if `models.py` is used more extensively).
- **Apykatu**: (Indirectly via `LLMCore` or directly if `llmchat-web` calls its API) for data ingestion.
- **GitPython**: (Indirectly via `Apykatu` or directly) for Git repository ingestion.

Refer to `pyproject.toml` for the full list of dependencies.

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome! Please open an issue or submit a pull request on the project's GitHub repository.

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature-name`).
3. Make your changes.
4. Commit your changes (`git commit -am 'Add some feature'`).
5. Push to the branch (`git push origin feature/your-feature-name`).
6. Create a new Pull Request.

## 📄 License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.