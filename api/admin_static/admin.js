const state = {
  config: null,
  fields: new Map(),
  localStatus: new Map(),
  modelOptions: [],
  activeView: "providers",
  isLoading: false,
  pendingChanges: new Set(),
};

const MASKED_SECRET = "********";
const VIEW_GROUPS = [
  {
    id: "providers",
    label: "Providers",
    title: "Providers",
    sections: ["providers", "runtime"],
    containerId: "providersSections",
  },
  {
    id: "model_config",
    label: "Model Config",
    title: "Model Config",
    sections: ["models", "thinking", "web_tools"],
    containerId: "modelConfigSections",
  },
  {
    id: "messaging",
    label: "Messaging",
    title: "Messaging",
    sections: ["messaging", "voice"],
    containerId: "messagingSections",
  },
];

const byId = (id) => document.getElementById(id);

function sourceLabel(source) {
  const labels = {
    default: "default",
    template: "template",
    repo_env: "repo .env",
    managed_env: "",
    explicit_env_file: "FCC_ENV_FILE",
    process: "process env",
  };
  return Object.prototype.hasOwnProperty.call(labels, source) ? labels[source] : source;
}

function sourceText(field) {
  const parts = [];
  const label = sourceLabel(field.source);
  if (label) {
    parts.push(label);
  }
  if (field.locked) {
    parts.push("locked");
  }
  return parts.join(" ");
}

function statusClass(status) {
  if (["configured", "reachable", "running"].includes(status)) return "ok";
  if (["missing_key", "missing_url", "unknown"].includes(status)) return "warn";
  if (["offline", "error"].includes(status)) return "error";
  return "neutral";
}

async function api(path, options = {}) {
  setLoading(true);
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  const applyButton = byId("applyButton");
  if (applyButton) {
    applyButton.disabled = isLoading || state.pendingChanges.size === 0;
    if (isLoading) {
      applyButton.classList.add("loading");
      applyButton.innerHTML = '<span>Applying...</span>';
    } else {
      applyButton.classList.remove("loading");
      applyButton.innerHTML = '<span>Apply Changes</span>';
    }
  }
}

async function load() {
  showMessage("Loading admin configuration...");
  try {
    const config = await api("/admin/api/config");
    state.config = config;
    state.fields = new Map(config.fields.map((field) => [field.key, field]));
    renderNav();
    renderProviders(config.provider_status);
    renderSections(config.sections, config.fields);
    byId("configPath").textContent = config.paths.managed;
    await validate(false);
    await refreshLocalStatus();
    updateDirtyState();
    showMessage("");
  } catch (error) {
    showMessage(`Failed to load configuration: ${error.message}`, "error");
    console.error("Failed to load config:", error);
  }
}

function renderNav() {
  const nav = byId("sectionNav");
  nav.innerHTML = "";
  VIEW_GROUPS.forEach((view, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-link${index === 0 ? " active" : ""}`;
    button.dataset.view = view.id;
    button.textContent = view.label;
    if (index === 0) {
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => {
      setActiveView(view.id, { scroll: true });
    });
    nav.appendChild(button);
  });
  setActiveView(state.activeView, { scroll: false });
}

function setActiveView(viewId, { scroll = false } = {}) {
  const activeView =
    VIEW_GROUPS.find((view) => view.id === viewId) || VIEW_GROUPS[0];
  state.activeView = activeView.id;
  byId("pageTitle").textContent = activeView.title;

  document.querySelectorAll(".nav-link").forEach((link) => {
    const selected = link.dataset.view === activeView.id;
    link.classList.toggle("active", selected);
    if (selected) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  document.querySelectorAll(".admin-view").forEach((view) => {
    const selected = view.dataset.view === activeView.id;
    view.classList.toggle("active", selected);
    view.hidden = !selected;
  });

  if (scroll) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function renderProviders(providerStatus) {
  const grid = byId("providerGrid");
  grid.innerHTML = "";

  providerStatus.forEach((provider) => {
    const card = document.createElement("article");
    card.className = "provider-card";
    card.dataset.provider = provider.provider_id;
    card.dataset.status = provider.status;

    // Status indicator
    const statusIndicator = document.createElement("div");
    statusIndicator.className = "status-indicator";
    statusIndicator.style.backgroundColor =
      provider.status === "configured" ? "var(--ok)" :
      provider.status === "pending" ? "var(--warn)" :
      provider.status === "error" ? "var(--error)" : "var(--muted)";

    const titleContainer = document.createElement("div");
    titleContainer.className = "provider-title-container";
    titleContainer.style.display = "flex";
    titleContainer.style.alignItems = "center";
    titleContainer.style.gap = "12px";

    const title = document.createElement("strong");
    title.className = "provider-title";
    title.textContent = provider.display_name || provider.provider_id;

    const pill = document.createElement("span");
    pill.className = `status-pill ${statusClass(provider.status)}`;
    pill.textContent = provider.label || provider.status;

    titleContainer.append(title, pill);

    const meta = document.createElement("div");
    meta.className = "provider-meta";
    meta.textContent =
      provider.kind === "local"
        ? provider.base_url || "No local URL configured"
        : provider.credential_env || "No credentials configured";

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "provider-button-container";
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "test-button";
    button.textContent = provider.kind === "local" ? "Test Connection" : "Refresh Models";
    button.dataset.providerId = provider.provider_id;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      testProvider(provider.provider_id, button);
    });

    // Make entire card clickable for more details (if implemented)
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      // Could show more details in a modal or panel
      showMessage(`Selected provider: ${provider.display_name || provider.provider_id}`, "info");
    });

    buttonContainer.appendChild(button);
    card.append(statusIndicator, titleContainer, meta, buttonContainer);
    grid.appendChild(card);
  });
}

function updateProviderCard(providerId, status, label, metaText) {
  const card = document.querySelector(`[data-provider="${providerId}"]`);
  if (!card) return;

  const indicator = card.querySelector(".status-indicator");
  if (indicator) {
    indicator.style.backgroundColor =
      status === "configured" ? "var(--ok)" :
      status === "pending" ? "var(--warn)" :
      status === "error" ? "var(--error)" : "var(--muted)";
  }

  const pill = card.querySelector(".status-pill");
  if (pill) {
    pill.className = `status-pill ${statusClass(status)}`;
    pill.textContent = label || status;
  }

  const meta = card.querySelector(".provider-meta");
  if (meta && metaText !== undefined) {
    meta.textContent = metaText;
  }

  // Update button text based on status
  const button = card.querySelector(".test-button");
  if (button) {
    if (status === "configured") {
      button.textContent = "Test Connection";
    } else if (status === "pending") {
      button.textContent = "Checking...";
      button.disabled = true;
    } else {
      button.textContent = "Configure";
    }
  }
}

function renderSections(sections, fields) {
  VIEW_GROUPS.forEach((view) => {
    byId(view.containerId).innerHTML = "";
  });

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const bySection = new Map();
  sections.forEach((section) => bySection.set(section.id, []));
  fields.forEach((field) => {
    if (!bySection.has(field.section)) bySection.set(field.section, []);
    bySection.get(field.section).push(field);
  });

  VIEW_GROUPS.forEach((view) => {
    const container = byId(view.containerId);
    view.sections.forEach((sectionId) => {
      const section = sectionById.get(sectionId);
      const sectionFields = bySection.get(sectionId) || [];
      if (!section || sectionFields.length === 0) return;

      const sectionEl = document.createElement("section");
      sectionEl.className = "settings-section";
      sectionEl.id = `section-${section.id}`;

      const heading = document.createElement("div");
      heading.className = "section-heading";
      heading.innerHTML = `<div><h3>${section.label}</h3><p>${section.description}</p></div>`;
      sectionEl.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "field-grid";
      sectionFields.forEach((field) => {
        grid.appendChild(renderField(field));
      });
      sectionEl.appendChild(grid);

      if (sectionFields.some((field) => field.advanced)) {
        const toggleContainer = document.createElement("div");
        toggleContainer.style.textAlign = "center";
        toggleContainer.style.marginTop = "16px";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "advanced-toggle";
        toggle.textContent = "Show advanced";
        toggle.addEventListener("click", () => {
          const showing = sectionEl.classList.toggle("show-advanced");
          toggle.textContent = showing ? "Hide advanced" : "Show advanced";

          // Animate the reveal
          if (showing) {
            sectionEl.style.maxHeight = sectionEl.scrollHeight + "px";
          } else {
            sectionEl.style.maxHeight = null;
          }
        });
        toggleContainer.appendChild(toggle);
        sectionEl.appendChild(toggleContainer);
      }

      // Add smooth transition for expanding/collapsing
      sectionEl.style.overflow = "hidden";
      sectionEl.style.transition = "max-height 0.3s ease";

      container.appendChild(sectionEl);
    });
  });
}

function renderField(field) {
  const wrapper = document.createElement("div");
  wrapper.className = `field${field.advanced ? " advanced-field" : ""}`;
  wrapper.dataset.key = field.key;

  const label = document.createElement("label");
  label.htmlFor = `field-${field.key}`;
  label.className = "field-label";

  const labelText = document.createElement("span");
  labelText.textContent = field.label;
  label.appendChild(labelText);

  const source = sourceText(field);
  if (source) {
    const sourceEl = document.createElement("span");
    sourceEl.className = "field-source";
    sourceEl.textContent = source;
    label.appendChild(sourceEl);
  }

  const input = inputForField(field);
  input.id = `field-${field.key}`;
  input.dataset.key = field.key;
  input.dataset.original = field.value || "";
  input.dataset.secret = field.secret ? "true" : "false";
  input.dataset.configured = field.configured ? "true" : "false";
  input.disabled = field.locked;
  input.addEventListener("input", (e) => {
    updateDirtyState();
    // Provide immediate validation


    }

    // Update config if value changed
    const newValue = input.value;
    const originalValue = input.dataset.original;
    if (newValue !== originalValue) {
      state.pendingChanges.add(field.key);
    } else {
      state.pendingChanges.delete(field.key);
    }
    updateApplyButtonState();
  });

  input.addEventListener("change", updateDirtyState);

  // Add focus/blur effects for better UX
  input.addEventListener("focus", () => {
    input.parentElement.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.2)";
  });

  input.addEventListener("blur", () => {
    input.parentElement.style.boxHover = "";
  });

  wrapper.append(label, input);
  if (field.description) {
    const description = document.createElement("div");
    description.className = "field-description";
    description.textContent = field.description;
    wrapper.appendChild(description);
  }
  return wrapper;
}

function inputForField(field) {
  if (field.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = String(field.value).toLowerCase() === "true";
    input.dataset.original = input.checked ? "true" : "false";
    return input;
  }

  if (field.type === "tri_boolean") {
    const select = document.createElement("select");
    [
      ["", "Inherit"],
      ["true", "Enabled"],
      ["false", "Disabled"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = field.value || "";
    return select;
  }

  if (field.type === "select") {
    const select = document.createElement("select");
    field.options.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = field.value || field.options[0] || "";
    return select;
  }

  if (field.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.value = field.value || "";
    textarea.rows = Math.min(4, Math.max(2, (field.value || "").length / 50 + 1));
    textarea.style.resize = "vertical";
    return textarea;
  }

  const input = document.createElement("input");
  input.type = field.type === "number" ? "number" : "text";
  if (field.type === "secret") {
    input.type = "password";
    input.placeholder = field.configured
      ? "Configured - enter a new value to replace"
      : "Not configured";
    input.value = "";
    input.autocomplete = "off";

    // Add toggle visibility button for password fields
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "toggle-password";
    toggleButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5c2.21 0 4.17.85 5.65 2.26l2.23-2.23C21.09 4.81 18.77 3 15.01 3C10.08 3 6.07 5 3 8.5c1.41.35 2.83.88 4.13 1.6l2.37-2.37C9.15 7.03 11.15 5.5 13.5 5.5c2.21 0 4.17.85 5.65 2.26l1.5-1.5C18.76 4.81 16.37 3 13.01 3C9.24 3 6.15 4.84 4.27 6.72l1.5 1.5C5.77 8.81 7.77 10 7.77 12c0 3.87 3.13 7 7 7s7-3.13 7-7c0-2.16-.87-4.16-2.29-5.64l-1.48 1.48zM12 15.5c-3.03 0-5.5-2.47-5.5-5.5s2.47-5.5 5.5-5.5 5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5z" fill="currentColor"/></svg>';
    toggleButton.style.position = "absolute";
    toggleButton.style.right = "12px";
    toggleButton.style.background = "none";
    toggleButton.style.border = "none";
    toggleButton.style.color = "var(--muted)";
    toggleButton.style.cursor = "pointer";
    toggleButton.style.padding = "4px";
    toggleButton.style.borderRadius = "50%";
    toggleButton.style.width = "28px";
    toggleButton.style.height = "28px";
    toggleButton.style.display = "flex";
    toggleButton.style.alignItems = "center";
    toggleButton.style.justifyContent = "center";

    toggleButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (input.type === "password") {
        input.type = "text";
        toggleButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5c2.21 0 4.17.85 5.65 2.26l2.23-2.23C21.09 4.81 18.77 3 15.01 3C10.08 3 6.07 5 3 8.5c1.41.35 2.83.88 4.13 1.6l2.37-2.37C9.15 7.03 11.15 5.5 13.5 5.5c2.21 0 4.17.85 5.65 2.26l1.5-1.5C18.76 4.81 16.37 3 13.01 3C9.24 3 6.15 4.84 4.27 6.72l1.5 1.5C5.77 8.81 7.77 10 7.77 12c0 3.87 3.13 7 7 7s7-3.13 7-7c0-2.16-.87-4.16-2.29-5.64l-1.48 1.48zM12 15.5c-3.03 0-5.5-2.47-5.5-5.5s2.47-5.5 5.5-5.5 5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zM12 12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>';
      } else {
        input.type = "password";
        toggleButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5c2.21 0 4.17.85 5.65 2.26l2.23-2.23C21.09 4.81 18.77 3 15.01 3C10.08 3 6.07 5 3 8.5c1.41.35 2.83.88 4.13 1.6l2.37-2.37C9.15 7.03 11.15 5.5 13.5 5.5c2.21 0 4.17.85 5.65 2.26l1.5-1.5C18.76 4.81 16.37 3 13.01 3C9.24 3 6.15 4.84 4.27 6.72l1.5 1.5C5.77 8.81 7.77 10 7.77 12c0 3.87 3.13 7 7 7s7-3.13 7-7c0-2.16-.87-4.16-2.29-5.64l-1.48 1.48zM12 15.5c-3.03 0-5.5-2.47-5.5-5.5s2.47-5.5 5.5-5.5 5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zM12 12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>';
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(toggleButton);
    return wrapper;
  } else {
    input.placeholder = field.placeholder || "";
  }

  return input;
}

async function testProvider(providerId, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.innerHTML = '<span>Testing...</span><span class="spinner"></span>';

  try {
    const result = await api(`/admin/api/test/${providerId}`, { method: "POST" });
    if (result.status === "success") {
      updateProviderCard(providerId, "configured", "Configured", result.message || "");
      showMessage(`Provider "${providerId}" is configured correctly`, "ok");
    } else {
      updateProviderCard(providerId, "error", "Error", result.message || "Configuration error");
      showMessage(`Provider "${providerId}" configuration error: ${result.message}`, "error");
    }
  } catch (error) {
    updateProviderCard(providerId, "error", "Error", error.message);
    showMessage(`Failed to test provider "${providerId}": ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function validate(showMessage = true) {
  if (showMessage) showMessage("Validating configuration...");
  try {
    const result = await api("/admin/api/validate", { method: "POST" });
    updateDirtyState();
    if (showMessage) {
      if (result.valid) {
        showMessage("Configuration is valid", "ok");
      } else {
        showMessage(`Validation failed: ${result.errors.join(", ")}`, "error");
      }
    }
    return result.valid;
  } catch (error) {
    if (showMessage) showMessage(`Validation error: ${error.message}`, "error");
    return false;
  }
}

async function applyChanges() {
  if (!confirm("Are you sure you want to apply these changes? This may restart services.")) {
    return;
  }

  setLoading(true);
  try {
    const changes = Array.from(state.pendingChanges).map(key => {
      const field = state.fields.get(key);
      const input = document.getElementById(`field-${key}`);
      let value;

      if (field.type === "boolean") {
        value = input.checked ? "true" : "false";
      } else if (field.type === "tri_boolean") {
        value = input.value;
      } else if (field.type === "textarea") {
        value = input.value;
      } else if (field.type === "secret" && !input.value) {
        // Don't send empty secret fields
        return null;
      } else {
        value = input.value;
      }

      return { key, value };
    }).filter(Boolean);

    const result = await api("/admin/api/apply", {
      method: "POST",
      body: JSON.stringify({ changes })
    });

    if (result.success) {
      showMessage("Configuration applied successfully!", "ok");
      state.pendingChanges.clear();
      updateApplyButtonState();
      // Reload to reflect changes
      setTimeout(() => load(), 1500);
    } else {
      showMessage(`Failed to apply changes: result.error || "Unknown error"`, "error");
    }
  } catch (error) {
    showMessage(`Error applying changes: ${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

function updateDirtyState() {
  const hasChanges = state.pendingChanges.size > 0;
  const dirtyState = byId("dirtyState");
  if (dirtyState) {
    dirtyState.textContent = hasChanges ? "Unsaved changes" : "No changes";
    dirtyState.style.color = hasChanges ? "var(--warn)" : "var(--ok)";
  }
  updateApplyButtonState();
}

function updateApplyButtonState() {
  const applyButton = byId("applyButton");
  if (applyButton) {
    applyButton.disabled = state.isLoading || state.pendingChanges.size === 0;
  }
}

function showMessage(message, type = "info") {
  const messageArea = byId("messageArea");
  if (!messageArea) return;

  messageArea.textContent = message;
  messageArea.className = `message-area ${type}`;

  // Auto-clear success/error messages after 5 seconds
  if (type === "ok" || type === "error") {
    setTimeout(() => {
      if (messageArea.textContent === message) {
        messageArea.textContent = "";
        messageArea.className = "message-area";
      }
    }, 5000);
  }
}

async function refreshLocalStatus() {
  try {
    const result = await api("/admin/api/providers/local-status");
    result.providers.forEach((provider) => {
      state.localStatus.set(provider.provider_id, provider);
      const meta = provider.status_code
        ? `${provider.base_url} returned HTTP ${provider.status_code}`
        : provider.base_url;
      updateProviderCard(provider.provider_id, provider.status, provider.label, meta);
    });
  } catch (error) {
    console.warn("Failed to refresh local status:", error);
  }
}

// Add CSS for toggle password button
const style = document.createElement('style');
style.textContent = `
  .toggle-password:hover {
    background: var(--panel-strong);
    color: var(--text-strong);
  }

  .toggle-password:active {
    transform: scale(0.95);
  }

  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-left: 8px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .field > *:first-child:hover ~ input,
  .field > *:first-child:hover ~ .field > input {
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  .field > *:first-child:focus-within + input,
  .field > *:first-child:focus-within + .field > input {
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }
`;
document.head.appendChild(style);

// Event listeners for apply button
byId("applyButton")?.addEventListener("click", applyChanges);
byId("validateButton")?.addEventListener("click", () => validate(true));

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", load);

// Refresh status periodically
setInterval(refreshLocalStatus, 30000); // Every 30 seconds

// Handle visibility change to pause/resume updates
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Pause when tab is not visible
  } else {
    // Resume when tab becomes visible
    refreshLocalStatus();
  }
});