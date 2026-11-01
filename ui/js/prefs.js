// Runs before the stylesheets, so the first paint is already the right theme. A separate file because the CSP allows no inline script.
try {
  const root = document.documentElement, theme = localStorage.getItem('recall.theme');
  if (theme && theme !== 'system') root.dataset.theme = theme;
  if (localStorage.getItem('recall.motion') === 'off') root.dataset.motion = 'off';
} catch {}
