Original prompt: The request instructor account link should display right on the first login - when people access the main page.

- Initialized progress log for this change.

- Updated main page instructor section to show both login and request-account links on initial access.
- Adjusted link layout styles for desktop/mobile wrapping.

- Validation: npm run build passed after changes.
- Runtime UI check attempt blocked in this environment (Vite dev server spawn EPERM / localhost refused).

- TODOs for next agent: none for this request.

- Follow-up prompt: add spacing between Current Hour Arrivals and Players cards in instructor monitor.
- Updated .arrivals-section with margin-bottom: 1.5rem in SessionMonitor.css.
- Validation: npm run build passed.

- Follow-up prompt: player sees a generic error screen when the instructor ends a session, even though results appear after a refresh.
- Added a short completion redirect delay in PlayerGame and ignore disconnect-update failures during navigation/unload.
- Simplified the public player results view to show a lightweight summary + leaderboard without the heavier analytics charts/export controls.
- Rolled those player-results changes back after they did not fix the issue and removed analytics from the player view.

