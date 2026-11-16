// Entry point. Normally starts the app; with ?render=<id> it is the add-on's render engine page.
if (new URLSearchParams(location.search).has('render')) import('./rendermode.js');
else import('./main.js');
