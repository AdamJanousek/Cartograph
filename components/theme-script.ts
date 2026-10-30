export const THEME_STORAGE_KEY = "theme";

// Runs in <head> before first paint. "system" is stored as the key's absence,
// which leaves data-theme off and lets color-scheme follow the OS.
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
