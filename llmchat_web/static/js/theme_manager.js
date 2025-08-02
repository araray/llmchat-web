// llmchat_web/static/js/theme_manager.js

/**
 * @file theme_manager.js
 * @description Manages UI logic for theme switching, including fetching,
 * applying, and saving theme preferences to localStorage.
 */

/**
 * Fetches available themes from the backend and populates the theme switcher dropdown.
 */
function fetchAndPopulateThemes() {
  console.log("THEME_MANAGER: Fetching available themes...");
  const $themeList = $("#theme-switcher-list");
  $themeList.html(
    '<li><a class="dropdown-item disabled" href="#">Loading...</a></li>',
  );

  $.ajax({
    url: "/api/themes",
    type: "GET",
    dataType: "json",
    success: function (data) {
      $themeList.empty();
      if (data && data.themes && data.themes.length > 0) {
        data.themes.forEach(function (theme) {
          const iconClass =
            theme.id.includes("light") || theme.id.includes("photon")
              ? "fa-sun"
              : theme.id.includes("dark") || theme.id.includes("nocturne")
                ? "fa-moon"
                : "fa-palette";
          const $item = $(`
            <li>
              <a class="dropdown-item" href="#" data-theme-id="${escapeHtml(theme.id)}" data-is-custom="${theme.is_custom}">
                <i class="fas ${iconClass} me-2"></i>${escapeHtml(theme.name)}
              </a>
            </li>
          `);
          $themeList.append($item);
        });
      } else {
        $themeList.html(
          '<li><a class="dropdown-item disabled" href="#">No themes found.</a></li>',
        );
      }
    },
    error: function () {
      $themeList.html(
        '<li><a class="dropdown-item disabled text-danger" href="#">Error loading themes.</a></li>',
      );
      showToast("Error", "Could not fetch theme list from server.", "danger");
    },
  });
}

/**
 * Applies the selected theme by updating the override stylesheet and HTML attributes.
 * @param {string} themeId - The ID of the theme to apply.
 * @param {boolean} isCustom - Whether the theme is from the custom_themes directory.
 */
function applyTheme(themeId, isCustom) {
  console.log(
    `THEME_MANAGER: Applying theme: ${themeId} (Custom: ${isCustom})`,
  );
  const themeOverrideSheet = $("#theme-override-stylesheet");
  const htmlElement = $("html");

  let themeUrl = "";
  if (themeId !== "dark") {
    // 'dark' is the default, no override file needed
    const themeDir = isCustom ? "custom_themes" : "themes";
    themeUrl = `/static/css/${themeDir}/${themeId}.css`;
  }
  themeOverrideSheet.attr("href", themeUrl);

  const isLightTheme = themeId.includes("light") || themeId.includes("photon");
  htmlElement.attr("data-bs-theme", isLightTheme ? "light" : "dark");

  try {
    const themePreference = { id: themeId, is_custom: isCustom };
    localStorage.setItem("llmchat_theme", JSON.stringify(themePreference));
  } catch (e) {
    console.warn(
      "THEME_MANAGER: Could not save theme preference to localStorage.",
      e,
    );
  }
}

/**
 * Initializes the theme based on localStorage preference or defaults to dark.
 */
function initializeTheme() {
  let preferredTheme = { id: "dark", is_custom: false };
  try {
    const savedThemeStr = localStorage.getItem("llmchat_theme");
    if (savedThemeStr) {
      const savedTheme = JSON.parse(savedThemeStr);
      if (savedTheme && typeof savedTheme.id === "string") {
        preferredTheme = savedTheme;
      }
    }
  } catch (e) {
    console.warn(
      "THEME_MANAGER: Could not parse theme preference from localStorage.",
      e,
    );
    localStorage.removeItem("llmchat_theme");
  }
  applyTheme(preferredTheme.id, preferredTheme.is_custom);
}

/**
 * Initializes event listeners for the theme switcher.
 */
function initThemeEventListeners() {
  $("#theme-switcher-list").on("click", "a.dropdown-item", function (e) {
    e.preventDefault();
    const themeId = $(this).data("theme-id");
    const isCustom = $(this).data("is-custom") === true;
    if (themeId) {
      applyTheme(themeId, isCustom);
    }
  });
  console.log("THEME_MANAGER: Event listeners initialized.");
}
